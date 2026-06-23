import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, DirectResourceKind, DirectResourceSummary } from "../types.js";
import { deriveId } from "../catalog.js";
import { collectProjectPackageResources, collectTemporaryPackageResourcesForSources, type PackageResourceInventory, type PackageResourceSummary } from "../package-resources.js";
import { collectProjectInventory } from "../project-inventory.js";
import { savedLoadoutSources, uniqueSorted } from "../saved-loadouts.js";
import { formatPackageSourceLabel } from "../sources.js";
import { CONSTRUCT_TITLE } from "../metadata.js";
import { directResourceKinds, resourcePlural } from "../resources.js";
import { packageResourceFilterKeys, type PackageResourceFilterKey } from "../package-filters.js";
import { loadPackageIntoProject, setPackageResourceFiltersInProject } from "../package-ops.js";
import { runConstructOperationSteps, type ConstructOperationAction, type ConstructOperationItem, type ConstructOperationStep } from "../operation-runner.js";
import { pickCheckboxes, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerConfirmation, type CheckboxPickerItem, type CheckboxPickerSubmitAction, type CheckboxPickerTone } from "../ui.js";

type DashboardSection = "Saved" | "Active" | "Disabled" | "Available" | "Unloaded";
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

const dashboardSections: DashboardSection[] = ["Saved", "Active", "Disabled", "Available", "Unloaded"];

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
	const counts: Record<PackageDashboardSection, number> = { Active: 0, Disabled: 0, Available: 0, Unloaded: 0 };
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
			counts.Available > 0 ? countLabel(counts.Available, "available") : undefined,
			counts.Unloaded > 0 ? countLabel(counts.Unloaded, "unloaded") : undefined,
		]
			.filter((part): part is string => part !== undefined)
			.join(" · "),
		relatedIds,
	};
}

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardItem[]; warnings: string[]; projectMetadataMissing: boolean; packageResources?: PackageResourceInventory; inventory: Awaited<ReturnType<typeof collectProjectInventory>> }> {
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

	for (const managed of inventory.managedPackages) {
		const item = managed.metadata;
		const source = managed.source;
		const drift = managed.drift;
		const missingDeclarationDrift = !managed.declared && item.enabled !== undefined;
		if (drift) warnings.push(`${item.id} drift: ${drift}`);
		const packageDescription = managed.declared
			? managed.filterState === "partially-filtered"
				? "Filtered package. Construct will not replace partial Pi filters with whole-package toggles; r removes."
				: managed.disabledByFilters
					? "Disabled package. Enter enables the whole package; r removes."
					: "Active package. Enter disables the whole package; r removes."
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
			matchSources: uniqueSorted(pkg.matchSources),
			description: pkg.filterState === "partially-filtered" ? "Read-only filtered package. Run /construct load to adopt it." : "Read-only package. Run /construct load to adopt it.",
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
				: `Read-only ${resource.kind}. Run /construct load to adopt it.`,
		});
	}

	const packageRows = packages.filter((item): item is DashboardPackage => item.type === "package");
	for (const saved of packages.filter((item): item is DashboardSavedLoadout => item.type === "saved")) {
		const summary = savedLoadoutMemberSummary(saved.sources, packageRows);
		saved.value = summary.value;
		saved.relatedIds = summary.relatedIds;
		if (saved.sources.length > 0) {
			saved.description = `Loadout recipe: ${summary.value}. Enter runs; Space selects recipe items.`;
		}
	}

	const packageResources = ctx.mode === "tui" ? await collectProjectPackageResources(ctx, inventory) : undefined;
	warnings.push(...(packageResources?.warnings ?? []));
	sortDashboardPackages(packages);
	return { paths, packages, warnings, projectMetadataMissing, packageResources, inventory };
}

