import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { pickCheckboxes, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerConfirmation, type CheckboxPickerItem, type CheckboxPickerSubmitAction, type CheckboxPickerTone } from "../ui.js";
import { disablePackageResourcesInProject, enablePackageResourcesInProject, loadPackageIntoProject, removePackageFromProject } from "../package-ops.js";

type DashboardSection = "Installed" | "Disabled" | "Available" | "Unloaded";
type DashboardAction = "Install" | "Enable" | "Disable" | "Remove";
type DashboardStep = { action: DashboardAction; item: DashboardPackage; state: "pending" | "running" | "done" | "failed"; error?: string };

interface DashboardPackage {
	id: string;
	label: string;
	source: string;
	displaySource: string;
	section: DashboardSection;
	checked: boolean;
	disabled?: boolean;
	description?: string;
	managed?: boolean;
	disabledByFilters?: boolean;
}

const dashboardSections: DashboardSection[] = ["Installed", "Disabled", "Available", "Unloaded"];

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

function sortDashboardPackages(packages: DashboardPackage[]): DashboardPackage[] {
	return packages.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.label.localeCompare(b.label) || a.source.localeCompare(b.source));
}

async function managedPackages(paths: ConstructPaths): Promise<Array<{ id: string; source: string; matchSources: Set<string>; enabled?: boolean }>> {
	const construct = await readJson(paths.projectConstructPath);
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	const items: Array<{ id: string; source: string; matchSources: Set<string>; enabled?: boolean }> = [];
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (!identity.displaySource) continue;
		items.push({
			id,
			source: identity.displaySource,
			matchSources: identity.matchSources,
			enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
		});
	}
	return items.sort((a, b) => a.id.localeCompare(b.id));
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

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardPackage[]; warnings: string[] }> {
	const { paths, catalog, warnings } = await loadCatalog(ctx);
	const project = await projectPackageSourceSets(paths);
	const managed = await managedPackages(paths);
	const managedSources = new Set(managed.flatMap((item) => [...item.matchSources]));
	const packages: DashboardPackage[] = [];

	for (const item of managed) {
		const declared = [...item.matchSources].some((source) => project.declaredSources.has(source));
		const disabledByFilters = [...item.matchSources].some((source) => project.disabledSources.has(source));
		packages.push({
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: declared ? (disabledByFilters ? "Disabled" : "Installed") : "Available",
			checked: false,
			managed: true,
			disabledByFilters,
			description: declared
				? disabledByFilters
					? "Installed in this project, but package resources are disabled by Pi filters. Press Enter to enable selected packages, or r to remove them from this project."
					: "Installed and active in this project. Press Enter to disable selected packages, or r to remove them from this project."
				: "Remembered by Construct, not installed in this project. Press Enter to install selected packages.",
		});
	}

	for (const item of catalog.items) {
		if (managedSources.has(item.source) || project.declaredSources.has(item.source)) continue;
		packages.push({
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: "Available",
			checked: false,
			description: "Remembered by Construct, not installed in this project. Press Enter to install selected packages.",
		});
	}

	for (const pkg of project.packages) {
		const normalized = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(pkg.source) || managedSources.has(normalized)) continue;
		packages.push({
			id: `unloaded:${normalized}`,
			label: deriveId(normalized),
			source: normalized,
			displaySource: compactSource(normalized),
			section: "Unloaded",
			checked: false,
			disabled: true,
			disabledByFilters: pkg.disabledByFilters,
			description: pkg.disabledByFilters
				? "Read-only here. Installed in this project and disabled by filters, but not loaded into Construct yet. Run /construct load to load it into Construct."
				: "Read-only here. Installed in this project, but not loaded into Construct yet. Run /construct load to load it into Construct.",
		});
	}

	sortDashboardPackages(packages);
	return { paths, packages, warnings };
}

function dashboardSummary(packages: DashboardPackage[]): string {
	const installed = packages.filter((item) => item.section === "Installed").length;
	const disabled = packages.filter((item) => item.section === "Disabled").length;
	const available = packages.filter((item) => item.section === "Available").length;
	const unloaded = packages.filter((item) => item.section === "Unloaded").length;
	return `${installed} installed · ${disabled} disabled · ${available} available · ${unloaded} unloaded`;
}

function sectionTone(section: DashboardSection): CheckboxPickerTone {
	return section === "Unloaded" ? "muted" : "accent";
}

function stateTone(section: DashboardSection): CheckboxPickerTone {
	if (section === "Installed") return "success";
	if (section === "Available") return "warning";
	return "muted";
}

function stateIcon(section: DashboardSection): string {
	if (section === "Installed") return "✓";
	if (section === "Disabled") return "–";
	if (section === "Unloaded") return "◇";
	return "+";
}

function stateLabel(section: DashboardSection): string {
	if (section === "Installed") return "Active";
	if (section === "Unloaded") return "Unloaded";
	return section;
}

function selectionMarker(item: DashboardPackage): string {
	return item.disabled ? "   " : "[ ]";
}

function dashboardLine(item: DashboardPackage, labelWidth: number): string {
	const paddedLabel = item.label + " ".repeat(Math.max(0, labelWidth - item.label.length));
	return `${selectionMarker(item)} ${stateIcon(item.section)}  ${paddedLabel}  ${item.displaySource}`;
}

