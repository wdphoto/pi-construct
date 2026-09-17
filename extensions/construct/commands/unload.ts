import { dirname } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths, JsonObject } from "../types.js";
import { loadCatalog } from "../catalog.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { collectPackageSourceSets, getPackages } from "../project-settings.js";
import { knownProjectCountForSources, knownProjectCounts, readKnownProjects, rememberKnownProject } from "../projects.js";
import { managedPackageSourceIdentity, packageSourceMatchValues } from "../sources.js";
import { TrustRefusedError, targetTrustDecision } from "../target-trust.js";
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

function overlaps(a: Iterable<string>, b: Set<string>): boolean {
	for (const value of a) if (b.has(value)) return true;
	return false;
}

async function sourceMatchSet(source: string, paths: ConstructPaths): Promise<Set<string>> {
	const settingsDir = dirname(paths.projectSettingsPath);
	return new Set([source, ...(await packageSourceMatchValues(source, settingsDir)), ...(await packageSourceMatchValues(source, paths.cwd))]);
}

async function findUnloadItems(items: CatalogItem[], queries: string[], paths: ConstructPaths): Promise<{ selected: CatalogItem[]; missing: string[] }> {
	const selected = new Map<string, CatalogItem>();
	const missing: string[] = [];
	const itemMatches = new Map<string, Set<string>>();
	for (const item of items) itemMatches.set(catalogItemKey(item), await sourceMatchSet(item.source, paths));
	for (const query of queries) {
		const queryMatches = await sourceMatchSet(query, paths);
		const matches = items.filter((candidate) => candidate.id === query || candidate.source === query || candidate.name === query || overlaps(itemMatches.get(catalogItemKey(candidate)) ?? [], queryMatches));
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
	if (settingsRead.state === "invalid") return { active: 0, warning: `Could not check current project package state because ${describeJsonReadIssue(".pi/settings.json", settingsRead)}` };

	const settingsDir = dirname(paths.projectSettingsPath);
	const packageSources = await collectPackageSourceSets(getPackages(settingsRead), settingsDir);

	let active = 0;
	for (const item of selected) {
		const matches = await packageSourceMatchValues(item.source, settingsDir);
		if (matches.some((match) => packageSources.declaredSources.has(match))) active += 1;
	}
	return { active };
}

async function removeCurrentProjectMetadata(paths: ConstructPaths, removed: CatalogItem[], prewrite?: () => Promise<void>): Promise<{ removed: number; warning?: string }> {
	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "missing") return { removed: 0 };
	if (constructRead.state === "invalid") return { removed: 0, warning: `Could not update project Construct metadata because ${describeJsonReadIssue(".pi/construct.json", constructRead)}` };
	if (!isObject(constructRead.data)) return { removed: 0, warning: "Could not update project Construct metadata because .pi/construct.json is not an object." };
	if (!isObject(constructRead.data.items)) return { removed: 0 };

	// Removed-side identity union: reuse sourceMatchSet so an equivalent catalog spelling
	// (e.g. git...@main vs plain https git URL) matches the same construct metadata source.
	const removedSources = new Set<string>();
	for (const item of removed) {
		for (const match of await sourceMatchSet(item.source, paths)) removedSources.add(match);
	}
	const nextItems: JsonObject = {};
	let removedCount = 0;
	for (const [id, value] of Object.entries(constructRead.data.items)) {
		let shouldRemove = false;
		if (isObject(value) && value.kind === "package") {
			const identity = await managedPackageSourceIdentity(value, paths);
			shouldRemove = [...identity.matchSources].some((source) => removedSources.has(source));
		}
		if (shouldRemove) removedCount += 1;
		else nextItems[id] = value;
	}
	if (removedCount > 0) {
		await prewrite?.();
		await writeJson(paths.projectConstructPath, { ...constructRead.data, items: nextItems });
	}
	return { removed: removedCount };
}

export interface UnloadSelection {
	id: string;
	source: string;
}

class UnloadAbortedError extends Error {
	constructor() {
		super("Unload cancelled");
		this.name = "UnloadAbortedError";
	}
}

