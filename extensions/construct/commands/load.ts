import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { dirname } from "node:path";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, parseCatalog, addSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages, parseProjectConstruct, uniqueManagedIdInConstruct, upsertConstructItem } from "../project-settings.js";
import { rememberKnownProject } from "../projects.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { pickCheckboxes, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

interface LoadCandidate {
	id: string;
	source: string;
	alreadyKnown?: boolean;
	disabledByFilters?: boolean;
}

interface LoadArgs {
	queries: string[];
}

async function constructManagedSources(paths: Awaited<ReturnType<typeof getPaths>>): Promise<Set<string>> {
	const construct = await readJson(paths.projectConstructPath);
	const sources = new Set<string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return sources;
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		for (const source of identity.matchSources) sources.add(source);
	}
	return sources;
}

export async function projectLoadCandidates(paths: Awaited<ReturnType<typeof getPaths>>): Promise<{ adoptable: LoadCandidate[]; alreadyManaged: LoadCandidate[] }> {
	const settings = await readJson(paths.projectSettingsPath);
	const managedSources = await constructManagedSources(paths);
	const { catalog } = await loadCatalog({ cwd: paths.cwd });
	const catalogItemsBySource = new Map<string, string>();
	for (const item of catalog.items) {
		catalogItemsBySource.set(item.source, item.id);
		catalogItemsBySource.set(await normalizeSourceForLibrary(item.source, dirname(paths.projectSettingsPath)), item.id);
	}

	const seen = new Set<string>();
	const adoptable: LoadCandidate[] = [];
	const alreadyManaged: LoadCandidate[] = [];
	for (const pkg of getPackages(settings)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		const source = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (seen.has(source)) continue;
		seen.add(source);
		const catalogId = catalogItemsBySource.get(pkg.source) ?? catalogItemsBySource.get(source);
		const candidate = { id: catalogId ?? deriveId(source), source, alreadyKnown: catalogId !== undefined, disabledByFilters: pkg.disabledByFilters };
		if (managedSources.has(pkg.source) || managedSources.has(source)) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function parseLoadArgs(args: string): LoadArgs {
	return { queries: args.split(/\s+/).filter(Boolean) };
}

async function candidateMatchesQuery(paths: Awaited<ReturnType<typeof getPaths>>, candidate: LoadCandidate, query: string): Promise<boolean> {
	if (candidate.id === query || candidate.source === query) return true;
	const settingsDir = dirname(paths.projectSettingsPath);
	const normalized = new Set([
		await normalizeSourceForLibrary(query, settingsDir),
		await normalizeSourceForLibrary(query, paths.cwd),
	]);
	return normalized.has(candidate.source);
}

async function findLoadCandidates(
	paths: Awaited<ReturnType<typeof getPaths>>,
	candidates: { adoptable: LoadCandidate[]; alreadyManaged: LoadCandidate[] },
	queries: string[],
): Promise<{ selected: LoadCandidate[]; alreadyManaged: string[]; missing: string[] }> {
	const selected = new Map<string, LoadCandidate>();
	const alreadyManaged: string[] = [];
	const missing: string[] = [];
	for (const query of queries) {
		const adoptableMatches: LoadCandidate[] = [];
		for (const candidate of candidates.adoptable) {
			if (await candidateMatchesQuery(paths, candidate, query)) adoptableMatches.push(candidate);
		}
		if (adoptableMatches.length > 0) {
			for (const candidate of adoptableMatches) selected.set(candidate.source, candidate);
			continue;
		}

		let managedMatch = false;
		for (const candidate of candidates.alreadyManaged) {
			if (await candidateMatchesQuery(paths, candidate, query)) {
				managedMatch = true;
				break;
			}
		}
		if (managedMatch) alreadyManaged.push(query);
		else missing.push(query);
	}
	return { selected: [...selected.values()], alreadyManaged, missing };
}

export interface ConstructLoadResult {
	added: CatalogItem[];
	alreadyKnown: number;
	warnings: string[];
	metadataChanged: number;
	selectedSources: number;
}

export async function loadSourcesIntoConstruct(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	paths: Awaited<ReturnType<typeof getPaths>>,
	selectedSources: string[],
	options: { enabledBySource?: Map<string, boolean> } = {},
): Promise<ConstructLoadResult> {
	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	const warnings: string[] = [];
	const result = await addSourcesToCatalog(ctx, selectedSources);
	added.push(...result.added);
	alreadyKnown += result.alreadyKnown;
	warnings.push(...result.warnings);

	const addedBySource = new Map(added.map((item) => [item.source, item]));
	const { catalog } = await loadCatalog(ctx);
	let metadataChanged = 0;
	try {
		const constructRead = await readJson(paths.projectConstructPath);
		let construct = parseProjectConstruct(constructRead);
		let nextMetadataChanged = 0;
		for (const source of selectedSources) {
			const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
			const itemId = uniqueManagedIdInConstruct(construct, item?.id ?? deriveId(source), source);
			const enabled = options.enabledBySource?.get(source);
			construct = upsertConstructItem(construct, itemId, source, source, paths, { enabled });
			nextMetadataChanged += 1;
		}
		await writeJson(paths.projectConstructPath, construct);
		metadataChanged = nextMetadataChanged;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Could not update project Construct metadata: ${message}`);
	}

	const remembered = await rememberKnownProject(ctx);
	if (remembered.warning) warnings.push(remembered.warning);

	return { added, alreadyKnown, warnings, metadataChanged, selectedSources: selectedSources.length };
}

export function formatLoadResult(result: ConstructLoadResult): string {
	const skipped = Math.max(0, result.selectedSources - result.added.length);
	return [
		"Construct load complete.",
		`Added to Construct: ${result.added.length}`,
		`Already known: ${Math.max(skipped, result.alreadyKnown)}`,
		`Errors: ${result.warnings.length}`,
		result.metadataChanged > 0 ? `Project items armed: ${result.metadataChanged}` : undefined,
		...result.warnings.map((warning) => `! ${warning}`),
		"No /reload needed; load only updates the Construct library and project metadata.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function handleLoad(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const loadArgs = parseLoadArgs(args);
	const paths = await getPaths(ctx);

	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "invalid") {
		showText(ctx, `Construct load failed.\nCannot load because .pi/settings.json is invalid JSON.\n${settingsRead.error}`);
		return;
	}
	if (settingsRead.state === "ok" && !isObject(settingsRead.data)) {
		showText(ctx, "Construct load failed.\nCannot load because .pi/settings.json is not a JSON object.");
		return;
	}

	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "invalid") {
		showText(ctx, `Construct load failed.\nCannot load because .pi/construct.json is invalid JSON.\n${constructRead.error}`);
		return;
	}
	if (constructRead.state === "ok" && !isObject(constructRead.data)) {
		showText(ctx, "Construct load failed.\nCannot load because .pi/construct.json is not a JSON object.");
		return;
	}

	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		showText(ctx, `Construct load failed.\nCannot load because Construct library catalog is invalid JSON.\n${catalogRead.error}`);
		return;
	}
	const catalogCheck = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && catalogCheck.warnings.length > 0) {
		showText(ctx, [`Construct load failed.`, `Cannot load because Construct library catalog has structural warnings. Fix ${paths.userCatalogPath} first.`, ...catalogCheck.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	let candidates: { adoptable: LoadCandidate[]; alreadyManaged: LoadCandidate[] };
	try {
		candidates = await projectLoadCandidates(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	if (candidates.adoptable.length === 0 && loadArgs.queries.length === 0) {
		showText(
			ctx,
			[
				"Construct load complete.",
				`Project: ${paths.cwd}`,
				"No project package declarations are waiting to be loaded.",
				candidates.alreadyManaged.length > 0 ? `Already Construct-managed here: ${candidates.alreadyManaged.length}` : "No Construct-managed project packages found.",
				"No files were changed.",
			].join("\n"),
		);
		return;
	}

	let selectedSources: string[] = [];
	const selectionWarnings: string[] = [];
	if (loadArgs.queries.length > 0) {
		const direct = await findLoadCandidates(paths, candidates, loadArgs.queries);
		selectedSources = direct.selected.map((candidate) => candidate.source);
		selectionWarnings.push(...direct.alreadyManaged.map((query) => `Already Construct-managed here: ${query}`));
		selectionWarnings.push(...direct.missing.map((query) => `Not an unloaded project package declaration: ${query}`));
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = candidates.adoptable.map((candidate) => ({
			id: candidate.source,
			label: candidate.id,
			value: candidate.source,
			description: candidate.alreadyKnown ? "Already in the Construct library; load will arm project metadata." : undefined,
			checked: false,
			section: "UNLOADED — available to load",
		}));
		const selected = await pickCheckboxes(ctx, "Construct load — add project resources", pickerItems);
		if (!selected) {
			showText(ctx, "Construct load cancelled. No files were changed.");
			return;
		}
		const adoptableSources = new Set(candidates.adoptable.map((candidate) => candidate.source));
		selectedSources = selected.selectedIds.filter((source) => adoptableSources.has(source));
	} else {
		selectedSources = candidates.adoptable.map((candidate) => candidate.source);
	}

	if (selectedSources.length === 0) {
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), "No files were changed."].join("\n"));
		return;
	}

	await waitForIdleBeforeConstructWrite(ctx, "Construct load");

	try {
		const freshCandidates = await projectLoadCandidates(paths);
		const selectedBeforeWait = new Set(selectedSources);
		const freshSelected = freshCandidates.adoptable.filter((candidate) => selectedBeforeWait.has(candidate.source));
		const freshSelectedSources = new Set(freshSelected.map((candidate) => candidate.source));
		selectionWarnings.push(...selectedSources.filter((source) => !freshSelectedSources.has(source)).map((source) => `No longer an unloaded project package declaration after waiting: ${source}`));
		selectedSources = freshSelected.map((candidate) => candidate.source);
		candidates = freshCandidates;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\nCould not re-check project package declarations after waiting.\n${message}`);
		return;
	}

	if (selectedSources.length === 0) {
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), "No files were changed."].join("\n"));
		return;
	}

	const selectedAfterWait = new Set(selectedSources);
	const enabledBySource = new Map(candidates.adoptable.filter((candidate) => selectedAfterWait.has(candidate.source)).map((candidate) => [candidate.source, !candidate.disabledByFilters]));
	let result: ConstructLoadResult;
	try {
		result = await loadSourcesIntoConstruct(ctx, paths, selectedSources, { enabledBySource });
		result.warnings.push(...selectionWarnings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	await showSummary(ctx, formatLoadResult(result));
}

