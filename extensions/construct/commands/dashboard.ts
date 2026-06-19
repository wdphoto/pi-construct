import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { pickCheckboxes, progressStatus, setConstructStatus, showSummary, showText, type CheckboxPickerItem } from "../ui.js";
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
	lines.push("Space toggles Construct packages. Enter saves. Esc cancels.", "Project-only rows are read-only; run /construct sync to adopt them.", "Runtime commands and tools are listed in /construct status.");
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
	const selectedIds = await pickCheckboxes(ctx, `Construct loadout — ${dashboardSummary(packages)}`, pickerItems);
	if (!selectedIds) {
		showText(ctx, "Construct dashboard closed. No files were changed.");
		return;
	}

	const selected = new Set(selectedIds);
	const toLoad = packages.filter((item) => !item.disabled && !item.checked && selected.has(item.id));
	const toUnload = packages.filter((item) => !item.disabled && item.checked && !selected.has(item.id));
	if (toLoad.length === 0 && toUnload.length === 0) {
		showText(ctx, "No Construct package changes selected. No files were changed.");
		return;
	}

	const loaded: DashboardPackage[] = [];
	const unloaded: DashboardPackage[] = [];
	const failures: string[] = [];
	const totalChanges = toLoad.length + toUnload.length;
	let progress = 0;
	try {
		for (const item of toLoad) {
			setConstructStatus(ctx, progressStatus("loading", ++progress, totalChanges, item.label));
			const result = await loadPackageIntoProject(pi, paths, { source: item.source, item: { id: item.id, kind: "package", source: item.source } });
			if (result.ok) loaded.push(item);
			else failures.push(`${item.id}: ${result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`}`);
		}
		for (const item of toUnload) {
			setConstructStatus(ctx, progressStatus("unloading", ++progress, totalChanges, item.label));
			const result = await unloadPackageFromProject(pi, paths, { source: item.source, id: item.id });
			if (result.ok) unloaded.push(item);
			else failures.push(`${item.id}: ${result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`}`);
		}
	} finally {
		setConstructStatus(ctx, undefined);
	}
	await showSummary(
		ctx,
		[
			"Construct loadout changes applied.",
			toLoad.length > 0 ? `Turned on: ${loaded.length}/${toLoad.length}` : undefined,
			...loaded.map((item) => `+ ${item.label}: ${item.source}`),
			toUnload.length > 0 ? `Turned off: ${unloaded.length}/${toUnload.length}` : undefined,
			...unloaded.map((item) => `- ${item.label}: ${item.source}`),
			...failures.map((failure) => `! ${failure}`),
			"Reload Pi resources with /construct reload or /reload when ready.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
