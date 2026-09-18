import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, DirectResourceSummary, PackageDeclarationSummary } from "../types.js";
import { deriveId, findCatalogItemForSource, loadCatalog } from "../catalog.js";
import { collectProjectPackageResources, collectTemporaryPackageResourcesForSources, packageResourceMatches, type PackageResourceInventory, type PackageResourceSummary } from "../package-resources.js";
import { collectProjectInventory, type ProjectInventory } from "../project-inventory.js";
import { isObject } from "../json.js";
import { effectivePackageState, savedSourceDecision, type EffectivePackageState, type SavedSourceRow } from "../effective-state.js";
import { savedLoadoutSources, uniqueSorted } from "../saved-loadouts.js";
import { formatPackageSourceLabel, packageSourceIdentityKey } from "../sources.js";
import { packageSourceMatchValues } from "../pi-adapter/source-identity.js";
import { CONSTRUCT_TITLE } from "../metadata.js";
import { directResourceKinds, resourcePlural } from "../resources.js";
import { type PackageResourceFilterKey } from "../package-filters.js";
import { packageResourceSelectionKey, packageResourceSetsDiffer, packageResourceStateDrift, planPackageResourceFilters } from "../package-resource-plans.js";
import { loadPackageIntoProject, setPackageResourceFiltersInProject } from "../package-ops.js";
import { runConstructOperationSteps, type ConstructOperationAction, type ConstructOperationItem, type ConstructOperationStep } from "../operation-runner.js";
import { pickCheckboxes, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerConfirmation, type CheckboxPickerItem, type CheckboxPickerOptions, type CheckboxPickerResult, type CheckboxPickerSubmitAction, type CheckboxPickerTone } from "../ui.js";
import { unloadConstructSources, type UnloadSelection } from "./unload.js";

type DashboardSection = "Saved" | "Active" | "Disabled" | "Unresolved" | "Overrides" | "Available" | "Unloaded";
type PackageDashboardSection = Exclude<DashboardSection, "Saved">;
type DashboardAction = ConstructOperationAction;
type DashboardOperationItem = ConstructOperationItem;
type DashboardStep = ConstructOperationStep;

interface DashboardPackage extends DashboardOperationItem {
	type: "package";
	rowId: string;
	section: PackageDashboardSection;
	checked: boolean;
	disabled?: boolean;
	description?: string;
	disabledByFilters?: boolean;
	filterState?: "unfiltered" | "whole-package-disabled" | "partially-filtered" | "invalid";
	effectiveState?: EffectivePackageState;
	matchSources: string[];
}

interface DashboardSavedLoadout {
	type: "saved";
	rowId: string;
	id: string;
	label: string;
	value: string;
	section: "Saved";
	checked: boolean;
	disabled?: boolean;
	description?: string;
	sources: string[];
	relatedIds: string[];
}

interface DashboardDirectResource {
	type: "direct";
	rowId: string;
	id: string;
	label: string;
	value: string;
	section: PackageDashboardSection;
	checked: boolean;
	disabled: boolean;
	description?: string;
	resource: DirectResourceSummary;
}

type DashboardItem = DashboardPackage | DashboardSavedLoadout | DashboardDirectResource;

const dashboardSections: DashboardSection[] = ["Saved", "Active", "Disabled", "Unresolved", "Overrides", "Available", "Unloaded"];

function sectionRank(section: DashboardSection): number {
	return dashboardSections.indexOf(section);
}

function itemSortValue(item: DashboardItem): string {
	if (item.type === "saved") return item.value;
	if (item.type === "direct") return item.resource.displayPath;
	return item.source;
}

function sortDashboardPackages(packages: DashboardItem[]): DashboardItem[] {
	return packages.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.label.localeCompare(b.label) || itemSortValue(a).localeCompare(itemSortValue(b)));
}

function rowId(prefix: string, ...parts: string[]): string {
	return `${prefix}:${parts.join("\u0000")}`;
}

function countLabel(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function savedLoadoutMemberSummary(sources: string[], packageItems: DashboardPackage[]): { value: string; relatedIds: string[] } {
	if (sources.length === 0) return { value: "0 package sources", relatedIds: [] };
	const counts: Record<PackageDashboardSection, number> = { Active: 0, Disabled: 0, Unresolved: 0, Overrides: 0, Available: 0, Unloaded: 0 };
	const relatedIds: string[] = [];
	const seenRows = new Set<string>();
	for (const source of sources) {
		const row = findPackageForSavedSource(packageItems, source);
		const section = row?.section ?? "Available";
		counts[section] += 1;
		if (row && !seenRows.has(row.rowId)) {
			seenRows.add(row.rowId);
			relatedIds.push(row.rowId);
		}
	}
	return {
		value: [
			counts.Active > 0 ? countLabel(counts.Active, "active") : undefined,
			counts.Disabled > 0 ? countLabel(counts.Disabled, "disabled") : undefined,
			counts.Unresolved > 0 ? countLabel(counts.Unresolved, "unresolved") : undefined,
			counts.Overrides > 0 ? countLabel(counts.Overrides, "override") : undefined,
			counts.Available > 0 ? countLabel(counts.Available, "available") : undefined,
			counts.Unloaded > 0 ? countLabel(counts.Unloaded, "unloaded") : undefined,
		]
			.filter((part): part is string => part !== undefined)
			.join(" · "),
		relatedIds,
	};
}

interface DeclarationEntry {
	summary: PackageDeclarationSummary;
	entry: unknown;
	// Scope-aware normalized match values (Construct's existing source-matching helper), precomputed so the
	// synchronous preview and signature comparisons do not duplicate source identity.
	matchValues: string[];
}

// Raw declaration entry pairs (aligned with packageDeclarations order) plus normalized match values, so a
// broad filter that becomes an exact filter with the same current enabled resources still counts as policy
// drift, including when Construct metadata stores an absolute source while settings store an equivalent
// relative one.
async function packageDeclarationEntries(inventory: ProjectInventory): Promise<DeclarationEntry[]> {
	const settings = inventory.reads.projectSettings;
	const rawPackages = settings.state === "ok" && isObject(settings.data) && Array.isArray(settings.data.packages) ? (settings.data.packages as unknown[]) : [];
	const settingsDir = dirname(inventory.paths.projectSettingsPath);
	return Promise.all(inventory.packageDeclarations.map(async (summary, index) => ({
		summary,
		entry: rawPackages[index],
		matchValues: summary.source.trim() ? await packageSourceMatchValues(summary.source, settingsDir) : [],
	})));
}

function declarationSignature(entry: DeclarationEntry): string {
	return JSON.stringify({
		raw: entry.entry ?? null,
		form: entry.summary.form,
		autoload: entry.summary.autoload,
		projectOverride: entry.summary.projectOverride,
		enabled: entry.summary.enabled,
		disabledByFilters: entry.summary.disabledByFilters ?? false,
		filterState: entry.summary.filterState,
	});
}

function declarationMatchesItem(item: DashboardPackage, entry: DeclarationEntry): boolean {
	if (entry.summary.source === item.source) return true;
	if (item.matchSources.includes(entry.summary.source)) return true;
	return entry.matchValues.some((value) => item.matchSources.includes(value));
}

function packageDeclarationSignatures(item: DashboardPackage, declarations: DeclarationEntry[]): string[] {
	return uniqueSorted(declarations.filter((declaration) => declarationMatchesItem(item, declaration)).map(declarationSignature));
}

function declarationPolicyChanged(baseline: string[], fresh: string[]): boolean {
	if (baseline.length !== fresh.length) return true;
	const sortedBaseline = [...baseline].sort();
	const sortedFresh = [...fresh].sort();
	return sortedBaseline.some((value, index) => value !== sortedFresh[index]);
}

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardItem[]; warnings: string[]; projectMetadataMissing: boolean; packageResources?: PackageResourceInventory; declarations: DeclarationEntry[] }> {
	const inventory = await collectProjectInventory(ctx);
	const { paths } = inventory;
	const projectMetadataMissing = inventory.reads.projectConstruct.state === "missing";
	const catalog = inventory.catalog.data;
	const warnings = [...inventory.catalog.warnings];
	const packages: DashboardItem[] = [];

	for (const profile of catalog.profiles) {
		const sources = uniqueSorted(savedLoadoutSources(catalog, profile));
		packages.push({
			type: "saved",
			rowId: rowId("saved", profile.id),
			id: profile.id,
			label: profile.id,
			value: `${sources.length} package source${sources.length === 1 ? "" : "s"}`,
			section: "Saved",
			checked: false,
			disabled: sources.length === 0,
			sources,
			relatedIds: [],
			description:
				sources.length === 0
					? "Empty loadout recipe."
					: `Loadout recipe${profile.name && profile.name !== profile.id ? ` (${profile.name})` : ""}. Enter runs; Space selects recipe items.`,
		});
	}

	for (const override of inventory.projectOverrides) {
		packages.push({
			type: "package",
			rowId: rowId("project-override", override.source),
			id: `project-override:${override.source}`,
			label: `${deriveId(override.source)}:override`,
			source: override.source,
			displaySource: formatPackageSourceLabel(override.source),
			section: "Overrides",
			checked: false,
			disabled: true,
			disabledByFilters: false,
			filterState: override.filterState,
			matchSources: [override.source],
			description: "Pi project resource override (autoload: false). Construct leaves this read-only; manage inherit/load/unload with `pi config -l`.",
		});
	}

	for (const managed of inventory.managedPackages) {
		if (managed.projectOverride) continue;
		const item = managed.metadata;
		const source = managed.source;
		const drift = managed.drift;
		const missingDeclarationDrift = !managed.declared && item.enabled !== undefined;
		if (drift) warnings.push(`${item.id} drift: ${drift}`);
		const packageDescription = managed.declared
			? managed.filterState === "partially-filtered"
				? "Filtered package. Construct will not replace partial Pi filters with whole-package toggles; use pi config -l for exact overrides."
				: managed.disabledByFilters
					? "Disabled package. Enter enables the whole package; Ctrl+Alt+R removes."
					: "Active package. Enter disables the whole package; Ctrl+Alt+R removes."
			: missingDeclarationDrift
				? "Drifted package. Enter restores; if resources are available, Right Arrow selects individual package resources."
				: "Available package. Enter installs; if resources are available, Right Arrow selects individual package resources.";
		packages.push({
			type: "package",
			rowId: rowId("managed", item.id, source),
			id: item.id,
			label: item.id,
			source,
			displaySource: formatPackageSourceLabel(source),
			section: managed.state === "active" ? "Active" : managed.state === "disabled" ? "Disabled" : "Available",
			checked: false,
			managed: true,
			disabledByFilters: managed.disabledByFilters,
			filterState: managed.filterState,
			matchSources: uniqueSorted([source, ...managed.matchSources]),
			description: packageDescription,
		});
	}

	for (const item of inventory.availableCatalogPackages) {
		packages.push({
			type: "package",
			rowId: rowId("catalog", item.id, item.source),
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: formatPackageSourceLabel(item.source),
			section: "Available",
			checked: false,
			matchSources: [item.source],
			description: "Available package. Enter installs; if resources are available, Right Arrow selects individual package resources.",
		});
	}

	for (const pkg of inventory.unloadedPackageDeclarations) {
		packages.push({
			type: "package",
			rowId: rowId("unloaded", pkg.source),
			id: `unloaded:${pkg.source}`,
			label: deriveId(pkg.source),
			source: pkg.source,
			displaySource: formatPackageSourceLabel(pkg.source),
			section: "Unloaded",
			checked: false,
			disabled: true,
			disabledByFilters: pkg.disabledByFilters,
			filterState: pkg.filterState,
			matchSources: uniqueSorted(pkg.matchSources),
			description: pkg.filterState === "partially-filtered" ? "Read-only filtered package. Run /construct load to adopt its existing declaration." : "Read-only package. Run /construct load to adopt its existing declaration.",
		});
	}

	warnings.push(...inventory.directResources.warnings);
	for (const resource of inventory.directResources.resources) {
		const section: PackageDashboardSection = resource.managed ? (resource.enabled ? "Active" : "Disabled") : "Unloaded";
		packages.push({
			type: "direct",
			rowId: rowId("direct", resource.id),
			id: `direct:${resource.id}`,
			label: `${resource.kind}:${resource.name}`,
			value: resource.displayPath,
			section,
			checked: false,
			disabled: !resource.managed,
			resource,
			description: resource.managed
				? resource.enabled
					? `Active ${resource.kind}. Enter disables.`
					: `Disabled ${resource.kind}. Enter enables.`
				: `Read-only ${resource.kind}. Run /construct load to adopt existing metadata.`,
		});
	}

	const projectResources = await collectProjectPackageResources(ctx, inventory);
	warnings.push(...projectResources.warnings);
	reclassifyManagedPackagesByEffectiveState(projectResources, packages);

	// Recipe summaries/counts must reflect the effective sections, not the pre-resolve declaration
	// sections that `reclassifyManagedPackagesByEffectiveState` just corrected.
	const packageRows = packages.filter((item): item is DashboardPackage => item.type === "package");
	for (const saved of packages.filter((item): item is DashboardSavedLoadout => item.type === "saved")) {
		const summary = savedLoadoutMemberSummary(saved.sources, packageRows);
		saved.value = summary.value;
		saved.relatedIds = summary.relatedIds;
		if (saved.sources.length > 0) {
			saved.description = `Loadout recipe: ${summary.value}. Enter runs; Space selects recipe items.`;
		}
	}
	let packageResources: PackageResourceInventory = projectResources;
	if (ctx.mode === "tui") {
		const availableSources = packages.filter((item): item is DashboardPackage => item.type === "package" && item.section === "Available" && !item.disabled).map((item) => item.source);
		const availableResources = await collectTemporaryPackageResourcesForSources(ctx, inventory, availableSources, { cacheOnly: true });
		warnings.push(...availableResources.warnings);
		packageResources = {
			resources: [...projectResources.resources, ...availableResources.resources],
			warnings: [...projectResources.warnings, ...availableResources.warnings],
		};
	}
	sortDashboardPackages(packages);
	return { paths, packages, warnings, projectMetadataMissing, packageResources, declarations: await packageDeclarationEntries(inventory) };
}

