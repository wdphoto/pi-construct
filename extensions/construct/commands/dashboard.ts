import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { pickCheckboxes, showText, type CheckboxPickerItem } from "../ui.js";
import { loadPackageIntoProject, unloadPackageFromProject } from "../package-ops.js";

type DashboardSection = "Enabled" | "Available" | "Project-only";

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
}

const dashboardSections: DashboardSection[] = ["Enabled", "Available", "Project-only"];

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

async function buildDashboardPackages(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; packages: DashboardPackage[]; warnings: string[] }> {
	const { paths, catalog, warnings } = await loadCatalog(ctx);
	const projectSources = new Set(await packageSourcesFromSettings(paths.projectSettingsPath));
	const settings = await readJson(paths.projectSettingsPath);
	const localPackages = getPackages(settings).filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.source.trim());
	const managed = await managedPackages(paths);
	const managedSources = new Set(managed.flatMap((item) => [...item.matchSources]));
	const packages: DashboardPackage[] = [];
	for (const item of managed) {
		const active = [...item.matchSources].some((source) => projectSources.has(source));
		packages.push({
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: active ? "Enabled" : "Available",
			checked: active,
		});
	}

	for (const item of catalog.items) {
		if (managedSources.has(item.source) || projectSources.has(item.source)) continue;
		packages.push({
			id: item.id,
			label: item.id,
			source: item.source,
			displaySource: compactSource(item.source),
			section: "Available",
			checked: false,
		});
	}

	for (const pkg of localPackages) {
		const normalized = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(pkg.source) || managedSources.has(normalized)) continue;
		packages.push({
			id: `local:${normalized}`,
			label: deriveId(normalized),
			source: normalized,
			displaySource: compactSource(normalized),
			section: "Project-only",
			checked: true,
			disabled: true,
			marker: "[!]",
			description: "Active in this project, but not managed by Construct yet. Run /construct sync to adopt it.",
		});
	}

	sortDashboardPackages(packages);
	return { paths, packages, warnings };
}

function dashboardSummary(packages: DashboardPackage[]): string {
	const enabled = packages.filter((item) => item.section === "Enabled").length;
	const available = packages.filter((item) => item.section === "Available").length;
	const projectOnly = packages.filter((item) => item.section === "Project-only").length;
	return `${enabled} enabled · ${available} available · ${projectOnly} project-only`;
}

function dashboardText(paths: ConstructPaths, packages: DashboardPackage[], warnings: string[]): string {
	const lines: string[] = ["Construct loadout", "=================", `Project: ${paths.cwd}`, dashboardSummary(packages), ""];
	for (const section of dashboardSections) {
		const sectionItems = packages.filter((item) => item.section === section);
		lines.push(section, "-".repeat(section.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => `${item.marker ?? (item.checked ? "[x]" : "[ ]")} ${item.label}  ${item.displaySource}`) : ["- none"]), "");
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push("Space toggles Construct packages. Enter applies. Esc cancels.", "Project-only rows are read-only; run /construct sync to adopt them.", "Runtime commands and tools are listed in /construct status.");
	return lines.join("\n");
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
		checked: item.checked,
		disabled: item.disabled,
		marker: item.marker,
	}));
	const pickerResult = await pickCheckboxes(ctx, `Construct loadout — ${dashboardSummary(packages)}`, pickerItems, {
		confirmHint: "Enter applies",
		onSubmit: async (ids, update) => {
			const selected = new Set(ids);
			const toLoad = packages.filter((item) => !item.disabled && !item.checked && selected.has(item.id));
			const toUnload = packages.filter((item) => !item.disabled && item.checked && !selected.has(item.id));
			if (toLoad.length === 0 && toUnload.length === 0) {
				return { title: "No Construct package changes selected", lines: ["No files were changed."] };
			}

			type Step = { action: "Turn on" | "Turn off"; item: DashboardPackage; state: "pending" | "running" | "done" | "failed"; error?: string };
			const steps: Step[] = [
				...toLoad.map((item): Step => ({ action: "Turn on", item, state: "pending" })),
				...toUnload.map((item): Step => ({ action: "Turn off", item, state: "pending" })),
			];
			const loaded: DashboardPackage[] = [];
			const unloaded: DashboardPackage[] = [];
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

			update("Applying Construct loadout", progressLines());
			for (const step of steps) {
				step.state = "running";
				update("Applying Construct loadout", progressLines());
				if (step.action === "Turn on") {
					const result = await loadPackageIntoProject(pi, paths, { source: step.item.source, item: { id: step.item.id, kind: "package", source: step.item.source } });
					if (result.ok) {
						loaded.push(step.item);
						step.state = "done";
					} else {
						step.state = "failed";
						step.error = result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
						failures.push(`${step.item.id}: ${step.error}`);
					}
				} else {
					const result = await unloadPackageFromProject(pi, paths, { source: step.item.source, id: step.item.id });
					if (result.ok) {
						unloaded.push(step.item);
						step.state = "done";
					} else {
						step.state = "failed";
						step.error = result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
						failures.push(`${step.item.id}: ${step.error}`);
					}
				}
				update("Applying Construct loadout", progressLines());
			}

			const appliedChanges = loaded.length + unloaded.length;
			return {
				title: failures.length > 0 ? "Construct loadout applied with errors" : "Construct loadout changes applied",
				confirmHint: appliedChanges > 0 ? "Press Enter to reload Pi · Esc returns to session" : "Press Enter/Esc to return to session",
				confirmAction: appliedChanges > 0 ? "reload" : undefined,
				lines: [
					toLoad.length > 0 ? `Turned on: ${loaded.length}/${toLoad.length}` : undefined,
					...loaded.map((item) => `+ ${item.label}: ${item.source}`),
					toUnload.length > 0 ? `Turned off: ${unloaded.length}/${toUnload.length}` : undefined,
					...unloaded.map((item) => `- ${item.label}: ${item.source}`),
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
