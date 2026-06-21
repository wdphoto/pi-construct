import { dirname } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths, JsonObject } from "../types.js";
import { loadCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages } from "../project-settings.js";
import { knownProjectCountForSources, knownProjectCounts, readKnownProjects, rememberKnownProject } from "../projects.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary } from "../sources.js";
import { pickCheckboxes, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

function unloadUsage(): string {
	return [
		"Usage: /construct unload [id-or-source ...]",
		"",
		"Removes resources from the Construct library.",
		"Project package declarations stay in .pi/settings.json.",
	].join("\n");
}

function catalogItemKey(item: CatalogItem): string {
	return `${item.id}\u0000${item.source}`;
}

function findUnloadItems(items: CatalogItem[], queries: string[]): { selected: CatalogItem[]; missing: string[] } {
	const selected = new Map<string, CatalogItem>();
	const missing: string[] = [];
	for (const query of queries) {
		const matches = items.filter((candidate) => candidate.id === query || candidate.source === query || candidate.name === query);
		if (matches.length === 0) missing.push(query);
		else for (const item of matches) selected.set(catalogItemKey(item), item);
	}
	return { selected: [...selected.values()], missing };
}

async function knownProjectCountsByItem(ctx: ExtensionCommandContext, items: CatalogItem[]): Promise<{ counts: Map<string, number>; warnings: string[] }> {
	const known = await readKnownProjects(ctx);
	const sourceCounts = knownProjectCounts(known.data);
	const counts = new Map<string, number>();
	for (const item of items) counts.set(catalogItemKey(item), knownProjectCountForSources(sourceCounts, [item.source]));
	return { counts, warnings: known.warnings };
}

async function currentProjectActiveCount(paths: ConstructPaths, selected: CatalogItem[]): Promise<{ active: number; warning?: string }> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "missing") return { active: 0 };
	if (settingsRead.state === "invalid") return { active: 0, warning: `Could not check current project package state because .pi/settings.json is invalid JSON: ${settingsRead.error}` };

	const settingsDir = dirname(paths.projectSettingsPath);
	const activeSources = new Set<string>();
	for (const pkg of getPackages(settingsRead)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		activeSources.add(pkg.source);
		activeSources.add(await normalizeSourceForLibrary(pkg.source, settingsDir));
	}

	let active = 0;
	for (const item of selected) {
		const normalized = await normalizeSourceForLibrary(item.source, settingsDir);
		if (activeSources.has(item.source) || activeSources.has(normalized)) active += 1;
	}
	return { active };
}

async function removeCurrentProjectMetadata(paths: ConstructPaths, removed: CatalogItem[]): Promise<{ removed: number; warning?: string }> {
	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "missing") return { removed: 0 };
	if (constructRead.state === "invalid") return { removed: 0, warning: `Could not update project Construct metadata because .pi/construct.json is invalid JSON: ${constructRead.error}` };
	if (!isObject(constructRead.data)) return { removed: 0, warning: "Could not update project Construct metadata because .pi/construct.json is not an object." };
	if (!isObject(constructRead.data.items)) return { removed: 0 };

	const removedIds = new Set(removed.map((item) => item.id));
	const removedSources = new Set(removed.map((item) => item.source));
	const nextItems: JsonObject = {};
	let removedCount = 0;
	for (const [id, value] of Object.entries(constructRead.data.items)) {
		let shouldRemove = false;
		if (isObject(value) && value.kind === "package") {
			const identity = await managedPackageSourceIdentity(value, paths);
			shouldRemove = [...identity.matchSources].some((source) => removedSources.has(source));
		}
		if (!shouldRemove && removedIds.has(id)) shouldRemove = true;
		if (shouldRemove) removedCount += 1;
		else nextItems[id] = value;
	}
	if (removedCount > 0) await writeJson(paths.projectConstructPath, { ...constructRead.data, items: nextItems });
	return { removed: removedCount };
}