function reclassifyManagedPackagesByEffectiveState(projectResources: PackageResourceInventory, packages: DashboardItem[]): void {
	// Pi's resolved resources are the truth for declared packages. Declaration policy stays separate:
	// whole-package-disabled declarations remain explicitly Disabled even when Pi resolves no resources,
	// so ordinary whole-package Enable behavior is preserved. Everything else follows effective state:
	// active when any resolved resource is enabled, Disabled when resolved resources are all off, and a
	// truthful Unresolved section when nothing resolved (never Active, and Enter never enables/installs).
	for (const item of packages) {
		if (item.type !== "package") continue;
		if (!item.managed) {
			// Unloaded declarations stay read-only/Unloaded (not adopted just because resolved), but still
			// carry effective state so dashboard saved-row runs agree with /construct run skips.
			if (item.section !== "Unloaded") continue;
			const unloadedState = effectivePackageState(projectResources.resources, { matchSources: item.matchSources });
			item.effectiveState = unloadedState;
			if (unloadedState === "unknown") {
				item.description = "Read-only package declaration; Pi resolved no package resources yet (not installed, or no matching resources). Run /construct load to adopt, or remove with Pi directly.";
			} else if (unloadedState === "inactive") {
				item.description = item.filterState === "partially-filtered"
					? "Read-only package declaration; all resolved resources are currently off. Run /construct load to adopt, then use pi config -l for exact overrides."
					: "Read-only package declaration; Pi resolves every resource as disabled.";
			}
			continue;
		}
		if (item.section !== "Active" && item.section !== "Disabled") continue;
		const state = effectivePackageState(projectResources.resources, { id: item.id, matchSources: item.matchSources });
		item.effectiveState = state;
		if (item.filterState === "whole-package-disabled") {
			item.section = "Disabled";
			continue;
		}
		if (state === "active") {
			item.section = "Active";
			continue;
		}
		if (state === "inactive") {
			item.section = "Disabled";
			item.description = item.filterState === "partially-filtered"
				? "Disabled via Pi resource filters (all resolved resources off). Use pi config -l for native project override editing; Right Arrow remains available for ordinary project declarations."
				: "Pi resolves every resource for this package as disabled. Use pi config -l for exact overrides.";
			continue;
		}
		item.section = "Unresolved";
		item.description = "Declared in .pi/settings.json, but Pi resolved no package resources yet (not installed, or the package resolved no matching resources). Construct will not treat this as active or install it; inspect the declaration with pi config -l. Ctrl+Alt+R removes the declaration.";
	}
}

function dashboardCounts(packages: DashboardItem[]): { active: number; disabled: number; unresolved: number; overrides: number; available: number; unloaded: number } {
	const resources = packages.filter((item) => item.section !== "Saved");
	return {
		active: resources.filter((item) => item.section === "Active").length,
		disabled: resources.filter((item) => item.section === "Disabled").length,
		unresolved: resources.filter((item) => item.section === "Unresolved").length,
		overrides: resources.filter((item) => item.section === "Overrides").length,
		available: resources.filter((item) => item.section === "Available").length,
		unloaded: resources.filter((item) => item.section === "Unloaded").length,
	};
}

function dashboardSummary(packages: DashboardItem[], projectTrusted = true): string {
	const counts = dashboardCounts(packages);
	const activeLabel = projectTrusted ? "active" : "declared active";
	const disabledLabel = projectTrusted ? "disabled" : "declared disabled";
	return `${counts.active} ${activeLabel} · ${counts.disabled} ${disabledLabel}${counts.unresolved > 0 ? ` · ${counts.unresolved} unresolved` : ""}${counts.overrides > 0 ? ` · ${counts.overrides} Pi override${counts.overrides === 1 ? "" : "s"}` : ""} · ${counts.available} available · ${counts.unloaded} unloaded`;
}

function dashboardPickerTitle(_packages: DashboardItem[]): string {
	return CONSTRUCT_TITLE;
}

function dashboardPickerSubtitle(packages: DashboardItem[], projectMetadataMissing: boolean): string {
	const counts = dashboardCounts(packages);
	return `${counts.active} active | ${counts.disabled} disabled${counts.unresolved > 0 ? ` | ${counts.unresolved} unresolved` : ""}${counts.overrides > 0 ? ` | ${counts.overrides} Pi override${counts.overrides === 1 ? "" : "s"}` : ""} | ${counts.available} available | ${counts.unloaded} unloaded${projectMetadataMissing ? " | no Construct metadata yet" : ""}`;
}

function sectionLabel(section: DashboardSection): string {
	return section === "Saved" ? "Loadouts" : section;
}

function sectionTone(_section: DashboardSection): CheckboxPickerTone {
	return "accent";
}

function stateTone(section: DashboardSection): CheckboxPickerTone {
	if (section === "Active") return "accent";
	if (section === "Disabled") return "muted";
	if (section === "Unresolved") return "warning";
	if (section === "Available") return "warning";
	if (section === "Saved") return "accent";
	return "muted";
}

function stateIcon(section: DashboardSection): string {
	if (section === "Saved") return "◆";
	if (section === "Active") return "✓";
	if (section === "Disabled") return "–";
	if (section === "Unresolved") return "?";
	if (section === "Overrides") return "↔";
	if (section === "Unloaded") return "◇";
	return "+";
}

function stateLabel(section: DashboardSection): string {
	if (section === "Unloaded") return "Unloaded";
	return section;
}

function selectionMarker(item: DashboardItem, projectTrusted = true): string {
	if (!projectTrusted) return "[!]";
	return item.section === "Unloaded" || item.section === "Overrides" ? "[!]" : item.disabled ? "   " : "[ ]";
}

function dashboardLine(item: DashboardItem, labelWidth: number, projectTrusted = true): string {
	const paddedLabel = item.label + " ".repeat(Math.max(0, labelWidth - item.label.length));
	const value = item.type === "package" ? item.displaySource : item.value;
	return `${selectionMarker(item, projectTrusted)} ${stateIcon(item.section)}  ${paddedLabel}  ${value}`;
}

function dashboardFooterHint(packages: DashboardItem[], projectMetadataMissing: boolean, projectTrusted = true): string {
	if (!projectTrusted) return "Project is not trusted by Pi. Construct is read-only here; trust the project to load, run, or edit package settings.";
	const counts = dashboardCounts(packages);
	if (projectMetadataMissing && counts.unloaded > 0) return "No Construct metadata yet. Run /construct load to adopt already-installed project resources.";
	if (counts.overrides > 0 && counts.active + counts.disabled + counts.available + counts.unloaded === 0) return "Pi project overrides are read-only here; manage inherit/load/unload with pi config -l.";
	if (projectMetadataMissing && counts.available > 0) return "No Construct metadata yet. Select Available rows to install remembered packages, or run /construct load after installing project resources.";
	if (projectMetadataMissing) return "No Construct metadata yet. Install a Pi package normally, then run /construct load.";
	if (counts.unresolved > 0) return "Unresolved rows are declared but Pi resolved no resources; Construct will not install or enable them. Use pi config -l, or Ctrl+Alt+R to remove the declaration.";
	if (counts.unloaded > 0) return "Run /construct load to adopt already-installed resources into the Construct.";
	if (counts.available > 0) return "Select Available rows and press Enter to install them into this project.";
	if (counts.active + counts.disabled > 0) return "Select Active or Disabled rows and press Enter to toggle them.";
	return "Install a Pi package normally, then run /construct load to remember it.";
}

