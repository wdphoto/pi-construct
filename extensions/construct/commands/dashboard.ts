import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { pickCheckboxes, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem, type CheckboxPickerSubmitAction } from "../ui.js";
import { disablePackageResourcesInProject, enablePackageResourcesInProject, loadPackageIntoProject, removePackageFromProject } from "../package-ops.js";

type DashboardSection = "Loaded" | "Disabled" | "Installed" | "Available";
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
	marker?: string;
	description?: string;
	managed?: boolean;
}

const dashboardSections: DashboardSection[] = ["Loaded", "Disabled", "Installed", "Available"];

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
			section: declared ? (disabledByFilters ? "Disabled" : "Loaded") : "Available",
			checked: false,
			managed: true,
			description: declared
				? disabledByFilters
					? "Declared in this project, but package resources are disabled by Pi filters. Press Enter to enable selected disabled packages."
					: "Active in this project. Press d to disable selected loaded packages, or r to remove declarations."
				: "Remembered by Construct, not declared in this project. Press Enter to load selected packages.",
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
			description: "Remembered by Construct, not declared in this project. Press Enter to load selected packages.",
		});
	}

	for (const pkg of project.packages) {
		const normalized = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(pkg.source) || managedSources.has(normalized)) continue;
		packages.push({
			id: `installed:${normalized}`,
			label: deriveId(normalized),
			source: normalized,
			displaySource: compactSource(normalized),
			section: "Installed",
			checked: false,
			marker: "[i]",
			description: pkg.disabledByFilters
				? "Declared in this project and disabled by filters, but not loaded into Construct yet. Press r to remove it from the project, or run /construct load to add it to Construct."
				: "Declared in this project, but not loaded into Construct yet. Press r to remove it from the project, or run /construct load to add it to Construct.",
		});
	}

	sortDashboardPackages(packages);
	return { paths, packages, warnings };
}

function dashboardSummary(packages: DashboardPackage[]): string {
	const loaded = packages.filter((item) => item.section === "Loaded").length;
	const disabled = packages.filter((item) => item.section === "Disabled").length;
	const available = packages.filter((item) => item.section === "Available").length;
	const installed = packages.filter((item) => item.section === "Installed").length;
	return `${loaded} loaded · ${disabled} disabled · ${installed} installed · ${available} available`;
}

function printMarker(item: DashboardPackage): string {
	if (item.marker) return item.marker;
	if (item.section === "Loaded") return "[x]";
	if (item.section === "Disabled") return "[-]";
	return "[ ]";
}

function dashboardText(paths: ConstructPaths, packages: DashboardPackage[], warnings: string[]): string {
	const lines: string[] = ["Construct Loadout", "=================", `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		lines.push(section, "-".repeat(section.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => `${printMarker(item)} ${item.label}  ${item.displaySource}`) : ["- none"]), "");
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push("TUI controls: Space selects · Enter loads/enables · d disables · r removes declarations · Esc cancels.", "", "Run /construct load to add new project-level resources to the Construct.");
	return lines.join("\n");
}

function actionForSubmit(action: CheckboxPickerSubmitAction, item: DashboardPackage): DashboardAction | undefined {
	if (action === "confirm") {
		if (item.section === "Available") return "Install";
		if (item.section === "Disabled") return "Enable";
		return undefined;
	}
	if (action === "disable") return item.section === "Loaded" ? "Disable" : undefined;
	if (action === "remove") return item.section === "Loaded" || item.section === "Disabled" || item.section === "Installed" ? "Remove" : undefined;
	return undefined;
}

function noChangeLines(action: CheckboxPickerSubmitAction): string[] {
	if (action === "confirm") return ["No load/enable changes were selected.", "Select Available or Disabled packages, then press Enter."];
	if (action === "disable") return ["No loaded packages were selected to disable.", "Select Loaded packages, then press d."];
	return [
		"No project-declared packages were selected to remove.",
		"Select Loaded, Disabled, or Installed packages, then press r.",
		"Available packages are not declared in this project; use /construct unload to forget them from the Construct library.",
	];
}

function resultError(result: { error?: string; stderr?: string; exitCode?: number }): string {
	return result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
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
		checked: false,
		disabled: item.disabled,
		marker: item.marker,
	}));
	const pickerResult = await pickCheckboxes(ctx, `Construct Loadout — ${dashboardSummary(packages)}`, pickerItems, {
		initialSelection: "empty",
		confirmHint: "Enter loads/enables",
		footerHint: "  Type to filter · Space selects · Enter loads/enables · d disables · r removes declarations · Esc cancels",
		actions: { disable: true, remove: true },
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
						? await enablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.id })
						: step.action === "Disable"
							? await disablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.id })
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
					installed.length > 0 ? `Loaded: ${installed.length}` : undefined,
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