export async function handleUnload(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { read, catalog, warnings } = await loadCatalog(ctx);
	if (read.state === "invalid") {
		showText(ctx, `Construct unload failed.\nConstruct library catalog is invalid JSON.\n${read.error}`);
		return;
	}
	if (read.state === "ok" && warnings.length > 0) {
		showText(ctx, ["Construct unload failed.", `Fix ${paths.userCatalogPath} first.`, ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	if (catalog.items.length === 0) {
		showText(ctx, "Construct unload complete. The Construct library is already empty. No files were changed.");
		return;
	}

	const knownCounts = await knownProjectCountsByItem(ctx, catalog.items);
	const queries = args.split(/\s+/).filter(Boolean);
	let selected: CatalogItem[] = [];
	let missing: string[] = [];
	if (queries.length > 0) {
		const result = findUnloadItems(catalog.items, queries);
		selected = result.selected;
		missing = result.missing;
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = catalog.items.map((item) => {
			const count = knownCounts.counts.get(catalogItemKey(item)) ?? 0;
			return {
				id: item.id,
				label: item.id,
				value: item.source,
				description: `Known projects: ${count}`,
				checked: false,
			};
		});
		const result = await pickCheckboxes(ctx, "Construct unload — remove from Construct", pickerItems, { confirmHint: "Enter removes" });
		if (!result) {
			showText(ctx, "Construct unload cancelled. No files were changed.");
			return;
		}
		const ids = new Set(result.selectedIds);
		selected = catalog.items.filter((item) => ids.has(item.id));
	} else {
		showText(ctx, [unloadUsage(), "", "Available:", ...catalog.items.map((item) => `- ${item.id}: ${item.source}`)].join("\n"));
		return;
	}

	if (selected.length === 0) {
		showText(ctx, ["Construct unload complete.", "No matching resources were selected.", ...missing.map((query) => `! Not found: ${query}`), "No files were changed."].join("\n"));
		return;
	}

	await waitForIdleBeforeConstructWrite(ctx, "Construct unload");
	const remembered = await rememberKnownProject(ctx);
	const selectedKnownCounts = await knownProjectCountsByItem(ctx, selected);

	const removedIds = new Set(selected.map((item) => item.id));
	const removedSources = new Set(selected.map((item) => item.source));
	const removedKeys = new Set(selected.map(catalogItemKey));
	const nextItems = catalog.items.filter((item) => !removedKeys.has(catalogItemKey(item)));
	const nextProfiles = catalog.profiles.map((profile) => ({
		...profile,
		items: profile.items.filter((id) => !removedIds.has(id)),
		sources: profile.sources.filter((source) => !removedSources.has(source)),
		updatedAt: new Date().toISOString(),
	}));
	await writeJson(paths.userCatalogPath, { ...catalog, version: 1, items: nextItems, profiles: nextProfiles });

	const [metadata, currentProject] = await Promise.all([removeCurrentProjectMetadata(paths, selected), currentProjectActiveCount(paths, selected)]);
	const knownProjectLines = selected.map((item) => `Known projects for ${item.id}: ${selectedKnownCounts.counts.get(catalogItemKey(item)) ?? 0}`);
	const outputWarnings = [
		...missing.map((query) => `Not found: ${query}`),
		...knownCounts.warnings,
		...selectedKnownCounts.warnings,
		...(remembered.warning ? [remembered.warning] : []),
		...(metadata.warning ? [metadata.warning] : []),
		...(currentProject.warning ? [currentProject.warning] : []),
	];
	await showSummary(
		ctx,
		[
			"Construct unload complete.",
			`Construct forgot: ${selected.length} resource${selected.length === 1 ? "" : "s"}`,
			metadata.removed > 0 ? `Current project Construct metadata removed: ${metadata.removed}` : "Current project Construct metadata removed: 0",
			"Project package declarations were left alone in .pi/settings.json.",
			currentProject.active > 0 ? `Still active in this project: ${currentProject.active} resource${currentProject.active === 1 ? "" : "s"} (shown as Installed in /construct).` : "No selected resources are active in this project's .pi/settings.json.",
			...knownProjectLines,
			"Known-project counts are informational only.",
			"Packages may still be active in other projects too; unload only removes Construct ownership/metadata.",
			...selected.map((item) => `- ${item.id}: ${item.source}`),
			...outputWarnings.map((warning) => `! ${warning}`),
			"No /reload needed; unload does not disable packages or edit .pi/settings.json.",
		].join("\n"),
	);
}