function dashboardCounts(packages: DashboardItem[]): { active: number; disabled: number; available: number; unloaded: number } {
	const resources = packages.filter((item) => item.section !== "Saved");
	return {
		active: resources.filter((item) => item.section === "Active").length,
		disabled: resources.filter((item) => item.section === "Disabled").length,
		available: resources.filter((item) => item.section === "Available").length,
		unloaded: resources.filter((item) => item.section === "Unloaded").length,
	};
}

function dashboardSummary(packages: DashboardItem[]): string {
	const counts = dashboardCounts(packages);
	return `${counts.active} active · ${counts.disabled} disabled · ${counts.available} available · ${counts.unloaded} unloaded`;
}

function dashboardPickerTitle(_packages: DashboardItem[]): string {
	return CONSTRUCT_TITLE;
}

function dashboardPickerSubtitle(packages: DashboardItem[], projectMetadataMissing: boolean): string {
	const counts = dashboardCounts(packages);
	return `${counts.active} active | ${counts.disabled} disabled | ${counts.available} available | ${counts.unloaded} unloaded${projectMetadataMissing ? " | no Construct metadata yet" : ""}`;
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
	if (section === "Available") return "warning";
	if (section === "Saved") return "accent";
	return "muted";
}

function stateIcon(section: DashboardSection): string {
	if (section === "Saved") return "◆";
	if (section === "Active") return "✓";
	if (section === "Disabled") return "–";
	if (section === "Unloaded") return "◇";
	return "+";
}

function stateLabel(section: DashboardSection): string {
	if (section === "Unloaded") return "Unloaded";
	return section;
}

function selectionMarker(item: DashboardItem): string {
	return item.section === "Unloaded" ? "[!]" : item.disabled ? "   " : "[ ]";
}

function dashboardLine(item: DashboardItem, labelWidth: number): string {
	const paddedLabel = item.label + " ".repeat(Math.max(0, labelWidth - item.label.length));
	const value = item.type === "package" ? item.displaySource : item.value;
	return `${selectionMarker(item)} ${stateIcon(item.section)}  ${paddedLabel}  ${value}`;
}

function dashboardFooterHint(packages: DashboardItem[], projectMetadataMissing: boolean): string {
	const counts = dashboardCounts(packages);
	if (projectMetadataMissing && counts.unloaded > 0) return "No Construct metadata yet. Run /construct load to adopt unloaded project resources.";
	if (projectMetadataMissing && counts.available > 0) return "No Construct metadata yet. Select Available rows to install remembered packages, or run /construct load after installing project resources.";
	if (projectMetadataMissing) return "No Construct metadata yet. Install a Pi package normally, then run /construct load.";
	if (counts.unloaded > 0) return "Run /construct load to add unloaded resources to the Construct.";
	if (counts.available > 0) return "Select Available rows and press Enter to install them into this project.";
	if (counts.active + counts.disabled > 0) return "Select Active or Disabled rows and press Enter to toggle them.";
	return "Install a Pi package normally, then run /construct load to remember it.";
}