function dashboardText(paths: ConstructPaths, packages: DashboardItem[], warnings: string[], projectMetadataMissing: boolean, projectTrusted = true): string {
	const lines: string[] = [CONSTRUCT_TITLE, "=".repeat(CONSTRUCT_TITLE.length), `Project: ${paths.cwd}`, dashboardSummary(packages, projectTrusted), ""];
	const labelWidth = Math.min(28, Math.max(...packages.map((item) => item.label.length), 0));
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		if ((section === "Saved" || section === "Overrides") && sectionItems.length === 0) continue;
		const label = sectionLabel(section);
		lines.push(label, "-".repeat(label.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => dashboardLine(item, labelWidth, projectTrusted)) : ["- none"]), "");
	}
	if (warnings.length > 0) lines.push(...warnings.map((warning) => `! ${warning}`), "");
	lines.push(
		"Legend: [ ] selectable · [x] selected/all · [~] mixed state · [-] active selected · [+] inactive/available selected · [*] custom child selection · [·] recipe item · [!] read-only · ◆ saved · ✓ active · – inactive · ↔ Pi override · + available · ◇ unloaded.",
		"Parent Space cycles child selections: all → active → inactive/available → none · Enter applies/runs · → unfolds known resources · ← folds · Alt+I details · Ctrl+Alt+R removes · Ctrl+U unloads · Esc cancels.",
		"",
		dashboardFooterHint(packages, projectMetadataMissing, projectTrusted),
	);
	return lines.join("\n");
}

function packageWholeToggleBlocked(item: DashboardPackage): boolean {
	return item.filterState === "partially-filtered" || item.filterState === "invalid";
}

function actionForSubmit(action: CheckboxPickerSubmitAction, item: DashboardItem): DashboardAction | undefined {
	if (item.type !== "package" && item.type !== "direct") return undefined;
	if (action === "confirm") {
		if (item.type === "package" && item.section === "Available") return "Install";
		if (item.type === "package" && packageWholeToggleBlocked(item)) return undefined;
		if (item.section === "Active") return "Disable";
		// Only whole-package-disabled declarations have clearable whole-package filters; partial/invalid
		// are blocked above, and a Disabled row without them would enable nothing.
		if (item.section === "Disabled") {
			if (item.type === "direct") return "Enable";
			return item.filterState === "whole-package-disabled" ? "Enable" : undefined;
		}
		return undefined;
	}
	if (action === "remove" && item.type === "package") return item.section === "Active" || item.section === "Disabled" || item.section === "Unresolved" ? "Remove" : undefined;
	return undefined;
}

function noChangeLines(action: CheckboxPickerSubmitAction, blockedPartialPackages: DashboardPackage[] = [], effectivelyOffPackages: DashboardPackage[] = []): string[] {
	if (action === "confirm" && blockedPartialPackages.length > 0) {
		return [
			"No whole-package changes were applied.",
			`${blockedPartialPackages.length} selected package${blockedPartialPackages.length === 1 ? " already has" : "s already have"} partial Pi package filters, so Construct will not toggle the whole package row.`,
			"Use Right Arrow to unfold the package, Space to change individual child resources, then Enter to write package filters.",
			"Use Ctrl+Alt+R if you want to remove the package declaration from this project.",
		];
	}
	if (action === "confirm" && effectivelyOffPackages.length > 0) {
		return [
			"No whole-package changes were applied.",
			`${effectivelyOffPackages.length} selected package${effectivelyOffPackages.length === 1 ? " resolves" : "s resolve"} every resource as off without a whole-package filter Construct can clear.`,
			"Use pi config -l to inspect the native package filters; Construct will not report a successful enable when no resource would change.",
		];
	}
	if (action === "confirm") return ["No Construct changes were selected.", "Select Saved, Active, Disabled, or Available rows, then press Enter.", "Unloaded rows are read-only here; use /construct load to adopt already-installed resources into Construct metadata."];
	return [
		"No active or disabled project packages were selected to remove.",
		"Select Active or Disabled package rows, then press Ctrl+Alt+R.",
		"Ctrl+Alt+R always targets the whole package: child resource rows fold into their parent package for removal.",
		"To filter package-contained resources instead of removing the package, use Space then Enter.",
		"Available packages are not installed in this project; use /construct unload to forget them from the Construct library.",
		"Unloaded resources are read-only here; remove them with Pi directly if needed.",
	];
}

function removablePackages(packages: DashboardItem[], ids: string[]): DashboardPackage[] {
	const selected = new Set(ids);
	return packages.filter((item): item is DashboardPackage => item.type === "package" && selected.has(item.rowId) && (item.section === "Active" || item.section === "Disabled" || item.section === "Unresolved"));
}

function removeSkipSummary(packages: DashboardItem[], ids: string[]): string[] {
	const selected = new Set(ids);
	let saved = 0;
	let direct = 0;
	let available = 0;
	let unloaded = 0;
	let child = 0;
	let other = 0;
	for (const id of selected) {
		const item = packages.find((candidate) => candidate.rowId === id);
		if (!item) {
			if (id.startsWith("package-resource:")) child += 1;
			else other += 1;
			continue;
		}
		if (item.type === "saved") saved += 1;
		else if (item.type === "direct") direct += 1;
		else if (item.section === "Available") available += 1;
		else if (item.section === "Unloaded") unloaded += 1;
		else if (item.section !== "Active" && item.section !== "Disabled" && item.section !== "Unresolved") other += 1;
	}

	const lines: string[] = [];
	if (saved > 0) lines.push(`${saved} loadout row${saved === 1 ? "" : "s"}: loadouts run recipes; delete recipes with /construct wipe <name>.`);
	if (direct > 0) lines.push(`${direct} direct resource row${direct === 1 ? "" : "s"}: toggle with Enter; Construct does not delete project files here.`);
	if (child > 0) lines.push(`${child} package child row${child === 1 ? "" : "s"}: package-contained resources are filtered with Space+Enter, not removed.`);
	if (available > 0) lines.push(`${available} Available package row${available === 1 ? "" : "s"}: not installed in this project; use /construct unload to forget from the library.`);
	if (unloaded > 0) lines.push(`${unloaded} Unloaded row${unloaded === 1 ? "" : "s"}: read-only here; run /construct load first or remove with Pi directly.`);
	if (other > 0) lines.push(`${other} row${other === 1 ? "" : "s"}: not removable from this dashboard action.`);
	return lines;
}

function removeConfirmationFor(packages: DashboardItem[], ids: string[]): CheckboxPickerConfirmation {
	const removable = removablePackages(packages, ids);
	const skipped = removeSkipSummary(packages, ids);
	const preview = removable.slice(0, 8).map((item) => `- ${item.label}: ${item.source}`);
	const extra = removable.length > preview.length ? [`…and ${removable.length - preview.length} more`] : [];
	if (removable.length === 0) {
		return {
			title: "No removable package selected",
			confirmHint: "Press Enter/Esc to return",
			canSubmit: false,
			lines: [
				"Nothing will be removed.",
				"Focus or select Active/Disabled/Unresolved package rows, then press Ctrl+Alt+R.",
				...(skipped.length > 0 ? ["", "Skipped:", ...skipped.map((line) => `- ${line}`)] : []),
			],
		};
	}
	return {
		title: `Remove ${removable.length} package${removable.length === 1 ? "" : "s"} from this project?`,
		confirmHint: "Press Enter to remove from project · Esc cancels",
		lines: [
			`Will remove ${removable.length} package declaration${removable.length === 1 ? "" : "s"} from this project's .pi/settings.json after creating a backup.`,
			"Does not delete global Pi package caches or saved loadout recipes.",
			"",
			"Remove:",
			...preview,
			...extra,
			...(skipped.length > 0 ? ["", "Skipped:", ...skipped.map((line) => `- ${line}`)] : []),
		],
	};
}

const unloadEligibleSections: PackageDashboardSection[] = ["Active", "Disabled", "Unresolved", "Available"];

function unloadEligiblePackages(packages: DashboardItem[], ids: string[], selectionByRowId: Map<string, UnloadSelection>): DashboardPackage[] {
	const selected = new Set(ids);
	return packages.filter(
		(item): item is DashboardPackage => item.type === "package" && selected.has(item.rowId) && unloadEligibleSections.includes(item.section) && selectionByRowId.has(item.rowId),
	);
}

// IDs not present as dashboard rowIds are partial child groups or unknown ids and are refused,
// never silently promoted to a parent and never widened to direct resources or saved recipes.
function unloadSkipSummary(packages: DashboardItem[], ids: string[], selectionByRowId: Map<string, UnloadSelection>): string[] {
	const selected = new Set(ids);
	const byRowId = new Map(packages.map((item) => [item.rowId, item]));
	let saved = 0;
	let direct = 0;
	let override = 0;
	let unloaded = 0;
	let notLibrary = 0;
	let child = 0;
	let other = 0;
	for (const id of selected) {
		const item = byRowId.get(id);
		if (!item) {
			child += 1;
			continue;
		}
		if (item.type === "saved") saved += 1;
		else if (item.type === "direct") direct += 1;
		else if (item.section === "Overrides") override += 1;
		else if (item.section === "Unloaded") unloaded += 1;
		else if (unloadEligibleSections.includes(item.section) && !selectionByRowId.has(item.rowId)) notLibrary += 1;
		else if (!unloadEligibleSections.includes(item.section)) other += 1;
	}
	const lines: string[] = [];
	if (child > 0) lines.push(`${child} package child row${child === 1 ? "" : "s"} or unknown row${child === 1 ? "" : "s"}: select the whole package group (parent Space) so the complete source can be unloaded; partial child groups are not unloaded.`);
	if (saved > 0) lines.push(`${saved} saved loadout row${saved === 1 ? "" : "s"}: loadouts are recipes; delete them with /construct wipe <name>.`);
	if (direct > 0) lines.push(`${direct} direct resource row${direct === 1 ? "" : "s"}: Construct does not delete project files; unload only forgets library package sources.`);
	if (override > 0) lines.push(`${override} Pi project override (autoload:false) row${override === 1 ? "" : "s"}: read-only; manage with pi config -l.`);
	if (unloaded > 0) lines.push(`${unloaded} Unloaded row${unloaded === 1 ? "" : "s"}: not library-backed here; nothing to forget.`);
	if (notLibrary > 0) lines.push(`${notLibrary} package row${notLibrary === 1 ? "" : "s"}: no matching Construct library item was captured for this row.`);
	if (other > 0) lines.push(`${other} row${other === 1 ? "" : "s"}: not eligible for library unload.`);
	return lines;
}

