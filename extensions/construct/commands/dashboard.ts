import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogProfile, ConstructPaths, DirectResourceSummary } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { collectDirectProjectResources } from "../resources.js";
import { pickCheckboxes, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerConfirmation, type CheckboxPickerItem, type CheckboxPickerSubmitAction, type CheckboxPickerTone } from "../ui.js";
import { disableDirectResourceInProject, disablePackageResourcesInProject, enableDirectResourceInProject, enablePackageResourcesInProject, loadPackageIntoProject, removePackageFromProject } from "../package-ops.js";

type DashboardSection = "Saved" | "Active" | "Disabled" | "Available" | "Unloaded";
type PackageDashboardSection = Exclude<DashboardSection, "Saved">;
type DashboardAction = "Install" | "Enable" | "Disable" | "Remove";
type DashboardOperationItem = { id: string; label: string; source: string; displaySource: string; managed?: boolean; direct?: DirectResourceSummary };
type DashboardStep = { action: DashboardAction; item: DashboardOperationItem; state: "pending" | "running" | "done" | "failed"; error?: string };

interface DashboardPackage extends DashboardOperationItem {
	type: "package";
	section: PackageDashboardSection;
	checked: boolean;
	disabled?: boolean;
	description?: string;
	disabledByFilters?: boolean;
	matchSources: string[];
}