function dashboardText(paths: ConstructPaths, packages: DashboardPackage[], warnings: string[]): string {
	const lines: string[] = ["Construct Loadout", "=================", `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	const labelWidth = Math.min(28, Math.max(...packages.map((item) => item.label.length), 0));
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		lines.push(section, "-".repeat(section.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => dashboardLine(item, labelWidth)) : ["- none"]), "");
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push(
		"Legend: [ ] selectable · [x] selected · ✓ active · – disabled · + available · ◇ unloaded.",
		"Controls: Space selects · Enter applies · r removes installed/disabled · Esc cancels.",
		"",
		"Run /construct load to add unloaded resources to the Construct.",
	);
	return lines.join("\n");
}

function actionForSubmit(action: CheckboxPickerSubmitAction, item: DashboardPackage): DashboardAction | undefined {
	if (action === "confirm") {
		if (item.section === "Available") return "Install";
		if (item.section === "Installed") return "Disable";
		if (item.section === "Disabled") return "Enable";
		return undefined;
	}
	if (action === "remove") return item.section === "Installed" || item.section === "Disabled" ? "Remove" : undefined;
	return undefined;
}

function noChangeLines(action: CheckboxPickerSubmitAction): string[] {
	if (action === "confirm") return ["No Construct package changes were selected.", "Select Installed, Disabled, or Available packages, then press Enter.", "Unloaded rows are read-only here; use /construct load to load them into Construct."];
	return [
		"No installed project packages were selected to remove.",
		"Select Installed or Disabled packages, then press r.",
		"Available packages are not installed in this project; use /construct unload to forget them from the Construct library.",
		"Unloaded rows are read-only here; remove them with Pi directly if needed.",
	];
}

function resultError(result: { error?: string; stderr?: string; exitCode?: number }): string {
	return result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
}

function removeConfirmationFor(packages: DashboardPackage[], ids: string[]): CheckboxPickerConfirmation | undefined {
	const selected = new Set(ids);
	const removable = packages.filter((item) => selected.has(item.id) && (item.section === "Installed" || item.section === "Disabled"));
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

export async function handleDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, packages, warnings } = await buildDashboardPackages(ctx);
	if (ctx.mode !== "tui") {
		showText(ctx, dashboardText(paths, packages, warnings));
		return;
	}

	const pickerItems: CheckboxPickerItem[] = packages.map((item) => ({
		id: item.id,
		label: item.label,
		value: item.displaySource,
		description: item.description,
		section: item.section,
		sectionTone: sectionTone(item.section),
		checked: false,
		disabled: item.disabled,
		stateIcon: stateIcon(item.section),
		stateLabel: stateLabel(item.section),
		stateText: stateIcon(item.section),
		stateTone: stateTone(item.section),
	}));
	const pickerResult = await pickCheckboxes(ctx, `Construct Loadout — ${dashboardSummary(packages)}`, pickerItems, {
		initialSelection: "empty",
		confirmHint: "Enter applies",
		filterLabel: "Filter packages",
		filterHint: "Type to narrow by package, source, or state · Backspace edits",
		footerHint: "  [x] selected · ✓ active · – disabled · + available · ◇ unloaded\n  Space selects · Enter applies · r removes installed/disabled · Esc cancels",
		actions: { remove: true },
		removeConfirmation: (ids) => removeConfirmationFor(packages, ids),
		onSubmit: async (ids, update, signal, submitAction) => {
			const selected = new Set(ids);
			const steps: DashboardStep[] = [];
			for (const item of packages) {
				if (item.disabled || !selected.has(item.id)) continue;
				const action = actionForSubmit(submitAction, item);
				if (action) steps.push({ action, item, state: "pending" });
			}
			if (steps.length === 0) {
				return { title: "No Construct package changes selected", lines: noChangeLines(submitAction) };
			}

			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct Loadout", update, signal);
			if (!ready) {
				return { title: "Construct Loadout cancelled", lines: ["No files were changed."] };
			}

			const completed: Array<{ action: DashboardAction; item: DashboardPackage }> = [];
			const failures: string[] = [];

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
				const result = step.action === "Install"
					? await loadPackageIntoProject(pi, paths, { source: step.item.source, item: { id: step.item.id, kind: "package", source: step.item.source } })
					: step.action === "Enable"
						? await enablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined })
						: step.action === "Disable"
							? await disablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined })
							: await removePackageFromProject(pi, paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined });
				if (result.ok) {
					completed.push({ action: step.action, item: step.item });
					step.state = "done";
				} else {
					step.state = "failed";
					step.error = resultError(result);
					failures.push(`${step.item.id}: ${step.error}`);
				}
				update("Applying Construct Loadout", progressLines());
			}

			const appliedChanges = completed.length;
			const cancelled = signal.aborted;
			const byAction = (action: DashboardAction) => completed.filter((step) => step.action === action).map((step) => step.item);
			const installed = byAction("Install");
			const enabled = byAction("Enable");
			const disabled = byAction("Disable");
			const removed = byAction("Remove");
			return {
				title: cancelled
					? appliedChanges > 0
						? "Construct Loadout cancelled after partial changes"
						: "Construct Loadout cancelled"
					: failures.length > 0
						? "Construct Loadout applied with errors"
						: "Construct Loadout changes applied",
				confirmHint: appliedChanges > 0 ? "Press Enter to reload Pi · Esc returns to session" : "Press Enter/Esc to return to session",
				confirmAction: appliedChanges > 0 ? "reload" : undefined,
				lines: [
					cancelled ? "Cancelled before remaining changes." : undefined,
					installed.length > 0 ? `Installed into project: ${installed.length}` : undefined,
					...installed.map((item) => `+ ${item.label}: ${item.source}`),
					enabled.length > 0 ? `Enabled: ${enabled.length}` : undefined,
					...enabled.map((item) => `+ ${item.label}: ${item.source}`),
					disabled.length > 0 ? `Disabled: ${disabled.length}` : undefined,
					...disabled.map((item) => `- ${item.label}: ${item.source}`),
					removed.length > 0 ? `Removed from project: ${removed.length}` : undefined,
					...removed.map((item) => `- ${item.label}: ${item.source}`),
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