function unloadConfirmationFor(packages: DashboardItem[], ids: string[], selectionByRowId: Map<string, UnloadSelection>): CheckboxPickerConfirmation {
	const eligible = unloadEligiblePackages(packages, ids, selectionByRowId);
	const skipped = unloadSkipSummary(packages, ids, selectionByRowId);
	// Show the actual captured catalog id+source pairs, deduplicated.
	const unique = new Map<string, UnloadSelection>();
	for (const item of eligible) {
		const selection = selectionByRowId.get(item.rowId);
		if (selection) unique.set(`${selection.id}\u0000${selection.source}`, selection);
	}
	const targets = [...unique.values()];
	const preview = targets.slice(0, 8).map((selection) => `- ${selection.id}: ${selection.source}`);
	const extra = targets.length > preview.length ? [`…and ${targets.length - preview.length} more`] : [];
	if (skipped.length > 0) {
		return {
			title: "Unload selection includes unsupported rows",
			confirmHint: "Esc to return · select only complete library package rows",
			canSubmit: false,
			lines: [
				"Unload applies only to complete, catalog-backed package groups.",
				"No files were changed.",
				"",
				"Unsupported selection:",
				...skipped.map((line) => `- ${line}`),
				...(eligible.length > 0 ? ["", "Eligible if selected alone:", ...preview, ...extra] : []),
			],
		};
	}
	if (eligible.length === 0) {
		return {
			title: "No library package selected",
			confirmHint: "Press Enter/Esc to return",
			canSubmit: false,
			lines: ["Nothing will be forgotten from the Construct library.", "Select Active, Disabled, Unresolved, or Available package rows, then press Ctrl+U."],
		};
	}
	return {
		title: `Unload ${targets.length} package source${targets.length === 1 ? "" : "s"} from Construct?`,
		confirmHint: "Press Enter to unload from Construct · Esc cancels",
		lines: [
			`Will remove ${targets.length} package source${targets.length === 1 ? "" : "s"} from the global Construct library and prune saved-recipe membership.`,
			"Also removes matching current-project .pi/construct.json metadata.",
			"Does not uninstall packages, disable them, edit .pi/settings.json, or reload Pi.",
			"Complete child groups mean forgetting the whole package source; individual children are never unloaded.",
			"If still declared in .pi/settings.json, the package will show as Unloaded (read-only) after reopen.",
			"",
			...preview,
			...extra,
		],
	};
}

function disableConfirmationFor(packages: DashboardItem[], ids: string[]): CheckboxPickerConfirmation | undefined {
	const selected = new Set(ids);
	const disableTargets = packages.filter(
		(item): item is DashboardPackage | DashboardDirectResource => (item.type === "package" || item.type === "direct") && selected.has(item.rowId) && item.section === "Active" && (item.type !== "package" || !packageWholeToggleBlocked(item)),
	);
	if (disableTargets.length === 0) return undefined;
	const preview = disableTargets.slice(0, 8).map((item) => `- ${item.label}: ${item.type === "package" ? item.source : item.resource.displayPath}`);
	const extra = disableTargets.length > preview.length ? [`…and ${disableTargets.length - preview.length} more`] : [];
	return {
		title: "Disable selected project resources?",
		confirmHint: "Press Enter to disable · Esc cancels",
		lines: [
			`This will disable ${disableTargets.length} active project resource${disableTargets.length === 1 ? "" : "s"} by writing Pi resource filters.`,
			"It edits .pi/settings.json after creating a backup.",
			"Package rows are whole-package toggles: Construct sets package extension/skill/prompt/theme filters to empty arrays and does not snapshot partial filters.",
			"If you need partial package resource selection, edit Pi settings directly before using Construct's whole-package toggle.",
			"It does not uninstall packages, remove package declarations, or forget Construct library items.",
			"",
			...preview,
			...extra,
		],
	};
}

function operationFromPackage(item: DashboardPackage): DashboardOperationItem {
	return { id: item.id, label: item.label, source: item.source, displaySource: item.displaySource, managed: item.managed };
}

function operationFromDirect(item: DashboardDirectResource): DashboardOperationItem {
	return { id: item.id, label: item.label, source: item.resource.displayPath, displaySource: item.resource.displayPath, managed: item.resource.managed, direct: item.resource };
}

function operationFromSource(source: string): DashboardOperationItem {
	return { id: deriveId(source), label: deriveId(source), source, displaySource: formatPackageSourceLabel(source) };
}

function packageMatchesSource(item: DashboardPackage, source: string): boolean {
	if (item.source === source || item.matchSources.includes(source)) return true;
	const identityKey = packageSourceIdentityKey(source);
	return identityKey !== undefined && item.matchSources.includes(identityKey);
}

function packageStateRank(section: PackageDashboardSection): number {
	if (section === "Active") return 0;
	if (section === "Disabled") return 1;
	if (section === "Unresolved") return 2;
	if (section === "Overrides") return 2;
	if (section === "Unloaded") return 3;
	return 4;
}

function findPackageForSavedSource(packages: DashboardPackage[], source: string): DashboardPackage | undefined {
	return packages.filter((item) => packageMatchesSource(item, source)).sort((a, b) => packageStateRank(a.section) - packageStateRank(b.section))[0];
}

function dashboardSavedSourceRow(item: DashboardPackage): SavedSourceRow {
	if (item.section === "Overrides") return { section: "Overrides", wholePackageDisabled: false, effectiveState: item.effectiveState ?? "unknown" };
	if (item.section === "Available") return { section: "Available", wholePackageDisabled: false, effectiveState: item.effectiveState ?? "unknown" };
	if (item.section === "Unloaded") return { section: "Unloaded", wholePackageDisabled: Boolean(item.disabledByFilters), effectiveState: item.effectiveState ?? "unknown" };
	return { section: item.section, wholePackageDisabled: item.filterState === "whole-package-disabled" || Boolean(item.disabledByFilters), effectiveState: item.effectiveState ?? "unknown" };
}

function resourceMatchesPackage(resource: PackageResourceSummary, item: DashboardPackage): boolean {
	return packageResourceMatches(resource, { id: item.id, matchSources: item.matchSources });
}

function resourcesForPackage(item: DashboardPackage, packageResources: PackageResourceInventory | undefined): PackageResourceSummary[] {
	return packageResources?.resources.filter((resource) => resourceMatchesPackage(resource, item)) ?? [];
}

function packageResourceChildRowId(item: DashboardPackage, resource: PackageResourceSummary): string {
	return rowId("package-resource", item.rowId, resource.kind, resource.packageRelativePath);
}

function resourceLabel(resource: PackageResourceSummary): string {
	return `${resourcePlural(resource.kind).slice(0, -1)} ${resource.name}`;
}

function packageResourceParentPath(path: string): string | undefined {
	const index = path.lastIndexOf("/");
	if (index <= 0) return undefined;
	return path.slice(0, index);
}

function packageResourceEntrypointNote(resource: PackageResourceSummary): string | undefined {
	if (resource.kind === "extension" && (resource.packageRelativePath.endsWith("/index.ts") || resource.packageRelativePath.endsWith("/index.js"))) {
		const parent = packageResourceParentPath(resource.packageRelativePath);
		if (parent) return `Pi treats ${parent}/ as one extension entrypoint (${resource.packageRelativePath}).`;
	}
	if (resource.kind === "skill" && resource.packageRelativePath.endsWith("/SKILL.md")) {
		const parent = packageResourceParentPath(resource.packageRelativePath);
		if (parent) return `Pi treats ${parent}/ as one skill root (${resource.packageRelativePath}).`;
	}
	return undefined;
}

function packageResourceDisplayPath(resource: PackageResourceSummary): string {
	if (packageResourceEntrypointNote(resource)) {
		const parent = packageResourceParentPath(resource.packageRelativePath);
		if (parent) return `${parent}/`;
	}
	return resource.packageRelativePath;
}

function packageResourceInspectionPath(resource: PackageResourceSummary): string {
	const displayPath = packageResourceDisplayPath(resource);
	return displayPath === resource.packageRelativePath ? displayPath : `${displayPath} (${resource.packageRelativePath})`;
}

function packageResourceInspection(item: DashboardPackage, packageResources: PackageResourceInventory | undefined): CheckboxPickerConfirmation {
	const resources = resourcesForPackage(item, packageResources);
	if (item.section === "Available" && resources.length === 0) {
		return {
			title: `Package resources: ${item.label}`,
			confirmHint: "Press Enter/Esc to return",
			lines: [
				"No cached package-contained resource list is available for this package yet.",
				"Construct does not show an unfold arrow or run Right Arrow inspection until it already has a multi-resource list.",
				"Press Enter to install the whole package with Pi's normal defaults.",
			],
		};
	}
	if (!packageResources) {
		return {
			title: `Package resources: ${item.label}`,
			confirmHint: "Press Enter/Esc to return",
			lines: ["Package resources were not collected for this dashboard session."],
		};
	}
	const lines = [
		`Package: ${item.label}`,
		`Source: ${item.source}`,
		"",
		item.section === "Available"
			? "Available package resources were inspected with Pi's temporary package resolver. Selecting children installs the package into this project with native Pi filters; no package files are copied into .pi/."
			: "This view uses Pi's native package resource resolver. Selecting children writes native Pi package filters in .pi/settings.json; no package files are copied.",
	];
	if (resources.length === 0) {
		lines.push("", "No package-contained resources resolved for this package.");
		return { title: `Package resources: ${item.label}`, confirmHint: "Press Enter/Esc to return", lines };
	}
	for (const kind of directResourceKinds) {
		const kindResources = resources.filter((resource) => resource.kind === kind);
		if (kindResources.length === 0) continue;
		lines.push("", `${resourcePlural(kind)} (${kindResources.length})`);
		for (const resource of kindResources) {
			lines.push(`- ${resource.enabled ? "[x]" : "[ ]"} ${resource.name} — ${packageResourceInspectionPath(resource)}`);
		}
	}
	if (packageResources.warnings.length > 0) {
		lines.push("", ...packageResources.warnings.map((warning) => `! ${warning}`));
	}
	return { title: `Package resources: ${item.label}`, confirmHint: "Press Enter/Esc to return", lines };
}

