import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, DirectResourceSummary } from "../types.js";
import { deriveId } from "../catalog.js";
import { collectProjectInventory } from "../project-inventory.js";
import { savedLoadoutSources, uniqueSorted } from "../saved-loadouts.js";
import { CONSTRUCT_TITLE } from "../metadata.js";
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

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardItem[]; warnings: string[] }> {
	const inventory = await collectProjectInventory(ctx);
	const { paths } = inventory;
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
		packages.push({
			type: "package",
			rowId: rowId("managed", item.id, source),
			id: item.id,
			label: item.id,
			source,
			displaySource: compactSource(source),
			section: managed.state === "active" ? "Active" : managed.state === "disabled" ? "Disabled" : "Available",
			checked: false,
			managed: true,
			disabledByFilters: managed.disabledByFilters,
			matchSources: uniqueSorted([source, ...managed.matchSources]),
			description: managed.declared
				? managed.disabledByFilters
					? "Disabled package. Enter enables; r removes."
					: "Active package. Enter disables; r removes."
				: missingDeclarationDrift
					? "Drifted package. Enter restores."
					: "Available package. Enter installs.",
		});
	}

	for (const item of inventory.availableCatalogPackages) {
		packages.push({
			type: "package",
			rowId: rowId("catalog", item.id, item.source),
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: "Available",
			checked: false,
			matchSources: [item.source],
			description: "Available package. Enter installs.",
		});
	}

	for (const pkg of inventory.unloadedPackageDeclarations) {
		packages.push({
			type: "package",
			rowId: rowId("unloaded", pkg.source),
			id: `unloaded:${pkg.source}`,
			label: deriveId(pkg.source),
			source: pkg.source,
			displaySource: compactSource(pkg.source),
			section: "Unloaded",
			checked: false,
			disabled: true,
			disabledByFilters: pkg.disabledByFilters,
			matchSources: uniqueSorted(pkg.matchSources),
			description: "Read-only package. Run /construct load to adopt it.",
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

function dashboardPickerTitle(_packages: DashboardItem[]): string {
	return CONSTRUCT_TITLE;
}

function dashboardPickerSubtitle(packages: DashboardItem[]): string {
	const counts = dashboardCounts(packages);
	return `${counts.active} active | ${counts.disabled} disabled | ${counts.available} available | ${counts.unloaded} unloaded`;
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

function dashboardFooterHint(packages: DashboardItem[]): string {
	const counts = dashboardCounts(packages);
	if (counts.unloaded > 0) return "Run /construct load to add unloaded resources to the Construct.";
	if (counts.available > 0) return "Select Available rows and press Enter to install them into this project.";
	if (counts.active + counts.disabled > 0) return "Select Active or Disabled rows and press Enter to toggle them.";
	return "Install a Pi package normally, then run /construct load to remember it.";
}

function dashboardText(paths: ConstructPaths, packages: DashboardItem[], warnings: string[]): string {
	const lines: string[] = [CONSTRUCT_TITLE, "=".repeat(CONSTRUCT_TITLE.length), `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	const labelWidth = Math.min(28, Math.max(...packages.map((item) => item.label.length), 0));
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		if (section === "Saved" && sectionItems.length === 0) continue;
		const label = sectionLabel(section);
		lines.push(label, "-".repeat(label.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => dashboardLine(item, labelWidth)) : ["- none"]), "");
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push(
		"Legend: [ ] selectable · [x] selected · [·] recipe item · [!] read-only · ◆ saved · ✓ active · – disabled · + available · ◇ unloaded.",
		"Space selects · on Loadouts, selects recipe items · Enter applies/runs · r removes selected from project · Esc cancels.",
		"",
		dashboardFooterHint(packages),
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
	// Saved loadout rows are activate-only: install missing sources, enable disabled sources, and never disable/remove anything.
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
	}));
	const pickerResult = await pickCheckboxes(ctx, dashboardPickerTitle(packages), pickerItems, {
		initialSelection: "empty",
		titleBold: false,
		subtitle: dashboardPickerSubtitle(packages),
		confirmHint: "Enter applies/runs",
		filterLabel: "Filter",
		filterHint: "type to narrow",
		filterHintInline: true,
		colorRowsByState: true,
		footerHint: "  Space select · Enter apply/run · r remove · Esc cancel\n  [!] read-only · [·] recipe item",
		actions: { remove: true },
		removeConfirmation: (ids) => removeConfirmationFor(packages, ids),
		submitConfirmation: (ids, action) => (action === "confirm" ? disableConfirmationFor(packages, ids) : undefined),
		onSubmit: async (ids, update, signal, submitAction) => {
			const selected = new Set(ids);
			const packageItems = packages.filter((item): item is DashboardPackage => item.type === "package");
			const directItems = packages.filter((item): item is DashboardDirectResource => item.type === "direct");
			const selectedSaved = submitAction === "confirm" ? packages.filter((item): item is DashboardSavedLoadout => item.type === "saved" && !item.disabled && selected.has(item.rowId)) : [];
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