function dashboardText(paths: ConstructPaths, packages: DashboardItem[], warnings: string[], projectMetadataMissing: boolean): string {
	const lines: string[] = [CONSTRUCT_TITLE, "=".repeat(CONSTRUCT_TITLE.length), `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	const labelWidth = Math.min(28, Math.max(...packages.map((item) => item.label.length), 0));
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		if (section === "Saved" && sectionItems.length === 0) continue;
		const label = sectionLabel(section);
		lines.push(label, "-".repeat(label.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => dashboardLine(item, labelWidth)) : ["- none"]), "");
	}
	if (warnings.length > 0) lines.push(...warnings.map((warning) => `! ${warning}`), "");
	lines.push(
		"Legend: [ ] selectable · [x] selected · [·] recipe item · [!] read-only · ◆ saved · ✓ active · – disabled · + available · ◇ unloaded.",
		"Space selects · on Loadouts, selects recipe items · Enter applies/runs · → inspects/unfolds package resources · ← folds · i details · r removes selected from project · Esc cancels.",
		"",
		dashboardFooterHint(packages, projectMetadataMissing),
	);
	return lines.join("\n");
}

function actionForSubmit(action: CheckboxPickerSubmitAction, item: DashboardItem): DashboardAction | undefined {
	if (item.type !== "package" && item.type !== "direct") return undefined;
	if (action === "confirm") {
		if (item.type === "package" && item.section === "Available") return "Install";
		if (item.section === "Active") return "Disable";
		if (item.section === "Disabled") return "Enable";
		return undefined;
	}
	if (action === "remove" && item.type === "package") return item.section === "Active" || item.section === "Disabled" ? "Remove" : undefined;
	return undefined;
}

function noChangeLines(action: CheckboxPickerSubmitAction): string[] {
	if (action === "confirm") return ["No Construct changes were selected.", "Select Saved, Active, Disabled, or Available rows, then press Enter.", "Unloaded rows are read-only here; use /construct load to load/adopt them into Construct."];
	return [
		"No active or disabled project packages were selected to remove.",
		"Select Active or Disabled package rows, then press r.",
		"Package-contained child resources are filtered, not removed: use Space then Enter to write package filters.",
		"Available packages are not installed in this project; use /construct unload to forget them from the Construct library.",
		"Unloaded resources are read-only here; remove them with Pi directly if needed.",
	];
}

function removablePackages(packages: DashboardItem[], ids: string[]): DashboardPackage[] {
	const selected = new Set(ids);
	return packages.filter((item): item is DashboardPackage => item.type === "package" && selected.has(item.rowId) && (item.section === "Active" || item.section === "Disabled"));
}

function removeConfirmationFor(packages: DashboardItem[], ids: string[]): CheckboxPickerConfirmation | undefined {
	const removable = removablePackages(packages, ids);
	if (removable.length === 0) return undefined;
	const preview = removable.slice(0, 8).map((item) => `- ${item.label}: ${item.source}`);
	const extra = removable.length > preview.length ? [`…and ${removable.length - preview.length} more`] : [];
	return {
		title: `Remove ${removable.length} package${removable.length === 1 ? "" : "s"} from this project?`,
		confirmHint: "Press Enter to remove from project · Esc cancels",
		lines: [
			`This will run project-local \`pi remove\` for ${removable.length} selected package${removable.length === 1 ? "" : "s"}.`,
			"It edits this project's .pi/settings.json after creating a backup.",
			"It also removes matching project Construct metadata so this project does not keep stale drift.",
			"It does not delete global Pi package caches or saved loadout recipes.",
			"Saved recipes are deleted with /construct wipe <name>, not with a remove command.",
			"",
			...preview,
			...extra,
		],
	};
}

function disableConfirmationFor(packages: DashboardItem[], ids: string[]): CheckboxPickerConfirmation | undefined {
	const selected = new Set(ids);
	const disableTargets = packages.filter((item): item is DashboardPackage | DashboardDirectResource => (item.type === "package" || item.type === "direct") && selected.has(item.rowId) && item.section === "Active");
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
	return item.source === source || item.matchSources.includes(source);
}

function packageStateRank(section: PackageDashboardSection): number {
	if (section === "Active") return 0;
	if (section === "Disabled") return 1;
	if (section === "Unloaded") return 2;
	return 3;
}

function findPackageForSavedSource(packages: DashboardPackage[], source: string): DashboardPackage | undefined {
	return packages.filter((item) => packageMatchesSource(item, source)).sort((a, b) => packageStateRank(a.section) - packageStateRank(b.section))[0];
}

function actionForSavedSource(item: DashboardPackage | undefined): DashboardAction | undefined {
	// Saved loadout rows are activate-only: install missing sources, enable disabled sources, and never disable/remove anything.
	if (!item) return "Install";
	if (item.section === "Active") return undefined;
	if (item.section === "Disabled") return "Enable";
	if (item.section === "Available") return "Install";
	return item.disabledByFilters ? "Enable" : undefined;
}