function packageResourceChildren(item: DashboardPackage, packageResources: PackageResourceInventory | undefined): CheckboxPickerItem[] {
	const resources = resourcesForPackage(item, packageResources);
	if (resources.length === 0) return [];
	const children: CheckboxPickerItem[] = [];
	for (const kind of directResourceKinds) {
		const kindResources = resources.filter((resource) => resource.kind === kind);
		for (const resource of kindResources) {
			const editable = item.section === "Active" || item.section === "Disabled" || item.section === "Available";
			const available = item.section === "Available";
			const actionDescription =
				item.section === "Available"
					? "Package-contained resource. The state icon shows availability; [x] selects it for install/filtering and Enter installs the package with native Pi filters."
					: "Package-contained resource. The state icon shows the current enabled state; [x] selects it to toggle when Enter writes native Pi package filters.";
			const entrypointNote = packageResourceEntrypointNote(resource);
			children.push({
				id: packageResourceChildRowId(item, resource),
				parentId: item.rowId,
				depth: 1,
				label: resourceLabel(resource),
				value: packageResourceDisplayPath(resource),
				description: entrypointNote ? `${entrypointNote}\n${actionDescription}` : actionDescription,
				checked: false,
				disabled: !editable,
				stateText: available ? "+" : resource.enabled ? "✓" : "–",
				stateTone: available ? "warning" : resource.enabled ? "success" : "muted",
				selectionGroup: available ? "available" : resource.enabled ? "active" : "inactive",
				marker: editable ? undefined : "   ",
			});
		}
	}
	return children;
}

function packageResourceRowDescription(item: DashboardPackage, resourceCount: number): string | undefined {
	const base = item.description;
	if (item.section === "Available") {
		if (resourceCount > 1) return `${base}\nRight Arrow unfolds ${resourceCount} cached Pi resource entries; Enter installs the whole package.`;
		if (resourceCount === 1) return `${base}\nPi sees one cached resource entry, so there is no dropdown. Use Alt+I for the exact path.`;
		return `${base}\nNo cached package resource list is available yet, so there is no dropdown. Enter installs the whole package.`;
	}
	if (item.section === "Active" || item.section === "Disabled") {
		if (resourceCount > 1) {
			const mixedHint = item.filterState === "partially-filtered" ? " Parent Space cycles child selections: all → active → inactive → none." : "";
			return `${base}\nRight Arrow unfolds ${resourceCount} Pi resource entries.${mixedHint}`;
		}
		if (resourceCount === 1) return `${base}\nPi sees one resource entry, so there is no dropdown. Use Alt+I for the exact path.`;
		return `${base}\nNo package-contained resources resolved for this package.`;
	}
	return base;
}

function dashboardPickerItems(packages: DashboardItem[], packageResources: PackageResourceInventory | undefined): CheckboxPickerItem[] {
	const items: CheckboxPickerItem[] = [];
	for (const item of packages) {
		const resources = item.type === "package" ? resourcesForPackage(item, packageResources) : [];
		const children = item.type === "package" ? packageResourceChildren(item, packageResources) : [];
		const visibleChildren = children.length > 1 ? children : [];
		items.push({
			id: item.rowId,
			label: item.label,
			value: item.type === "package" ? item.displaySource : item.value,
			description: item.type === "package" ? packageResourceRowDescription(item, resources.length) : item.description,
			section: sectionLabel(item.section),
			sectionTone: sectionTone(item.section),
			checked: false,
			disabled: item.disabled,
			stateIcon: stateIcon(item.section),
			stateLabel: stateLabel(item.section),
			stateText: stateIcon(item.section),
			stateTone: stateTone(item.section),
			marker: item.section === "Unloaded" || item.section === "Overrides" ? "[!]" : undefined,
			relatedIds: item.type === "saved" ? item.relatedIds : undefined,
			quickSelectIds: item.type === "saved" ? item.relatedIds : undefined,
			aggregateChildIds: item.type === "package" && visibleChildren.length > 0 ? visibleChildren.map((child) => child.id) : undefined,
			confirmOnFocus: item.type === "saved",
			expandable: visibleChildren.length > 0,
		});
		items.push(...visibleChildren);
	}
	return items;
}

interface PackageResourceFilterPlan {
	item: DashboardPackage;
	resources: PackageResourceSummary[];
	selectedResourceKeys: Set<string>;
	filters: Partial<Record<PackageResourceFilterKey, string[] | null>>;
	selectedCount: number;
	// Declaration-policy signatures captured from the dashboard-build read (empty for Available installs).
	declarationBaselines: string[];
}

function packageResourceFilterPlanForResources(item: DashboardPackage, resources: PackageResourceSummary[], selectedResourceKeys: Set<string>, declarationBaselines: string[]): PackageResourceFilterPlan {
	const planned = planPackageResourceFilters(resources, selectedResourceKeys);
	return {
		item,
		resources,
		selectedResourceKeys: planned.selectedResourceKeys,
		filters: planned.filters,
		selectedCount: planned.selectedCount,
		declarationBaselines,
	};
}

function packageResourceFilterPlans(packages: DashboardItem[], packageResources: PackageResourceInventory | undefined, selectedIds: string[], changedIds: string[], declarations: DeclarationEntry[]): PackageResourceFilterPlan[] {
	if (!packageResources || changedIds.length === 0) return [];
	const selectedActionIds = new Set(selectedIds);
	const changed = new Set(changedIds);
	const packageItems = packages.filter((item): item is DashboardPackage => item.type === "package" && (item.section === "Active" || item.section === "Disabled" || item.section === "Available"));
	const changedPackages = new Set<string>();
	for (const item of packageItems) {
		for (const resource of resourcesForPackage(item, packageResources)) {
			if (changed.has(packageResourceChildRowId(item, resource))) changedPackages.add(item.rowId);
		}
	}

	const plans: PackageResourceFilterPlan[] = [];
	for (const item of packageItems) {
		if (!changedPackages.has(item.rowId)) continue;
		const resources = resourcesForPackage(item, packageResources);
		if (resources.length === 0) continue;
		const selectedResourceKeys = new Set<string>();
		for (const resource of resources) {
			const actionSelected = selectedActionIds.has(packageResourceChildRowId(item, resource));
			const targetEnabled = item.section === "Available" ? actionSelected : actionSelected ? !resource.enabled : resource.enabled;
			if (targetEnabled) selectedResourceKeys.add(packageResourceSelectionKey(resource.kind, resource.packageRelativePath));
		}
		plans.push(packageResourceFilterPlanForResources(item, resources, selectedResourceKeys, item.section === "Available" ? [] : packageDeclarationSignatures(item, declarations)));
	}
	return plans;
}

function packageResourceFilterConfirmation(plans: PackageResourceFilterPlan[]): CheckboxPickerConfirmation | undefined {
	if (plans.length === 0) return undefined;
	const installCount = plans.filter((plan) => plan.item.section === "Available").length;
	const updateCount = plans.length - installCount;
	const summary = installCount > 0 && updateCount > 0
		? `Install ${installCount} available package${installCount === 1 ? "" : "s"} and update ${updateCount} existing package${updateCount === 1 ? "" : "s"}.`
		: installCount > 0
			? `Install ${installCount} available package${installCount === 1 ? "" : "s"} with selected resources.`
			: `Update Pi package filters for ${plans.length} package${plans.length === 1 ? "" : "s"}.`;
	const lines = [
		summary,
		"Creates a .pi/settings.json backup. Package files and saved loadouts are unchanged.",
		"Existing selections toggle; unselected existing children keep their state. Available/future unselected resources stay off.",
		"",
		"Packages:",
	];
	for (const plan of plans.slice(0, 8)) {
		lines.push(`- ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources${plan.item.section === "Available" ? " (install)" : ""}`);
	}
	if (plans.length > 8) lines.push(`…and ${plans.length - 8} more`);
	return { title: "Apply package resource filters?", confirmHint: "Press Enter to write Pi filters · Esc cancels", lines };
}

async function freshProjectState(ctx: ExtensionCommandContext): Promise<{ inventory: ProjectInventory; resources: PackageResourceInventory }> {
	const inventory = await collectProjectInventory(ctx, { directResources: false });
	const resources = await collectProjectPackageResources(ctx, inventory);
	return { inventory, resources };
}

function dashboardForeignOrdinarySelections(packages: DashboardItem[], selected: Set<string>, planParentIds: Set<string>): { count: number; labels: string[] } {
	const labels: string[] = [];
	for (const item of packages) {
		if (item.disabled || !selected.has(item.rowId)) continue;
		if (item.type === "saved") {
			labels.push(`saved loadout ${item.label}`);
			continue;
		}
		// A child group's aggregate parent row belongs to that same child plan, not to a whole-package action.
		if (item.type === "package" && planParentIds.has(item.rowId)) continue;
		labels.push(item.type === "package" ? `package ${item.label}` : `direct resource ${item.label}`);
	}
	return { count: labels.length, labels };
}

function dashboardMixedSelectionRefusal(foreign: { count: number; labels: string[] }): { title: string; lines: string[] } {
	return {
		title: "Mixed selection not applied",
		lines: [
			`Child resource filters cannot be combined with other selected actions in one submit: ${foreign.labels.slice(0, 6).join(", ")}${foreign.count > 6 ? `, and ${foreign.count - 6} more` : ""}.`,
			"No files were changed.",
			"Apply child resource filters and package, direct-resource, or saved-loadout actions in separate submits.",
		],
	};
}

// Scope-aware source equivalence (equivalent relative paths count), reusing Construct's existing
// source-matching helper (not a public Pi identity API).
async function sourceMatchesDeclaration(source: string, declaration: DeclarationEntry, settingsDir: string): Promise<boolean> {
	if (!declaration.summary.source.trim()) return false;
	if (declaration.summary.source === source) return true;
	const sourceMatches = new Set(await packageSourceMatchValues(source, settingsDir));
	return declaration.matchValues.some((value) => sourceMatches.has(value));
}

async function matchingDeclarations(declarations: DeclarationEntry[], source: string, settingsDir: string): Promise<DeclarationEntry[]> {
	const matched: DeclarationEntry[] = [];
	for (const declaration of declarations) if (await sourceMatchesDeclaration(source, declaration, settingsDir)) matched.push(declaration);
	return matched;
}

type InstalledDeclarationPolicy = "ok" | "missing" | "project-override" | "partial-filters" | "whole-package-disabled" | "invalid" | "unexpected-policy";

// After Construct's own install, accept only the expected ordinary/unfiltered declaration for the returned source.
async function installedDeclarationPolicy(declarations: DeclarationEntry[], source: string, settingsDir: string): Promise<InstalledDeclarationPolicy> {
	const matched = await matchingDeclarations(declarations, source, settingsDir);
	if (matched.length === 0) return "missing";
	if (matched.length > 1) return "unexpected-policy";
	const declaration = matched[0].summary;
	if (declaration.form === "invalid") return "invalid";
	if (declaration.projectOverride) return "project-override";
	if (declaration.filterState === "whole-package-disabled") return "whole-package-disabled";
	if (declaration.filterState === "partially-filtered") return "partial-filters";
	if (declaration.filterState !== "unfiltered") return "unexpected-policy";
	return "ok";
}