interface DashboardSavedLoadout {
	type: "saved";
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

function compactSource(source: string): string {
	const trimmed = source.trim().replace(/\/+$/, "");
	const githubUrl = trimmed.match(/^https?:\/\/github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (githubUrl) return `github:${githubUrl[1]}`;
	const gitGithub = trimmed.match(/^git:(?:github\.com[:/])?([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (gitGithub) return `github:${gitGithub[1]}`;
	const sshGithub = trimmed.match(/^git@github\.com:([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (sshGithub) return `github:${sshGithub[1]}`;
	return source;
}

function itemSortValue(item: DashboardItem): string {
	if (item.type === "saved") return item.value;
	if (item.type === "direct") return item.resource.displayPath;
	return item.source;
}

function sortDashboardPackages(packages: DashboardItem[]): DashboardItem[] {
	return packages.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.label.localeCompare(b.label) || itemSortValue(a).localeCompare(itemSortValue(b)));
}

function uniqueSorted(sources: string[]): string[] {
	return [...new Set(sources.filter((source) => source.trim().length > 0))].sort();
}

function savedLoadoutSources(catalog: CatalogData, profile: CatalogProfile): string[] {
	return uniqueSorted(
		profile.sources.length > 0
			? profile.sources
			: profile.items.map((id) => catalog.items.find((item) => item.id === id)?.source).filter((source): source is string => typeof source === "string"),
	);
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
		if (row && !seenRows.has(row.id)) {
			seenRows.add(row.id);
			relatedIds.push(row.id);
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

async function managedPackages(paths: ConstructPaths): Promise<Array<{ id: string; source: string; matchSources: Set<string>; enabled?: boolean }>> {
	const construct = await readJson(paths.projectConstructPath);
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	const items: Array<{ id: string; source: string; matchSources: Set<string>; enabled?: boolean; identityKey: string }> = [];
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (!identity.displaySource) continue;
		items.push({
			id,
			source: identity.displaySource,
			matchSources: identity.matchSources,
			enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
			identityKey: identity.normalizedInstallSource ?? identity.displaySource,
		});
	}
	const deduped = new Map<string, (typeof items)[number]>();
	for (const item of items.sort((a, b) => a.id.localeCompare(b.id))) {
		if (!deduped.has(item.identityKey)) deduped.set(item.identityKey, item);
	}
	return [...deduped.values()];
}

async function projectPackageSourceSets(paths: ConstructPaths): Promise<{
	packages: ReturnType<typeof getPackages>;
	declaredSources: Set<string>;
	disabledSources: Set<string>;
}> {
	const settings = await readJson(paths.projectSettingsPath);
	const settingsDir = dirname(paths.projectSettingsPath);
	const packages = getPackages(settings).filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.source.trim());
	const declaredSources = new Set<string>();
	const disabledSources = new Set<string>();
	for (const pkg of packages) {
		declaredSources.add(pkg.source);
		const normalized = await normalizeSourceForLibrary(pkg.source, settingsDir);
		declaredSources.add(normalized);
		if (pkg.disabledByFilters) {
			disabledSources.add(pkg.source);
			disabledSources.add(normalized);
		}
	}
	return { packages, declaredSources, disabledSources };
}

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardItem[]; warnings: string[] }> {
	const { paths, catalog, warnings } = await loadCatalog(ctx);
	const project = await projectPackageSourceSets(paths);
	const managed = await managedPackages(paths);
	const managedSources = new Set(managed.flatMap((item) => [...item.matchSources]));
	const packages: DashboardItem[] = [];

	for (const profile of catalog.profiles) {
		const sources = savedLoadoutSources(catalog, profile);
		packages.push({
			type: "saved",
			id: `saved:${profile.id}`,
			label: profile.id,
			value: `${sources.length} package source${sources.length === 1 ? "" : "s"}`,
			section: "Saved",
			checked: false,
			disabled: sources.length === 0,
			sources,
			relatedIds: [],
			description:
				sources.length === 0
					? "Saved loadout has no package sources."
					: `Saved package-source loadout${profile.name && profile.name !== profile.id ? ` (${profile.name})` : ""}. Press Enter to run it in this project, or Space to select member package rows.`,
		});
	}

	for (const item of managed) {
		const declared = [...item.matchSources].some((source) => project.declaredSources.has(source));
		const disabledByFilters = [...item.matchSources].some((source) => project.disabledSources.has(source));
		packages.push({
			type: "package",
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: declared ? (disabledByFilters ? "Disabled" : "Active") : "Available",
			checked: false,
			managed: true,
			disabledByFilters,
			matchSources: uniqueSorted([item.source, ...item.matchSources]),
			description: declared
				? disabledByFilters
					? "Active in this project, but package resources are disabled by Pi filters. Press Enter to enable selected packages, or r to remove them from this project."
					: "Active in this project. Press Enter to disable selected packages, or r to remove them from this project."
				: "Remembered by Construct, not installed in this project. Press Enter to install selected packages.",
		});
	}

	for (const item of catalog.items) {
		if (managedSources.has(item.source) || project.declaredSources.has(item.source)) continue;
		packages.push({
			type: "package",
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: "Available",
			checked: false,
			matchSources: [item.source],
			description: "Remembered by Construct, not installed in this project. Press Enter to install selected packages.",
		});
	}

	for (const pkg of project.packages) {
		const normalized = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(pkg.source) || managedSources.has(normalized)) continue;
		packages.push({
			type: "package",
			id: `unloaded:${normalized}`,
			label: deriveId(normalized),
			source: normalized,
			displaySource: compactSource(normalized),
			section: "Unloaded",
			checked: false,
			disabled: true,
			disabledByFilters: pkg.disabledByFilters,
			matchSources: uniqueSorted([pkg.source, normalized]),
			description: pkg.disabledByFilters
				? "Read-only here. Declared in this project and disabled by filters, but not loaded into Construct yet. Run /construct load to load it into Construct."
				: "Read-only here. Active in this project, but not loaded into Construct yet. Run /construct load to load it into Construct.",
		});
	}

	const constructRead = await readJson(paths.projectConstructPath);
	const directResources = await collectDirectProjectResources(ctx, paths, constructRead);
	warnings.push(...directResources.warnings);
	for (const resource of directResources.resources) {
		const section: PackageDashboardSection = resource.managed ? (resource.enabled ? "Active" : "Disabled") : "Unloaded";
		packages.push({
			type: "direct",
			id: `direct:${resource.id}`,
			label: `${resource.kind}:${resource.name}`,
			value: resource.displayPath,
			section,
			checked: false,
			disabled: !resource.managed,
			resource,
			description: resource.managed
				? resource.enabled
					? `Project ${resource.kind} is loaded into Construct metadata. Press Enter to disable it with a Pi resource filter.`
					: `Project ${resource.kind} is loaded into Construct metadata and disabled by Pi resource filters. Press Enter to enable it.`
				: resource.enabled
					? `Read-only here. Project ${resource.kind} is active but not loaded into Construct yet. Run /construct load to adopt it.`
					: `Read-only here. Project ${resource.kind} is disabled by Pi resource filters and not loaded into Construct yet. Run /construct load to adopt it.`,
		});
	}

	const packageRows = packages.filter((item): item is DashboardPackage => item.type === "package");
	for (const saved of packages.filter((item): item is DashboardSavedLoadout => item.type === "saved")) {
		const summary = savedLoadoutMemberSummary(saved.sources, packageRows);
		saved.value = summary.value;
		saved.relatedIds = summary.relatedIds;
		if (saved.sources.length > 0) {
			saved.description = [
				`Saved package-source loadout${saved.label ? `: ${saved.label}` : ""}.`,
				`Members: ${summary.value}. Rows marked [·] belong to the focused saved loadout.`,
				"Press Enter to run it: install/enable package sources that are not active.",
				"Press Space to select its member package rows for bulk package actions.",
			].join("\n");
		}
	}

	sortDashboardPackages(packages);
	return { paths, packages, warnings };
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

function dashboardPickerTitle(packages: DashboardItem[]): string {
	const counts = dashboardCounts(packages);
	return `Loadout: ${counts.active} active | ${counts.disabled} disabled | ${counts.available} available | ${counts.unloaded} unloaded`;
}

function sectionTone(_section: DashboardSection): CheckboxPickerTone {
	return "accent";
}

function stateTone(section: DashboardSection): CheckboxPickerTone {
	if (section === "Active") return "green";
	if (section === "Disabled") return "mutedGreen";
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
	return item.disabled ? "   " : "[ ]";
}

function dashboardLine(item: DashboardItem, labelWidth: number): string {
	const paddedLabel = item.label + " ".repeat(Math.max(0, labelWidth - item.label.length));
	const value = item.type === "package" ? item.displaySource : item.value;
	return `${selectionMarker(item)} ${stateIcon(item.section)}  ${paddedLabel}  ${value}`;
}

function dashboardText(paths: ConstructPaths, packages: DashboardItem[], warnings: string[]): string {
	const lines: string[] = ["Construct Loadout", "=================", `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	const labelWidth = Math.min(28, Math.max(...packages.map((item) => item.label.length), 0));
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		if (section === "Saved" && sectionItems.length === 0) continue;
		lines.push(section, "-".repeat(section.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => dashboardLine(item, labelWidth)) : ["- none"]), "");
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push(
		"Legend: [ ] selectable · [x] selected · [·] saved member · ◆ saved · ✓ active · – disabled · + available · ◇ unloaded.",
		"Controls: Space selects · on Saved, selects members · Enter applies/runs · r removes active/disabled · Esc cancels.",
		"",
		"Run /construct load to add unloaded resources to the Construct.",
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
		"Select Active or Disabled packages, then press r.",
		"Available packages are not installed in this project; use /construct unload to forget them from the Construct library.",
		"Unloaded resources are read-only here; remove them with Pi directly if needed.",
	];
}

function resultError(result: { error?: string; stderr?: string; exitCode?: number }): string {
	return result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
}

function removeConfirmationFor(packages: DashboardItem[], ids: string[]): CheckboxPickerConfirmation | undefined {
	const selected = new Set(ids);
	const removable = packages.filter((item): item is DashboardPackage => item.type === "package" && selected.has(item.id) && (item.section === "Active" || item.section === "Disabled"));
	if (removable.length === 0) return undefined;
	const preview = removable.slice(0, 8).map((item) => `- ${item.label}: ${item.source}`);
	const extra = removable.length > preview.length ? [`…and ${removable.length - preview.length} more`] : [];
	return {
		title: "Remove from this project?",
		confirmHint: "Press Enter to remove · Esc cancels",
		lines: [
			`This will run project-local \`pi remove\` for ${removable.length} package${removable.length === 1 ? "" : "s"}.`,
			"It edits .pi/settings.json after creating a backup.",
			"It does not delete global Pi package caches.",
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
	return { id: deriveId(source), label: deriveId(source), source, displaySource: compactSource(source) };
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
	if (!item) return "Install";
	if (item.section === "Active") return undefined;
	if (item.section === "Disabled") return "Enable";
	if (item.section === "Available") return "Install";
	return item.disabledByFilters ? "Enable" : undefined;
}

export async function handleDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, packages, warnings } = await buildDashboardPackages(ctx);
	if (ctx.mode !== "tui") {
		showText(ctx, dashboardText(paths, packages, warnings));
		return;
	}

	const pickerItems: CheckboxPickerItem[] = packages.map((item) => ({
		id: item.id,
		label: item.label,
		value: item.type === "package" ? item.displaySource : item.value,
		description: item.description,
		section: item.section,
		sectionTone: sectionTone(item.section),
		checked: false,
		disabled: item.disabled,
		stateIcon: stateIcon(item.section),
		stateLabel: stateLabel(item.section),
		stateText: stateIcon(item.section),
		stateTone: stateTone(item.section),
		relatedIds: item.type === "saved" ? item.relatedIds : undefined,
		quickSelectIds: item.type === "saved" ? item.relatedIds : undefined,
		confirmOnFocus: item.type === "saved",
	}));
	const pickerResult = await pickCheckboxes(ctx, dashboardPickerTitle(packages), pickerItems, {
		initialSelection: "empty",
		titleBold: false,
		confirmHint: "Enter applies/runs",
		filterLabel: "Filter loadouts/resources",
		filterHint: "Type to narrow by saved loadout, package, resource, source, or state · Backspace edits",
		stateLegend: [
			{ icon: "[x]", label: "selected", tone: "muted" },
			{ icon: "[·]", label: "saved member", tone: "muted" },
			{ icon: "◆", label: "saved", tone: "accent" },
			{ icon: "✓", label: "active", tone: "green" },
			{ icon: "–", label: "disabled", tone: "mutedGreen" },
			{ icon: "+", label: "available", tone: "warning" },
			{ icon: "◇", label: "unloaded", tone: "muted" },
		],
		footerHint: "  Space selects · on Saved, selects members · Enter applies/runs · r removes active/disabled · Esc cancels",
		actions: { remove: true },
		removeConfirmation: (ids) => removeConfirmationFor(packages, ids),
		onSubmit: async (ids, update, signal, submitAction) => {
			const selected = new Set(ids);
			const packageItems = packages.filter((item): item is DashboardPackage => item.type === "package");
			const directItems = packages.filter((item): item is DashboardDirectResource => item.type === "direct");
			const selectedSaved = submitAction === "confirm" ? packages.filter((item): item is DashboardSavedLoadout => item.type === "saved" && !item.disabled && selected.has(item.id)) : [];
			const steps: DashboardStep[] = [];
			const scheduled = new Set<string>();
			function addStep(action: DashboardAction, item: DashboardOperationItem): void {
				const key = `${action}:${item.source}`;
				if (scheduled.has(key)) return;
				scheduled.add(key);
				steps.push({ action, item, state: "pending" });
			}
			for (const item of packageItems) {
				if (item.disabled || !selected.has(item.id)) continue;
				const action = actionForSubmit(submitAction, item);
				if (action) addStep(action, operationFromPackage(item));
			}
			for (const item of directItems) {
				if (item.disabled || !selected.has(item.id)) continue;
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
						lines: [`Selected saved loadouts: ${selectedSaved.length}`, "No package changes were needed in this project."],
					};
				}
				return { title: "No Construct changes selected", lines: noChangeLines(submitAction) };
			}

			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Loadout", update, signal);
			if (!ready) {
				return { title: "Construct Loadout cancelled", lines: ["No files were changed."] };
			}

			const completed: Array<{ action: DashboardAction; item: DashboardOperationItem }> = [];
			const partialRuntimeChanges: Array<{ action: DashboardAction; item: DashboardOperationItem; error: string }> = [];
			const failures: string[] = [];
			let needsReload = false;

			function progressLines(): string[] {
				const complete = steps.filter((step) => step.state === "done" || step.state === "failed").length;
				return [
					`${complete}/${steps.length} changes complete`,
					"",
					...steps.map((step) => {
						const marker = step.state === "done" ? "✓" : step.state === "failed" ? "!" : step.state === "running" ? "→" : " ";
						const suffix = step.error ? ` — ${step.error}` : "";
						return `${marker} ${step.action} ${step.item.label}  ${step.item.displaySource}${suffix}`;
					}),
				];
			}

			update("Applying Construct Loadout", progressLines());
			for (const step of steps) {
				if (signal.aborted) break;
				step.state = "running";
				update("Applying Construct Loadout", progressLines());
				const result = step.item.direct
					? step.action === "Enable"
						? await enableDirectResourceInProject(paths, step.item.direct)
						: step.action === "Disable"
							? await disableDirectResourceInProject(paths, step.item.direct)
							: { ok: false, error: `${step.action} is not supported for direct project resources.` }
					: step.action === "Install"
						? await loadPackageIntoProject(pi, paths, { source: step.item.source, item: { id: step.item.id, kind: "package", source: step.item.source } })
						: step.action === "Enable"
							? await enablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined })
							: step.action === "Disable"
								? await disablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined })
								: await removePackageFromProject(pi, paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined });
				if (result.needsReload) needsReload = true;
				if (result.ok) {
					completed.push({ action: step.action, item: step.item });
					step.state = "done";
				} else {
					step.state = "failed";
					step.error = resultError(result);
					if (result.metadataOnlyFailure && result.needsReload) partialRuntimeChanges.push({ action: step.action, item: step.item, error: step.error });
					else failures.push(`${step.item.id}: ${step.error}`);
				}
				update("Applying Construct Loadout", progressLines());
			}

			const appliedChanges = completed.length + partialRuntimeChanges.length;
			const cancelled = signal.aborted;
			const byAction = (action: DashboardAction) => completed.filter((step) => step.action === action).map((step) => step.item);
			const installed = byAction("Install");
			const enabled = byAction("Enable");
			const disabled = byAction("Disable");
			const removed = byAction("Remove");
			const hasErrors = failures.length > 0 || partialRuntimeChanges.length > 0;
			return {
				title: cancelled
					? appliedChanges > 0
						? "Construct Loadout cancelled after partial changes"
						: "Construct Loadout cancelled"
					: hasErrors
						? "Construct Loadout applied with errors"
						: "Construct Loadout changes applied",
				confirmHint: needsReload ? "Press Enter to reload Pi · Esc cancels reload" : "Press Enter/Esc to return to session",
				confirmAction: needsReload ? "reload" : undefined,
				lines: [
					cancelled ? "Cancelled before remaining changes." : undefined,
					selectedSaved.length > 0 ? `Saved loadouts selected: ${selectedSaved.map((item) => item.label).join(", ")}` : undefined,
					installed.length > 0 ? `Installed into project: ${installed.length}` : undefined,
					...installed.map((item) => `+ ${item.label}: ${item.source}`),
					enabled.length > 0 ? `Enabled: ${enabled.length}` : undefined,
					...enabled.map((item) => `+ ${item.label}: ${item.source}`),
					disabled.length > 0 ? `Disabled: ${disabled.length}` : undefined,
					...disabled.map((item) => `- ${item.label}: ${item.source}`),
					removed.length > 0 ? `Removed from project: ${removed.length}` : undefined,
					...removed.map((item) => `- ${item.label}: ${item.source}`),
					partialRuntimeChanges.length > 0 ? `Resource settings changed, but Construct metadata failed: ${partialRuntimeChanges.length}` : undefined,
					...partialRuntimeChanges.map((change) => `! ${change.action} ${change.item.label}: ${change.error}`),
					partialRuntimeChanges.length > 0 ? "Run /construct status to inspect drift." : undefined,
					failures.length > 0 ? `Failures: ${failures.length}` : undefined,
					...failures.map((failure) => `! ${failure}`),
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