function resourceMatchesPackage(resource: PackageResourceSummary, item: DashboardPackage): boolean {
	return (
		resource.packageManagedId === item.id ||
		item.matchSources.includes(resource.packageSource) ||
		(resource.packageNormalizedSource !== undefined && item.matchSources.includes(resource.packageNormalizedSource))
	);
}

function resourcesForPackage(item: DashboardPackage, packageResources: PackageResourceInventory | undefined): PackageResourceSummary[] {
	return packageResources?.resources.filter((resource) => resourceMatchesPackage(resource, item)) ?? [];
}

const packageFilterKeyForKind: Record<DirectResourceKind, PackageResourceFilterKey> = {
	extension: "extensions",
	skill: "skills",
	prompt: "prompts",
	theme: "themes",
};

function packageResourceChildRowId(item: DashboardPackage, resource: PackageResourceSummary): string {
	return rowId("package-resource", item.rowId, resource.kind, resource.packageRelativePath);
}

function resourceLabel(resource: PackageResourceSummary): string {
	return `${resourcePlural(resource.kind).slice(0, -1)} ${resource.name}`;
}

function packageResourceInspection(item: DashboardPackage, packageResources: PackageResourceInventory | undefined): CheckboxPickerConfirmation {
	const resources = resourcesForPackage(item, packageResources);
	if (item.section === "Available" && resources.length === 0) {
		return {
			title: `Package resources: ${item.label}`,
			confirmHint: "Press Enter/Esc to return",
			lines: [
				"This Available package has not been inspected yet.",
				"Press Right Arrow on the package row to ask Pi to resolve package-contained resources.",
				"For git or npm sources, that inspection may clone/cache the package before showing results.",
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
			lines.push(`- ${resource.enabled ? "[x]" : "[ ]"} ${resource.name} — ${resource.packageRelativePath}`);
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
			children.push({
				id: packageResourceChildRowId(item, resource),
				parentId: item.rowId,
				depth: 1,
				label: resourceLabel(resource),
				value: resource.packageRelativePath,
				description:
					item.section === "Available"
						? "Package-contained resource. Space changes the target installed state; Enter installs the package with native Pi filters."
						: "Package-contained resource. Space changes the target enabled state; Enter writes native Pi package filters.",
				checked: available ? false : resource.enabled,
				disabled: !editable,
				stateText: available ? "+" : resource.enabled ? "✓" : "–",
				stateTone: available ? "warning" : resource.enabled ? "success" : "muted",
				marker: editable ? undefined : "   ",
			});
		}
	}
	return children;
}

function dashboardPickerItems(packages: DashboardItem[], packageResources: PackageResourceInventory | undefined): CheckboxPickerItem[] {
	const items: CheckboxPickerItem[] = [];
	for (const item of packages) {
		const children = item.type === "package" ? packageResourceChildren(item, packageResources) : [];
		const visibleChildren = children.length > 1 ? children : [];
		items.push({
			id: item.rowId,
			label: item.label,
			value: item.type === "package" ? item.displaySource : item.value,
			description: item.description,
			section: sectionLabel(item.section),
			sectionTone: sectionTone(item.section),
			checked: false,
			disabled: item.disabled,
			stateIcon: stateIcon(item.section),
			stateLabel: stateLabel(item.section),
			stateText: stateIcon(item.section),
			stateTone: stateTone(item.section),
			marker: item.section === "Unloaded" ? "[!]" : undefined,
			relatedIds: item.type === "saved" ? item.relatedIds : undefined,
			quickSelectIds: item.type === "saved" ? item.relatedIds : undefined,
			confirmOnFocus: item.type === "saved",
			expandable: visibleChildren.length > 0,
			lazyChildren: item.type === "package" && item.section === "Available",
		});
		items.push(...visibleChildren);
	}
	return items;
}

interface PackageResourceFilterPlan {
	item: DashboardPackage;
	resources: PackageResourceSummary[];
	selectedPaths: Set<string>;
	filters: Partial<Record<PackageResourceFilterKey, string[] | null>>;
	selectedCount: number;
}

function packageResourceFilterPlans(packages: DashboardItem[], packageResources: PackageResourceInventory | undefined, selectedIds: string[], changedIds: string[]): PackageResourceFilterPlan[] {
	if (!packageResources || changedIds.length === 0) return [];
	const selected = new Set(selectedIds);
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
		const selectedPaths = new Set<string>();
		for (const resource of resources) {
			if (selected.has(packageResourceChildRowId(item, resource))) selectedPaths.add(resource.packageRelativePath);
		}
		const filters: Partial<Record<PackageResourceFilterKey, string[] | null>> = {};
		if (selectedPaths.size === 0) {
			for (const key of packageResourceFilterKeys) filters[key] = [];
		} else {
			for (const kind of directResourceKinds) {
				const kindResources = resources.filter((resource) => resource.kind === kind);
				if (kindResources.length === 0) continue;
				const selectedKindPaths = kindResources.filter((resource) => selectedPaths.has(resource.packageRelativePath)).map((resource) => resource.packageRelativePath).sort();
				filters[packageFilterKeyForKind[kind]] = selectedKindPaths.length === kindResources.length ? null : selectedKindPaths;
			}
		}
		plans.push({ item, resources, selectedPaths, filters, selectedCount: selectedPaths.size });
	}
	return plans;
}