export interface UnloadMutationResult {
	removed: CatalogItem[];
	missing: string[];
	metadataRemoved: number;
	activeRemaining?: number;
	knownProjectLines: string[];
	indexUpdated: boolean;
	trustSkipped: boolean;
	trustReason?: "untrusted" | "unknown";
	metadataCleanupFailed?: boolean;
	warnings: string[];
	cancelled: boolean;
	error?: string;
	refusal?: string;
}

// Shared catalog/profile/current-metadata mutation used by both /construct unload and the
// dashboard u action. Global library cleanup is independent of cwd trust; current-project
// metadata and the known-project index are gated by fresh native current trust and bounded
// cancellation before each write.
export async function unloadConstructSources(
	ctx: ExtensionCommandContext,
	selections: UnloadSelection[],
	options: {
		signal?: AbortSignal;
		progress?: (title: string, lines: string[]) => void;
		validate?: (reviewed: UnloadSelection[]) => Promise<{ refusal?: string; error?: string } | undefined>;
	} = {},
): Promise<UnloadMutationResult | undefined> {
	const paths = await getPaths(ctx);
	const aborted = () => options.signal?.aborted === true;
	const empty = (overrides: Partial<UnloadMutationResult>): UnloadMutationResult => ({
		removed: [],
		missing: [],
		metadataRemoved: 0,
		knownProjectLines: [],
		indexUpdated: false,
		trustSkipped: false,
		warnings: [],
		cancelled: false,
		...overrides,
	});
	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct unload", options.progress, options.signal);
	if (!ready || aborted()) return undefined;

	// Narrow validation callback runs after the idle wait and before any write.
	if (options.validate) {
		const validation = await options.validate(selections);
		if (aborted()) return undefined;
		if (validation?.error) return empty({ error: validation.error });
		if (validation?.refusal) return empty({ refusal: validation.refusal });
	}
	if (aborted()) return undefined;

	const reviewedKeys = new Set(selections.map((selection) => `${selection.id}\u0000${selection.source}`));
	let freshCatalog: Awaited<ReturnType<typeof loadCatalog>>;
	try {
		freshCatalog = await loadCatalog(ctx);
	} catch (error) {
		return empty({ error: `Could not read the Construct library: ${error instanceof Error ? error.message : String(error)}` });
	}
	if (freshCatalog.read.state === "invalid") return empty({ error: describeJsonReadIssue("Construct library catalog", freshCatalog.read) });
	if (freshCatalog.read.state === "ok" && freshCatalog.warnings.length > 0) return empty({ error: `Fix ${paths.userCatalogPath} first.` });
	// Apply narrows to the exact reviewed id+source keys; it never re-resolves broadly against the
	// fresh catalog, so equivalent entries that appeared after review are not widened into the set.
	const selected = freshCatalog.catalog.items.filter((item) => reviewedKeys.has(catalogItemKey(item)));
	const freshKeys = new Set(selected.map(catalogItemKey));
	const missing = selections
		.filter((selection) => !freshKeys.has(`${selection.id}\u0000${selection.source}`))
		.map((selection) => `${selection.id}: ${selection.source} disappeared before unload`);
	if (aborted()) return undefined;
	if (selected.length === 0) return empty({ missing });

	const warnings: string[] = [];
	let indexUpdated = false;
	let trustSkipped = false;
	let trustReason: "untrusted" | "unknown" | undefined;
	const completed = (overrides: Partial<UnloadMutationResult>): UnloadMutationResult => ({
		removed: selected,
		missing,
		metadataRemoved: 0,
		knownProjectLines: [],
		indexUpdated,
		trustSkipped,
		trustReason,
		warnings,
		cancelled: false,
		...overrides,
	});
	const partial = (): UnloadMutationResult => completed({ removed: [], cancelled: true });

	// Actual project-side writes use fresh current trust + abort before AND after the native await.
	const prewriteProjectWrite = async (): Promise<void> => {
		if (aborted()) throw new UnloadAbortedError();
		const trust = await targetTrustDecision(ctx, paths.cwd);
		if (aborted()) throw new UnloadAbortedError();
		if (trust !== "trusted") throw new TrustRefusedError(paths.cwd, trust);
	};

	// Known-project index write (independent of catalog removal).
	if (aborted()) return partial();
	try {
		const remembered = await rememberKnownProject(ctx, prewriteProjectWrite);
		if (remembered.warning) warnings.push(remembered.warning);
		if (remembered.updated) indexUpdated = true;
	} catch (error) {
		if (error instanceof TrustRefusedError) {
			trustSkipped = true;
			trustReason = error.reason;
		} else if (error instanceof UnloadAbortedError) {
			return partial();
		} else {
			warnings.push(`Could not update the known-project index: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (aborted()) return partial();

	// Source-count diagnostics read after the index refresh (as the command originally did).
	const selectedKnownCounts = await knownProjectCountsByItem(ctx, selected);
	warnings.push(...selectedKnownCounts.warnings);

	const removedIds = new Set(selected.map((item) => item.id));
	const removedKeys = new Set(selected.map(catalogItemKey));
	const removedSourceMatches = new Set<string>();
	for (const item of selected) for (const match of await sourceMatchSet(item.source, paths)) removedSourceMatches.add(match);
	const nextItems = freshCatalog.catalog.items.filter((item) => !removedKeys.has(catalogItemKey(item)));
	const nextProfiles = [];
	for (const profile of freshCatalog.catalog.profiles) {
		const nextProfileItems = profile.items.filter((id) => !removedIds.has(id));
		const nextSources: string[] = [];
		for (const source of profile.sources) {
			if (!overlaps(await sourceMatchSet(source, paths), removedSourceMatches)) nextSources.push(source);
		}
		// Preserve unchanged parsed recipe fields (including updatedAt); only rewrite when membership shrinks.
		// Note: the whole catalog is reserialized, so this is field preservation, not raw-byte preservation.
		if (nextProfileItems.length === profile.items.length && nextSources.length === profile.sources.length) {
			nextProfiles.push(profile);
		} else {
			nextProfiles.push({
				...profile,
				items: nextProfileItems,
				sources: nextSources,
				updatedAt: new Date().toISOString(),
			});
		}
	}
	if (aborted()) return partial();
	try {
		await writeJson(paths.userCatalogPath, { ...freshCatalog.catalog, version: 1, items: nextItems, profiles: nextProfiles });
	} catch (error) {
		// Any index write already completed survives; library removal did not happen.
		return completed({ removed: [], error: `Could not update the Construct library: ${error instanceof Error ? error.message : String(error)}` });
	}

	// Current-project metadata write (trust + abort gated at the write), skipped if trust was latched off.
	let metadataRemoved = 0;
	let metadataCleanupFailed = false;
	if (!trustSkipped) {
		if (aborted()) return completed({ cancelled: true });
		try {
			const metadata = await removeCurrentProjectMetadata(paths, selected, prewriteProjectWrite);
			metadataRemoved = metadata.removed;
			if (metadata.warning) {
				warnings.push(metadata.warning);
				metadataCleanupFailed = true;
			}
		} catch (error) {
			if (error instanceof TrustRefusedError) {
				trustSkipped = true;
				trustReason = error.reason;
			} else if (error instanceof UnloadAbortedError) {
				return completed({ cancelled: true, metadataCleanupFailed: true });
			} else {
				warnings.push(`Could not update current project Construct metadata: ${error instanceof Error ? error.message : String(error)}`);
				metadataCleanupFailed = true;
			}
		}
	}

	let activeRemaining: number | undefined;
	try {
		const currentProject = await currentProjectActiveCount(paths, selected);
		if (currentProject.warning) {
			// Unreadable declarations are unknown, not "no declarations".
			warnings.push(currentProject.warning);
		} else {
			activeRemaining = currentProject.active;
		}
	} catch (error) {
		warnings.push(`Could not read current project declarations: ${error instanceof Error ? error.message : String(error)}`);
	}
	const knownProjectLines = selected.map((item) => `Known projects for ${item.id}: ${selectedKnownCounts.counts.get(catalogItemKey(item)) ?? 0}`);
	return completed({ removed: selected, metadataRemoved, activeRemaining, knownProjectLines, cancelled: aborted(), metadataCleanupFailed });
}

export async function handleUnload(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { read, catalog, warnings } = await loadCatalog(ctx);
	if (read.state === "invalid") {
		showText(ctx, `Construct unload failed.\n${describeJsonReadIssue("Construct library catalog", read)}`);
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
		const result = await findUnloadItems(catalog.items, queries, paths);
		selected = result.selected;
		missing = result.missing;
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = catalog.items.map((item) => {
			const count = knownCounts.counts.get(catalogItemKey(item)) ?? 0;
			return {
				id: catalogItemKey(item),
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
		selected = catalog.items.filter((item) => ids.has(catalogItemKey(item)));
	} else {
		showText(ctx, [unloadUsage(), "", "Available:", ...catalog.items.map((item) => `- ${item.id}: ${item.source}`)].join("\n"));
		return;
	}

	if (selected.length === 0) {
		showText(ctx, ["Construct unload complete.", "No matching resources were selected.", ...missing.map((query) => `! Not found: ${query}`), "No files were changed."].join("\n"));
		return;
	}

	const result = await unloadConstructSources(ctx, selected.map((item) => ({ id: item.id, source: item.source })));
	if (!result) {
		showText(ctx, ["Construct unload cancelled.", "No files were changed.", ...missing.map((query) => `! Not found: ${query}`)].join("\n"));
		return;
	}
	if (result.refusal) {
		showText(ctx, ["Construct unload needs re-review.", result.refusal, ...missing.map((query) => `! Not found: ${query}`), "No files were changed."].join("\n"));
		return;
	}
	if (result.error) {
		showText(
			ctx,
			[
				"Construct unload failed.",
				`Construct library removed: ${result.removed.length}`,
				`Current project Construct metadata removed: ${result.metadataRemoved}`,
				result.indexUpdated ? "Known-project index was updated before the failure." : undefined,
				...result.warnings.map((warning) => `! ${warning}`),
				...missing.map((query) => `! Not found: ${query}`),
				`! ${result.error}`,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}
	const outputWarnings = [
		...missing.map((query) => `Not found: ${query}`),
		...knownCounts.warnings,
		...result.warnings,
	];
	const trustLine = result.trustSkipped
		? result.indexUpdated
			? "Known-project index was updated; current-project Construct metadata was not updated (project not trusted)."
			: "Project is not trusted by Pi; current-project Construct metadata and known-project index were not updated."
		: undefined;
	const activeLine = result.activeRemaining === undefined
		? "Project declarations were not read; .pi/settings.json was left unchanged."
		: result.activeRemaining > 0
			? result.trustSkipped
				? `Still declared in this project: ${result.activeRemaining} (current-project metadata was not updated).`
				: result.metadataCleanupFailed
					? `Still declared in this project: ${result.activeRemaining} (current-project metadata cleanup was incomplete).`
					: `Still declared in this project: ${result.activeRemaining} (may be disabled or unresolved; shown as Unloaded in /construct).`
			: "No selected sources are still declared in this project.";
	const hadWrites = result.removed.length > 0 || result.indexUpdated || result.metadataRemoved > 0;
	await showSummary(
		ctx,
		[
			"Construct unload complete.",
			`Construct forgot: ${result.removed.length} resource${result.removed.length === 1 ? "" : "s"}`,
			`Current project Construct metadata removed: ${result.metadataRemoved}`,
			"Project package declarations were left alone in .pi/settings.json.",
			trustLine,
			activeLine,
			...result.knownProjectLines,
			"Known-project counts are informational only.",
			"Packages may still be active in other projects too; unload only removes Construct ownership/metadata.",
			...result.removed.map((item) => `- ${item.id}: ${item.source}`),
			...result.missing.map((entry) => `! ${entry}`),
			...outputWarnings.map((warning) => `! ${warning}`),
			result.cancelled && hadWrites ? "Cancelled after some writes; remaining steps were skipped." : undefined,
			"No /reload needed; unload does not disable packages or edit .pi/settings.json.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