type PackageResourcePlanStatus = "done" | "warn" | "fail";

function packageResourceProgressLines(plans: PackageResourceFilterPlan[], status: Map<string, PackageResourcePlanStatus>, failures: string[] = [], warnings: string[] = [], refused: string[] = [], installedWithoutFilters: string[] = []): string[] {
	return [
		`${status.size}/${plans.length} package filter update${plans.length === 1 ? "" : "s"} processed`,
		"",
		...plans.map((plan) => {
			const state = status.get(plan.item.rowId);
			const icon = state === "done" ? "✓" : state === "warn" ? "?" : state === "fail" ? "!" : " ";
			return `${icon} ${plan.item.section === "Available" ? "Install/filter" : "Filter"} ${plan.item.label}  ${plan.selectedCount}/${plan.resources.length} reviewed`;
		}),
		...warnings.map((warning) => `! ${warning}`),
		...installedWithoutFilters.map((message) => `~ ${message}`),
		...refused.map((refusal) => `? ${refusal}`),
		...failures.map((failure) => `! ${failure}`),
	];
}

async function recheckInstalledPackageResourcePlan(ctx: ExtensionCommandContext, item: DashboardPackage, resources: PackageResourceSummary[], selectedResourceKeys: Set<string>, filterSource: string, metadataId: string | undefined): Promise<{ plan?: PackageResourceFilterPlan; resources?: PackageResourceSummary[]; declarations: DeclarationEntry[]; warnings: string[] }> {
	const warnings: string[] = [];
	const inventory = await collectProjectInventory(ctx, { directResources: false });
	const inventoryResources = await collectProjectPackageResources(ctx, inventory);
	warnings.push(...inventoryResources.warnings);
	const declarations = await packageDeclarationEntries(inventory);
	const installedItem: DashboardPackage = {
		...item,
		id: metadataId ?? item.id,
		source: filterSource,
		matchSources: uniqueSorted([filterSource, item.source, ...item.matchSources]),
	};
	const installedResources = resourcesForPackage(installedItem, inventoryResources);
	if (installedResources.length === 0) {
		return { declarations, warnings: [...warnings, `${item.label}: installed, but Pi did not resolve package resources; filters were not written.`] };
	}
	if (packageResourceSetsDiffer(resources, installedResources)) {
		warnings.push(`${item.label}: cached package resource list changed after install; reviewed filters were not written from the cached list.`);
	}
	return { plan: packageResourceFilterPlanForResources(item, installedResources, selectedResourceKeys, []), resources: installedResources, declarations, warnings };
}

// One narrow injection seam for tests: the production default is Construct's existing checkbox picker, so
// tests can capture the actual submitConfirmation/onSubmit closures and drive them against real local projects.
export type DashboardPicker = (ctx: ExtensionCommandContext, title: string, items: CheckboxPickerItem[], options: CheckboxPickerOptions) => Promise<CheckboxPickerResult | undefined>;