function packageResourceFilterConfirmation(plans: PackageResourceFilterPlan[]): CheckboxPickerConfirmation | undefined {
	if (plans.length === 0) return undefined;
	const installCount = plans.filter((plan) => plan.item.section === "Available").length;
	const updateCount = plans.length - installCount;
	const lines = [
		installCount > 0 && updateCount > 0
			? `This will install ${installCount} available package${installCount === 1 ? "" : "s"} with selected resources and update filters for ${updateCount} existing package${updateCount === 1 ? "" : "s"}.`
			: installCount > 0
				? `This will install ${installCount} available package${installCount === 1 ? "" : "s"} with selected resources.`
				: `This will update native Pi package filters for ${plans.length} package${plans.length === 1 ? "" : "s"}.`,
		"It edits this project's .pi/settings.json after creating a backup.",
	];
	if (installCount > 0) lines.push("Available packages are installed project-local, then immediately narrowed with native Pi package filters.");
	lines.push(
		"No package files are copied into .pi/ and no saved loadout recipe is changed.",
		"Package row selections are ignored while resource-level changes are pending.",
		"",
	);
	for (const plan of plans.slice(0, 6)) {
		lines.push(`- ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources selected${plan.item.section === "Available" ? " (install)" : ""}`);
		for (const kind of directResourceKinds) {
			const kindResources = plan.resources.filter((resource) => resource.kind === kind);
			if (kindResources.length === 0) continue;
			const selectedCount = kindResources.filter((resource) => plan.selectedPaths.has(resource.packageRelativePath)).length;
			lines.push(`  ${resourcePlural(kind)}: ${selectedCount}/${kindResources.length}`);
		}
	}
	if (plans.length > 6) lines.push(`…and ${plans.length - 6} more`);
	return { title: "Apply package resource filters?", confirmHint: "Press Enter to write Pi filters · Esc cancels", lines };
}

function packageResourceProgressLines(plans: PackageResourceFilterPlan[], complete = 0, failures: string[] = []): string[] {
	return [
		`${complete}/${plans.length} package filter update${plans.length === 1 ? "" : "s"} complete`,
		"",
		...plans.map((plan, index) => `${index < complete ? "✓" : " "} ${plan.item.section === "Available" ? "Install/filter" : "Filter"} ${plan.item.label}  ${plan.selectedCount}/${plan.resources.length} resources`),
		...failures.map((failure) => `! ${failure}`),
	];
}

