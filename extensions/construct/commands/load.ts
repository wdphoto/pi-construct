import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { dirname } from "node:path";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, parseCatalog, addSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages, parseProjectConstruct, uniqueManagedIdInConstruct, upsertConstructItem } from "../project-settings.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { pickCheckboxes, showSummary, showText, type CheckboxPickerItem } from "../ui.js";

interface LoadCandidate {
	id: string;
	source: string;
	alreadyKnown?: boolean;
}

interface LoadArgs {
	warnings: string[];
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
		const candidate = { id: catalogId ?? deriveId(source), source, alreadyKnown: catalogId !== undefined };
		if (managedSources.has(pkg.source) || managedSources.has(source)) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function parseLoadArgs(args: string): LoadArgs {
	const tokens = args.split(/\s+/).filter(Boolean);
	return { warnings: tokens.map((token) => `Unknown load argument ignored: ${token}`) };
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
	constructRead: Awaited<ReturnType<typeof readJson>>,
	selectedSources: string[],
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
		let construct = parseProjectConstruct(constructRead);
		for (const source of selectedSources) {
			const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
			const itemId = uniqueManagedIdInConstruct(construct, item?.id ?? deriveId(source), source);
			construct = upsertConstructItem(construct, itemId, source, source, paths);
			metadataChanged += 1;
		}
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Could not update project Construct metadata: ${message}`);
	}

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

	if (loadArgs.warnings.length > 0) {
		showText(ctx, ["Usage: /construct load", "", "Construct load reads this project's package declarations and adds them to the Construct.", ...loadArgs.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

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

	if (candidates.adoptable.length === 0) {
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
	if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = [
			...candidates.adoptable.map((candidate) => ({
				id: candidate.source,
				label: candidate.id,
				value: candidate.source,
				description: candidate.alreadyKnown ? "Already in the Construct library; load will arm project metadata." : undefined,
				checked: false,
				section: "NOT IN CONSTRUCT — available to load",
			})),
			...candidates.alreadyManaged.map((candidate) => ({
				id: `managed:${candidate.source}`,
				label: candidate.id,
				value: candidate.source,
				checked: true,
				disabled: true,
				section: "ALREADY IN CONSTRUCT — read-only",
				marker: "[x]",
			})),
		];
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
		showText(ctx, "No resources selected for Construct load. No files were changed.");
		return;
	}

	let result: ConstructLoadResult;
	try {
		result = await loadSourcesIntoConstruct(ctx, paths, constructRead, selectedSources);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	await showSummary(ctx, formatLoadResult(result));
}

