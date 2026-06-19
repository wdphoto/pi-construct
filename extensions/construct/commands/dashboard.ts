import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { deriveId, loadCatalog, normalizeSourceForLibrary, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { getPackages } from "../project-settings.js";
import { pickCheckboxes, progressStatus, setConstructStatus, showSummary, showText, type CheckboxPickerItem } from "../ui.js";
import { loadPackageIntoProject, unloadPackageFromProject } from "../package-ops.js";

interface DashboardPackage {
	id: string;
	label: string;
	source: string;
	section: "ON — Construct packages" | "OFF — Construct packages" | "AVAILABLE — Construct library" | "LOCAL-ONLY — not in Construct";
	checked: boolean;
	disabled?: boolean;
	marker?: string;
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
			section: active ? "ON — Construct packages" : "OFF — Construct packages",
			checked: active,
		});
	}

	for (const item of catalog.items) {
		if (managedSources.has(item.source) || projectSources.has(item.source)) continue;
		packages.push({
			id: item.id,
			label: item.id,
			source: item.source,
			section: "AVAILABLE — Construct library",
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
			section: "LOCAL-ONLY — not in Construct",
			checked: true,
			disabled: true,
			marker: "[!]",
		});
	}

	return { paths, packages, warnings };
}

function runtimeItems(pi: ExtensionAPI): CheckboxPickerItem[] {
	const commands = pi.getCommands();
	const skillCommands = commands
		.filter((command) => command.source === "skill")
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((command): CheckboxPickerItem => ({
			id: `skill-command:${command.name}`,
			label: `/${command.name}`,
			value: command.sourceInfo.source === "cli" ? command.sourceInfo.path : command.sourceInfo.source,
			section: "SKILL COMMANDS — runtime, read-only",
			checked: true,
			disabled: true,
			marker: "[i]",
		}));
	const otherCommands = commands
		.filter((command) => command.source !== "skill")
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 12)
		.map((command): CheckboxPickerItem => ({
			id: `command:${command.name}`,
			label: `/${command.name}`,
			value: command.sourceInfo.source === "cli" ? command.sourceInfo.path : command.sourceInfo.source,
			section: "COMMANDS — runtime, read-only",
			checked: true,
			disabled: true,
			marker: "[i]",
		}));
	return [...skillCommands, ...otherCommands];
}

function dashboardText(paths: ConstructPaths, packages: DashboardPackage[], runtime: CheckboxPickerItem[], warnings: string[]): string {
	const lines: string[] = ["Construct loadout", "=================", `Project: ${paths.cwd}`, ""];
	for (const section of ["ON — Construct packages", "OFF — Construct packages", "AVAILABLE — Construct library", "LOCAL-ONLY — not in Construct"] as const) {
		const sectionItems = packages.filter((item) => item.section === section);
		lines.push(section, "-".repeat(section.length));
		lines.push(...(sectionItems.length > 0 ? sectionItems.map((item) => `${item.marker ?? (item.checked ? "[x]" : "[ ]")} ${item.label}  ${item.source}`) : ["- none"]), "");
	}
	const skillItems = runtime.filter((item) => item.section?.startsWith("SKILL"));
	const commandItems = runtime.filter((item) => item.section?.startsWith("COMMAND"));
	lines.push("SKILL COMMANDS — runtime, read-only", "-----------------------------------", ...(skillItems.length > 0 ? skillItems.map((item) => `${item.marker} ${item.label}  ${item.value}`) : ["- none"]), "");
	lines.push("COMMANDS — runtime, read-only", "-----------------------------", ...(commandItems.length > 0 ? commandItems.map((item) => `${item.marker} ${item.label}  ${item.value}`) : ["- none"]), "");
	lines.push(...warnings.map((warning) => `! ${warning}`));
	lines.push("Space toggles Construct packages in TUI. Local-only and runtime items are read-only.", "Run /construct sync to adopt local-only packages.");
	return lines.join("\n");
}

export async function handleDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, packages, warnings } = await buildDashboardPackages(ctx);
	const runtime = runtimeItems(pi);
	if (ctx.mode !== "tui") {
		showText(ctx, dashboardText(paths, packages, runtime, warnings));
		return;
	}

	const pickerItems: CheckboxPickerItem[] = [
		...packages.map((item) => ({
			id: item.id,
			label: item.label,
			value: item.source,
			section: item.section,
			checked: item.checked,
			disabled: item.disabled,
			marker: item.marker,
		})),
		...runtime,
	];
	const selectedIds = await pickCheckboxes(ctx, "Construct loadout — packages, skills, commands", pickerItems);
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