export async function handleDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, packages, warnings, projectMetadataMissing, packageResources, inventory } = await buildDashboardPackages(ctx);
	if (ctx.mode !== "tui") {
		showText(ctx, dashboardText(paths, packages, warnings, projectMetadataMissing));
		return;
	}

	const sessionPackageResources: PackageResourceInventory = packageResources ?? { resources: [], warnings: [] };
	const pickerItems = dashboardPickerItems(packages, sessionPackageResources);
	const pickerResult = await pickCheckboxes(ctx, dashboardPickerTitle(packages), pickerItems, {
		titleBold: false,
		subtitle: dashboardPickerSubtitle(packages, projectMetadataMissing),
		confirmHint: "Enter applies/runs",
		filterLabel: "Filter",
		filterHint: "type to narrow",
		filterHintInline: true,
		colorRowsByState: true,
		footerHint: "  Space select/toggle · Enter apply/run · → inspect/unfold package · ← fold · i details · r remove · Esc cancel\n  [!] read-only · [·] recipe item",
		actions: { remove: true },
		inspect: (focusedItem) => {
			const packageItem = packages.find((item): item is DashboardPackage => item.type === "package" && item.rowId === focusedItem.id);
			return packageItem ? packageResourceInspection(packageItem, sessionPackageResources) : undefined;
		},
		loadChildren: async (focusedItem) => {
			const packageItem = packages.find((item): item is DashboardPackage => item.type === "package" && item.rowId === focusedItem.id);
			if (!packageItem || packageItem.section !== "Available") return [];
			const availableResources = await collectTemporaryPackageResourcesForSources(ctx, inventory, [packageItem.source]);
			sessionPackageResources.resources.push(...availableResources.resources);
			for (const warning of availableResources.warnings) sessionPackageResources.warnings.push(warning);
			const resources = resourcesForPackage(packageItem, sessionPackageResources);
			const children = packageResourceChildren(packageItem, sessionPackageResources);
			if (resources.length > 1) return children;
			return {
				children: [],
				empty: {
					title: `Package resources: ${packageItem.label}`,
					confirmHint: "Press Enter/Esc to return",
					lines:
						resources.length === 1
							? [
								"This package contains one Pi resource, so Construct keeps it as a whole-package row instead of opening a child picker.",
								`- ${resourceLabel(resources[0])}: ${resources[0].packageRelativePath}`,
								"Select the package row and press Enter to install it normally.",
							]
							: ["No package-contained resources resolved for this package.", "Select the package row and press Enter to install it normally."],
				},
			};
		},
		removeConfirmation: (ids) => removeConfirmationFor(packages, ids),
		submitConfirmation: (ids, action, changedIds) => {
			if (action !== "confirm") return undefined;
			return packageResourceFilterConfirmation(packageResourceFilterPlans(packages, sessionPackageResources, ids, changedIds)) ?? disableConfirmationFor(packages, ids);
		},
		onSubmit: async (ids, update, signal, submitAction, changedIds) => {
			const selected = new Set(ids);
			const packageItems = packages.filter((item): item is DashboardPackage => item.type === "package");
			const directItems = packages.filter((item): item is DashboardDirectResource => item.type === "direct");
			const selectedSaved = submitAction === "confirm" ? packages.filter((item): item is DashboardSavedLoadout => item.type === "saved" && !item.disabled && selected.has(item.rowId)) : [];
			const resourcePlans = submitAction === "confirm" ? packageResourceFilterPlans(packages, sessionPackageResources, ids, changedIds) : [];
			if (resourcePlans.length > 0) {
				const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Package Resources", update, signal);
				if (!ready) return { title: "Package resource update cancelled", lines: ["No files were changed."] };

				const failures: string[] = [];
				const succeeded = new Set<string>();
				let complete = 0;
				let needsReload = false;
				update("Applying package resource filters", packageResourceProgressLines(resourcePlans));
				for (const plan of resourcePlans) {
					if (signal.aborted) break;
					let filterSource = plan.item.source;
					let metadataId = plan.item.managed ? plan.item.id : undefined;
					if (plan.item.section === "Available") {
						const load = await loadPackageIntoProject(pi, paths, {
							source: plan.item.source,
							item: { id: plan.item.id, kind: "package", source: plan.item.source },
						});
						if (load.needsReload) needsReload = true;
						if (!load.ok) {
							failures.push(`${plan.item.label}: install failed: ${load.error ?? load.stderr ?? `exit ${load.exitCode ?? "unknown"}`}`);
							complete += 1;
							update("Applying package resource filters", packageResourceProgressLines(resourcePlans, complete, failures));
							continue;
						}
						filterSource = load.declaredSource ?? plan.item.source;
						metadataId = load.itemId ?? metadataId;
					}
					const result = await setPackageResourceFiltersInProject(paths, { source: filterSource, id: metadataId, filters: plan.filters, selectedCount: plan.selectedCount });
					if (result.needsReload) needsReload = true;
					if (!result.ok) failures.push(`${plan.item.label}: ${plan.item.section === "Available" ? "installed but filter update failed" : "filter update failed"}: ${result.error ?? "unknown error"}`);
					else succeeded.add(plan.item.rowId);
					complete += 1;
					update("Applying package resource filters", packageResourceProgressLines(resourcePlans, complete, failures));
				}
				const changed = succeeded.size;
				const installedWithFilters = resourcePlans.filter((plan) => plan.item.section === "Available" && succeeded.has(plan.item.rowId));
				const updatedWithFilters = resourcePlans.filter((plan) => plan.item.section !== "Available" && succeeded.has(plan.item.rowId));
				return {
					title: signal.aborted ? (changed > 0 ? "Package resource update cancelled after partial changes" : "Package resource update cancelled") : failures.length > 0 ? "Package resource filters applied with errors" : "Package resource filters applied",
					confirmHint: needsReload ? "Press Enter to reload Pi · Esc cancels reload" : "Press Enter/Esc to return to session",
					confirmAction: needsReload ? "reload" : undefined,
					lines: [
						signal.aborted ? "Cancelled before remaining changes." : undefined,
						installedWithFilters.length > 0 ? `Installed with selected resources: ${installedWithFilters.length}` : undefined,
						...installedWithFilters.map((plan) => `+ ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources selected`),
						updatedWithFilters.length > 0 ? `Updated package filters: ${updatedWithFilters.length}` : undefined,
						...updatedWithFilters.map((plan) => `+ ${plan.item.label}: ${plan.selectedCount}/${plan.resources.length} resources selected`),
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
			for (const saved of selectedSaved) {
				for (const source of saved.sources) {
					const matchingPackage = findPackageForSavedSource(packageItems, source);
					const action = actionForSavedSource(matchingPackage);
					if (action) addStep(action, matchingPackage ? operationFromPackage(matchingPackage) : operationFromSource(source));
				}
			}
			if (steps.length === 0) {
				if (selectedSaved.length > 0) {
					return {
						title: "Saved loadout already active",
						lines: [
							`Selected saved loadouts: ${selectedSaved.length}`,
							"No package changes were needed in this project.",
							"Saved loadouts are activate-only; nothing was disabled, removed, or exact-matched.",
						],
					};
				}
				return { title: "No Construct changes selected", lines: noChangeLines(submitAction) };
			}

			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Loadout", update, signal);
			if (!ready) {
				return { title: "Construct Loadout cancelled", lines: ["No files were changed."] };
			}

			const outcome = await runConstructOperationSteps({
				pi,
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