export async function handleDashboard(_pi: ExtensionAPI, ctx: ExtensionCommandContext, pick: DashboardPicker = pickCheckboxes): Promise<void> {
	const { paths, packages, warnings, projectMetadataMissing, packageResources, declarations } = await buildDashboardPackages(ctx);
	const projectTrusted = ctx.isProjectTrusted();
	const trustWarnings = projectTrusted ? warnings : ["Project is not trusted by Pi; project declarations are read-only and are not runtime-active until trusted.", ...warnings];
	if (ctx.mode !== "tui") {
		showText(ctx, dashboardText(paths, packages, trustWarnings, projectMetadataMissing, projectTrusted));
		return;
	}

	const sessionPackageResources: PackageResourceInventory = packageResources ?? { resources: [], warnings: [] };
	if (!projectTrusted) {
		showText(ctx, dashboardText(paths, packages, trustWarnings, projectMetadataMissing, projectTrusted));
		return;
	}

	const pickerItems = dashboardPickerItems(packages, sessionPackageResources);
	// Capture exact catalog id+source for each eligible row BEFORE the picker review, so apply
	// never re-resolves sources and can only act on the keys the user reviewed.
	const unloadSelectionByRowId = new Map<string, UnloadSelection>();
	const unloadCatalog = await loadCatalog(ctx);
	if (unloadCatalog.read.state !== "invalid" && unloadCatalog.warnings.length === 0) {
		const settingsDir = dirname(paths.projectSettingsPath);
		for (const item of packages) {
			if (item.type !== "package" || !unloadEligibleSections.includes(item.section)) continue;
			// Prefer the exact catalog id+source row the user is looking at, then an exact source match,
			// and only then the existing identity-helper fallback for managed source spellings.
			const exactPair = unloadCatalog.catalog.items.find((candidate) => candidate.id === item.id && candidate.source === item.source);
			const exactSource = exactPair ?? unloadCatalog.catalog.items.find((candidate) => candidate.source === item.source);
			const catalogItem = exactSource ?? (await findCatalogItemForSource(unloadCatalog.catalog.items, item.source, settingsDir));
			if (catalogItem) unloadSelectionByRowId.set(item.rowId, { id: catalogItem.id, source: catalogItem.source });
		}
	}
	const childToParentRowId = new Map<string, string>();
	const childrenByParentRowId = new Map<string, string[]>();
	for (const pickerItem of pickerItems) {
		if (!pickerItem.parentId) continue;
		childToParentRowId.set(pickerItem.id, pickerItem.parentId);
		const children = childrenByParentRowId.get(pickerItem.parentId) ?? [];
		children.push(pickerItem.id);
		childrenByParentRowId.set(pickerItem.parentId, children);
	}
	function resolveRemoveIds(ids: string[]): string[] {
		const resolved: string[] = [];
		const seen = new Set<string>();
		for (const id of ids) {
			const target = childToParentRowId.get(id) ?? id;
			if (seen.has(target)) continue;
			seen.add(target);
			resolved.push(target);
		}
		return resolved;
	}
	// Complete known child groups normalize to their parent package row for whole-package unload;
	// partial groups and unknown ids are preserved so the confirmation refuses them explicitly.
	function resolveUnloadIds(ids: string[]): string[] {
		const selected = new Set(ids);
		const resolved: string[] = [];
		const seen = new Set<string>();
		const push = (id: string) => {
			if (seen.has(id)) return;
			seen.add(id);
			resolved.push(id);
		};
		for (const id of ids) {
			const parentId = childToParentRowId.get(id);
			if (!parentId) {
				push(id);
				continue;
			}
			const children = childrenByParentRowId.get(parentId) ?? [];
			if (children.length > 0 && children.every((childId) => selected.has(childId))) push(parentId);
			else push(id);
		}
		return resolved;
	}
	const pickerResult = await pick(ctx, dashboardPickerTitle(packages), pickerItems, {
		titleBold: false,
		subtitle: dashboardPickerSubtitle(packages, projectMetadataMissing),
		confirmHint: "Enter applies/runs",
		filterLabel: "Filter",
		filterHint: "type to narrow",
		filterHintInline: true,
		colorRowsByState: true,
		footerHint: "  Space select/toggle · Enter apply/run · → unfold known package resources · ← fold · Alt+I details · Ctrl+Alt+R removes whole package · Ctrl+U unloads library package · Esc cancel\n  parent Space: all → [-] active → [+] inactive/available → none · [~] mixed state · [*] custom selection",
		actions: { remove: true, unload: true },
		resolveRemoveIds: resolveRemoveIds,
		resolveUnloadIds: resolveUnloadIds,
		inspect: (focusedItem) => {
			const packageItem = packages.find((item): item is DashboardPackage => item.type === "package" && item.rowId === focusedItem.id);
			return packageItem ? packageResourceInspection(packageItem, sessionPackageResources) : undefined;
		},
		removeConfirmation: (ids) => removeConfirmationFor(packages, ids),
		unloadConfirmation: (ids) => unloadConfirmationFor(packages, ids, unloadSelectionByRowId),
		submitConfirmation: (ids, action, changedIds) => {
			if (action !== "confirm") return undefined;
			const plans = packageResourceFilterPlans(packages, sessionPackageResources, ids, changedIds, declarations);
			if (plans.length > 0) {
				const foreign = dashboardForeignOrdinarySelections(packages, new Set(ids), new Set(plans.map((plan) => plan.item.rowId)));
				if (foreign.count > 0) return { ...dashboardMixedSelectionRefusal(foreign), canSubmit: false, confirmHint: "Esc to return · split child filters from package/direct/saved actions" };
			}
			return packageResourceFilterConfirmation(plans) ?? disableConfirmationFor(packages, ids);
		},
		onSubmit: async (ids, update, signal, submitAction, changedIds) => {
			const selected = new Set(ids);
			const packageItems = packages.filter((item): item is DashboardPackage => item.type === "package");
			const directItems = packages.filter((item): item is DashboardDirectResource => item.type === "direct");
			if (submitAction === "unload") {
				// Repeat normalization + eligibility validation at apply, not only in the picker.
				const normalizedIds = resolveUnloadIds(ids);
				const unknown = normalizedIds.filter((id) => !unloadSelectionByRowId.has(id));
				if (unknown.length > 0) {
					return {
						title: "Unload selection needs re-review",
						lines: [
							"Some selected rows are not complete, catalog-backed package groups; unload was not applied.",
							"Select whole package groups (parent Space) and deselect direct, saved, override, Unloaded, or unknown rows.",
							"No files were changed.",
						],
					};
				}
				const eligible = unloadEligiblePackages(packages, normalizedIds, unloadSelectionByRowId);
				if (eligible.length === 0) {
					return { title: "Construct unload not applied", lines: ["No eligible library package rows remained after re-reading this project.", "No files were changed."] };
				}
				const reviewed = normalizedIds.map((id) => unloadSelectionByRowId.get(id)).filter((selection): selection is UnloadSelection => selection !== undefined);
				if (reviewed.length === 0) {
					return { title: "Construct unload not applied", lines: ["No reviewed catalog entries were found for the selected rows.", "No files were changed."] };
				}
				// Fresh ordinary-vs-autoload:false validation runs inside the shared helper after its idle
				// wait and before any write; any override in the batch refuses the whole batch.
				const validate = async (): Promise<{ refusal?: string; error?: string } | undefined> => {
					let declarations: DeclarationEntry[];
					try {
						const state = await freshProjectState(ctx);
						const settingsRead = state.inventory.reads.projectSettings;
						if (settingsRead.state === "invalid") return { error: "This project's .pi/settings.json could not be read; re-review before unload." };
						if (settingsRead.state === "ok" && !isObject(settingsRead.data)) return { error: "This project's .pi/settings.json is not a JSON object; re-review before unload." };
						declarations = await packageDeclarationEntries(state.inventory);
					} catch (error) {
						return { error: `Could not re-read this project's settings; re-review before unload. (${error instanceof Error ? error.message : String(error)})` };
					}
					const settingsDir = dirname(paths.projectSettingsPath);
					const overrideSources: string[] = [];
					for (const selection of reviewed) {
						const matched = await matchingDeclarations(declarations, selection.source, settingsDir);
						if (matched.some((entry) => entry.summary.projectOverride)) overrideSources.push(selection.source);
					}
					if (overrideSources.length > 0) {
						return { refusal: `Re-review required: ${overrideSources.length} selected source${overrideSources.length === 1 ? " is" : "s are"} now a Pi project override (autoload:false). Deselect or manage with pi config -l.` };
					}
					return undefined;
				};
				const unloadResult = await unloadConstructSources(ctx, reviewed, { signal, progress: update, validate });
				if (!unloadResult) return { title: "Construct unload cancelled", lines: ["No files were changed."] };
				if (unloadResult.refusal) return { title: "Construct unload needs re-review", lines: [unloadResult.refusal, "No files were changed."] };
				if (unloadResult.error) {
					return {
						title: "Construct unload failed",
						lines: [
							`Construct library removed: ${unloadResult.removed.length}`,
							`Current project Construct metadata removed: ${unloadResult.metadataRemoved}`,
							`! ${unloadResult.error}`,
							unloadResult.indexUpdated ? "Known-project index was updated before the failure." : undefined,
							...unloadResult.warnings.map((warning) => `! ${warning}`),
						].filter((line): line is string => line !== undefined),
					};
				}
				const activeLine = unloadResult.activeRemaining === undefined
					? "Project declarations were not read; .pi/settings.json was left unchanged."
					: unloadResult.activeRemaining > 0
						? unloadResult.trustSkipped
							? `Still declared in this project: ${unloadResult.activeRemaining} (current-project metadata was not updated).`
							: unloadResult.metadataCleanupFailed
								? `Still declared in this project: ${unloadResult.activeRemaining} (current-project metadata cleanup was incomplete).`
								: `Still declared in this project: ${unloadResult.activeRemaining} (may be disabled or unresolved; shown as Unloaded on reopen).`
						: "No selected sources are still declared in this project.";
				const trustLine = unloadResult.trustSkipped
					? unloadResult.indexUpdated
						? "Known-project index was updated; current-project Construct metadata was not updated (project not trusted)."
						: "Project is not trusted by Pi; current-project metadata and known-project index were not updated."
					: undefined;
				const hadWrites = unloadResult.removed.length > 0 || unloadResult.indexUpdated || unloadResult.metadataRemoved > 0;
				return {
					title: unloadResult.cancelled ? (hadWrites ? "Construct unload cancelled after partial changes" : "Construct unload cancelled") : "Construct unload complete",
					confirmHint: "Press Enter/Esc to return to session",
					lines: [
						`Construct library removed: ${unloadResult.removed.length}`,
						`Current project Construct metadata removed: ${unloadResult.metadataRemoved}`,
						unloadResult.indexUpdated && !unloadResult.trustSkipped ? "Known-project index updated." : undefined,
						trustLine,
						activeLine,
						...unloadResult.missing.map((entry) => `! ${entry}`),
						...unloadResult.warnings.map((warning) => `! ${warning}`),
						unloadResult.cancelled && hadWrites ? "Cancelled after some writes; remaining writes were skipped." : undefined,
						"No /reload needed; unload does not uninstall, disable, or edit .pi/settings.json.",
					].filter((line): line is string => line !== undefined),
				};
			}
			const selectedSaved = submitAction === "confirm" ? packages.filter((item): item is DashboardSavedLoadout => item.type === "saved" && !item.disabled && selected.has(item.rowId)) : [];
			const resourcePlans = submitAction === "confirm" ? packageResourceFilterPlans(packages, sessionPackageResources, ids, changedIds, declarations) : [];
			if (resourcePlans.length > 0) {
				const planParentIds = new Set(resourcePlans.map((plan) => plan.item.rowId));
				const foreign = dashboardForeignOrdinarySelections(packages, selected, planParentIds);
				if (foreign.count > 0) return { ...dashboardMixedSelectionRefusal(foreign), confirmHint: "Press Enter/Esc to return" };

				const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Package Resources", update, signal);
				if (!ready) return { title: "Package resource update cancelled", lines: ["No files were changed."] };

				const failures: string[] = [];
				const applyWarnings: string[] = [];
				const refused: string[] = [];
				const trustLost: string[] = [];
				const installedWithoutFilters: string[] = [];
				const status = new Map<string, PackageResourcePlanStatus>();
				const succeeded = new Set<string>();
				let needsReload = false;
				let mutatorAttempted = false;
				const settingsDir = dirname(paths.projectSettingsPath);
				const step = () => update("Applying package resource filters", packageResourceProgressLines(resourcePlans, status, failures, applyWarnings, refused, installedWithoutFilters));
				const finish = (rowId: string, state: PackageResourcePlanStatus) => {
					status.set(rowId, state);
					step();
				};
				update("Applying package resource filters", packageResourceProgressLines(resourcePlans, status));
				for (let plan of resourcePlans) {
					if (signal.aborted) break;
					if (!ctx.isProjectTrusted()) {
						trustLost.push(`${plan.item.label}: project is no longer trusted; reviewed filters were not applied.`);
						finish(plan.item.rowId, "warn");
						continue;
					}
					let filterSource = plan.item.source;
					let metadataId = plan.item.managed ? plan.item.id : undefined;
					let installedThisPlan = false;
					if (plan.item.section === "Available") {
						// Available: the source must still be undeclared before Construct installs on its behalf.
						const beforeInstall = await freshProjectState(ctx);
						applyWarnings.push(...beforeInstall.resources.warnings);
						const appeared = await matchingDeclarations(await packageDeclarationEntries(beforeInstall.inventory), plan.item.source, settingsDir);
						if (appeared.length > 0) {
							refused.push(`${plan.item.label}: a package declaration appeared since this review; install and reviewed filters were not applied. Reopen /construct to re-review.`);
							finish(plan.item.rowId, "warn");
							continue;
						}
						if (signal.aborted) break;
						const trustedBeforeInstall = ctx.isProjectTrusted();
						if (!trustedBeforeInstall) {
							trustLost.push(`${plan.item.label}: project is no longer trusted; no install or filters were applied.`);
							finish(plan.item.rowId, "warn");
							continue;
						}
						mutatorAttempted = true;
						const load = await loadPackageIntoProject(paths, {
							source: plan.item.source,
							item: { id: plan.item.id, kind: "package", source: plan.item.source },
						}, { projectTrusted: trustedBeforeInstall, quietPackageInstallOutput: ctx.mode === "tui" });
						if (load.needsReload) needsReload = true;
						if (!load.ok) {
							failures.push(`${plan.item.label}: install failed: ${load.error ?? load.stderr ?? `exit ${load.exitCode ?? "unknown"}`}`);
							finish(plan.item.rowId, "fail");
							continue;
						}
						filterSource = load.declaredSource ?? plan.item.source;
						metadataId = load.itemId ?? metadataId;
						installedThisPlan = true;
						// Trust is re-read immediately after the install, before inspecting the installed declaration.
						if (!ctx.isProjectTrusted()) {
							installedWithoutFilters.push(`${plan.item.label}: installed, but project is no longer trusted; reviewed filters were not applied. Re-review and reload.`);
							needsReload = true;
							finish(plan.item.rowId, "warn");
							continue;
						}
						const rechecked = await recheckInstalledPackageResourcePlan(ctx, plan.item, plan.resources, plan.selectedResourceKeys, filterSource, metadataId);
						applyWarnings.push(...rechecked.warnings);
						const policy = await installedDeclarationPolicy(rechecked.declarations, filterSource, settingsDir);
						if (policy !== "ok") {
							const detail = policy === "missing" ? "declaration not found" : policy === "project-override" ? "autoload:false override" : policy === "partial-filters" ? "partial filters" : policy === "whole-package-disabled" ? "whole-package-disabled filters" : policy === "invalid" ? "invalid declaration" : "unexpected declaration policy";
							installedWithoutFilters.push(`${plan.item.label}: installed without reviewed filters (${detail}); re-review and reload.`);
							needsReload = true;
							finish(plan.item.rowId, "warn");
							continue;
						}
						if (!rechecked.plan) {
							// Installed, but Pi resolved no package resources: stop rather than applying the stale cached plan.
							installedWithoutFilters.push(`${plan.item.label}: installed, but Pi did not resolve package resources; reviewed filters were not applied. Re-review and reload.`);
							needsReload = true;
							finish(plan.item.rowId, "warn");
							continue;
						}
						const installDrift = packageResourceStateDrift(plan.resources, rechecked.resources ?? []);
						if (installDrift.missing.length > 0 || installDrift.changed.length > 0 || installDrift.added.length > 0) {
							installedWithoutFilters.push(`${plan.item.label}: installed without reviewed filters (resources changed after install: ${installDrift.missing.length} missing, ${installDrift.changed.length} state change${installDrift.changed.length === 1 ? "" : "s"}, ${installDrift.added.length} added); re-review and reload.`);
							needsReload = true;
							finish(plan.item.rowId, "warn");
							continue;
						}
						plan = rechecked.plan;
					} else {
						// Per-target re-read immediately before this write: an earlier install/writer must not bless a later target.
						const fresh = await freshProjectState(ctx);
						applyWarnings.push(...fresh.resources.warnings);
						const freshSignatures = packageDeclarationSignatures(plan.item, await packageDeclarationEntries(fresh.inventory));
						if (declarationPolicyChanged(plan.declarationBaselines, freshSignatures)) {
							refused.push(`${plan.item.label}: package declaration policy changed since this review; reviewed filters were not applied. Reopen /construct to re-review.`);
							finish(plan.item.rowId, "warn");
							continue;
						}
						const drift = packageResourceStateDrift(plan.resources, resourcesForPackage(plan.item, fresh.resources));
						if (drift.missing.length > 0 || drift.changed.length > 0 || drift.added.length > 0) {
							refused.push(`${plan.item.label}: package resources changed since this review (${drift.missing.length} missing, ${drift.changed.length} state change${drift.changed.length === 1 ? "" : "s"}, ${drift.added.length} added); reviewed filters were not applied. Reopen /construct to re-review.`);
							finish(plan.item.rowId, "warn");
							continue;
						}
					}
					if (signal.aborted) {
						// Esc after a resolution/install must not proceed to a write; report an install accurately.
						if (installedThisPlan) {
							installedWithoutFilters.push(`${plan.item.label}: installed, but the submit was cancelled before reviewed filters were applied. Re-review and reload.`);
							needsReload = true;
							finish(plan.item.rowId, "warn");
						}
						break;
					}
					const trustedBeforeWrite = ctx.isProjectTrusted();
					if (!trustedBeforeWrite) {
						if (installedThisPlan) {
							installedWithoutFilters.push(`${plan.item.label}: installed, but project is no longer trusted; reviewed filters were not applied. Re-review and reload.`);
							needsReload = true;
						} else {
							trustLost.push(`${plan.item.label}: project is no longer trusted; reviewed filters were not applied.`);
						}
						finish(plan.item.rowId, "warn");
						continue;
					}
					mutatorAttempted = true;
					const result = await setPackageResourceFiltersInProject(paths, { source: filterSource, id: metadataId, filters: plan.filters, selectedCount: plan.selectedCount }, { projectTrusted: trustedBeforeWrite });
					if (result.needsReload) needsReload = true;
					if (!result.ok) {
						failures.push(`${plan.item.label}: ${plan.item.section === "Available" ? "installed but filter update failed" : "filter update failed"}: ${result.error ?? "unknown error"}`);
						finish(plan.item.rowId, "fail");
					} else {
						succeeded.add(plan.item.rowId);
						finish(plan.item.rowId, "done");
					}
				}
				const changed = succeeded.size;
				const installedWithFilters = resourcePlans.filter((plan) => plan.item.section === "Available" && succeeded.has(plan.item.rowId));
				const updatedWithFilters = resourcePlans.filter((plan) => plan.item.section !== "Available" && succeeded.has(plan.item.rowId));
				const notApplied = refused.length + trustLost.length;
				return {
					title: installedWithoutFilters.length > 0 ? "Installed without reviewed filters"
						: signal.aborted
							? changed > 0 || mutatorAttempted ? "Package resource update cancelled after partial changes" : "Package resource update cancelled"
							: changed === 0 && trustLost.length > 0 ? "Project not trusted"
								: notApplied > 0 ? "Package resource update needs re-review"
									: failures.length > 0 ? "Package resource filters applied with errors"
										: "Package resource filters applied",
					confirmHint: needsReload ? "Press Enter to reload Pi · Esc cancels reload" : "Press Enter/Esc to return to session",
					confirmAction: needsReload ? "reload" : undefined,
					lines: [
						signal.aborted ? "Cancelled before remaining changes." : undefined,
						!mutatorAttempted ? "No files were changed." : undefined,
						installedWithFilters.length > 0 ? `Installed with selected resources: ${installedWithFilters.length}` : undefined,
						...installedWithFilters.map((plan) => `+ ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources enabled`),
						updatedWithFilters.length > 0 ? `Updated package filters: ${updatedWithFilters.length}` : undefined,
						...updatedWithFilters.map((plan) => `+ ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources enabled after apply`),
						applyWarnings.length > 0 ? `Warnings: ${applyWarnings.length}` : undefined,
						...applyWarnings.map((warning) => `! ${warning}`),
						installedWithoutFilters.length > 0 ? `Installed without reviewed filters: ${installedWithoutFilters.length}` : undefined,
						...installedWithoutFilters.map((message) => `~ ${message}`),
						trustLost.length > 0 ? `Trust changed (not applied): ${trustLost.length}` : undefined,
						...trustLost.map((message) => `? ${message}`),
						refused.length > 0 ? `Not applied (re-review): ${refused.length}` : undefined,
						...refused.map((refusal) => `? ${refusal}`),
						failures.length > 0 ? `Failures: ${failures.length}` : undefined,
						...failures.map((failure) => `! ${failure}`),
						needsReload ? "Reload Pi to use the updated package resource filters." : undefined,
					].filter((line): line is string => line !== undefined),
				};
			}
			const steps: DashboardStep[] = [];
			const scheduled = new Set<string>();
			function addStep(action: DashboardAction, item: DashboardOperationItem): void {
				const key = `${action}:${item.source}`;
				if (scheduled.has(key)) return;
				scheduled.add(key);
				steps.push({ action, item, state: "pending" });
			}
			for (const item of packageItems) {
				if (item.disabled || !selected.has(item.rowId)) continue;
				const action = actionForSubmit(submitAction, item);
				if (action) addStep(action, operationFromPackage(item));
			}
			for (const item of directItems) {
				if (item.disabled || !selected.has(item.rowId)) continue;
				const action = actionForSubmit(submitAction, item);
				if (action) addStep(action, operationFromDirect(item));
			}
			const savedAllOff: string[] = [];
			const savedUnresolved: string[] = [];
			const savedOverrides: string[] = [];
			for (const saved of selectedSaved) {
				for (const source of saved.sources) {
					// Override precedence matches /construct run: autoload:false deltas are read-only and are
					// never fed into the enable/install policy, whatever their filter shape looks like.
					const overrideRow = packageItems.find((item) => item.section === "Overrides" && packageMatchesSource(item, source));
					const matchingPackage = overrideRow ?? findPackageForSavedSource(packageItems, source);
					const decision = matchingPackage ? savedSourceDecision(dashboardSavedSourceRow(matchingPackage)) : "install";
					if (decision === "install" || decision === "enable") {
						addStep(decision === "install" ? "Install" : "Enable", matchingPackage ? operationFromPackage(matchingPackage) : operationFromSource(source));
					} else if (decision === "all-off") savedAllOff.push(source);
					else if (decision === "unresolved") savedUnresolved.push(source);
					else if (decision === "override") savedOverrides.push(source);
				}
			}
			if (steps.length === 0) {
				const blockedPartialPackages = submitAction === "confirm" ? packageItems.filter((item) => !item.disabled && selected.has(item.rowId) && packageWholeToggleBlocked(item)) : [];
				const effectivelyOffPackages = submitAction === "confirm" ? packageItems.filter((item) => !item.disabled && selected.has(item.rowId) && item.section === "Disabled" && !packageWholeToggleBlocked(item) && item.filterState !== "whole-package-disabled") : [];
				if (selectedSaved.length > 0) {
					return {
						title: savedAllOff.length + savedUnresolved.length + savedOverrides.length > 0 ? "Saved loadout made no changes" : "Saved loadout already active",
						lines: [
							`Selected saved loadouts: ${selectedSaved.length}`,
							"No package changes were needed in this project.",
							...savedOverrides.map((source) => `↔ ${source} — Pi project override (autoload:false); manage with pi config -l`),
							...savedAllOff.map((source) => `– ${source} — all resolved resources are off; use pi config -l to enable specific resources`),
							...savedUnresolved.map((source) => `? ${source} — Pi resolved no package resources; inspect the declaration with pi config -l`),
							"Saved loadouts are activate-only; nothing was disabled, removed, or exact-matched.",
						],
					};
				}
				return { title: blockedPartialPackages.length > 0 ? "Filtered package row not toggled" : effectivelyOffPackages.length > 0 ? "Package resources not changeable here" : "No Construct changes selected", lines: noChangeLines(submitAction, blockedPartialPackages, effectivelyOffPackages) };
			}

			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Loadout", update, signal);
			if (!ready) {
				return { title: "Construct Loadout cancelled", lines: ["No files were changed."] };
			}

			const outcome = await runConstructOperationSteps({
				ctx,
				paths,
				steps,
				update,
				signal,
				progressTitle: "Applying Construct Loadout",
				completeLabel: "changes",
			});

			const byAction = (action: DashboardAction) => outcome.completed.filter((step) => step.action === action).map((step) => step.item);
			const installed = byAction("Install");
			const enabled = byAction("Enable");
			const disabled = byAction("Disable");
			const removed = byAction("Remove");
			const hasErrors = outcome.failures.length > 0 || outcome.partialRuntimeChanges.length > 0;
			return {
				title: outcome.cancelled
					? outcome.appliedChanges > 0
						? "Construct Loadout cancelled after partial changes"
						: "Construct Loadout cancelled"
					: hasErrors
						? "Construct Loadout applied with errors"
						: "Construct Loadout changes applied",
				confirmHint: outcome.needsReload ? "Press Enter to reload Pi · Esc cancels reload" : "Press Enter/Esc to return to session",
				confirmAction: outcome.needsReload ? "reload" : undefined,
				lines: [
					outcome.cancelled ? "Cancelled before remaining changes." : undefined,
					selectedSaved.length > 0 ? `Saved loadouts selected: ${selectedSaved.map((item) => item.label).join(", ")}` : undefined,
					selectedSaved.length > 0 ? "Recipe mode: activate-only; non-recipe and already-active resources were left untouched." : undefined,
					installed.length > 0 ? `Installed into project: ${installed.length}` : undefined,
					...installed.map((item) => `+ ${item.label}: ${item.source}`),
					enabled.length > 0 ? `Enabled: ${enabled.length}` : undefined,
					...enabled.map((item) => `+ ${item.label}: ${item.source}`),
					...savedOverrides.map((source) => `↔ ${source} — Pi project override (autoload:false); manage with pi config -l`),
					...savedAllOff.map((source) => `– ${source} — all resolved resources are off; use pi config -l to enable specific resources`),
					...savedUnresolved.map((source) => `? ${source} — Pi resolved no package resources; inspect the declaration with pi config -l`),
					disabled.length > 0 ? `Disabled: ${disabled.length}` : undefined,
					...disabled.map((item) => `- ${item.label}: ${item.source}`),
					removed.length > 0 ? `Removed from project: ${removed.length}` : undefined,
					...removed.map((item) => `- ${item.label}: ${item.source}`),
					outcome.partialRuntimeChanges.length > 0 ? `Resource settings changed, but Construct metadata failed: ${outcome.partialRuntimeChanges.length}` : undefined,
					...outcome.partialRuntimeChanges.map((change) => `! ${change.action} ${change.item.label}: ${change.error}`),
					outcome.partialRuntimeChanges.length > 0 ? "Run /construct status to inspect drift." : undefined,
					outcome.failures.length > 0 ? `Failures: ${outcome.failures.length}` : undefined,
					...outcome.failures.map((failure) => `! ${failure}`),
				].filter((line): line is string => line !== undefined),
			};
		},
	});
	if (!pickerResult) {
		showText(ctx, "Construct dashboard closed. No files were changed.");
		return;
	}
	if (pickerResult.closeAction === "confirm" && pickerResult.confirmAction === "reload") {
		await ctx.reload();
	}
}
