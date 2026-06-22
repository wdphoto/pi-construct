import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, DirectResourceSummary, DirectResourceKind, JsonObject } from "../types.js";
import { dirname } from "node:path";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, parseCatalog, addSourcesToCatalog } from "../catalog.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages, parseProjectConstruct, uniqueManagedIdInConstruct, upsertConstructItem } from "../project-settings.js";
import { collectDirectProjectResources } from "../resources.js";
import { rememberKnownProject } from "../projects.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { pickCheckboxes, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

interface LoadCandidate {
	kind: "package";
	id: string;
	source: string;
	alreadyKnown?: boolean;
	disabledByFilters?: boolean;
}

interface DirectLoadCandidate {
	kind: DirectResourceKind;
	id: string;
	path: string;
	displayPath: string;
	resource: DirectResourceSummary;
}

type AnyLoadCandidate = LoadCandidate | DirectLoadCandidate;

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
		const candidate: LoadCandidate = { kind: "package", id: catalogId ?? deriveId(source), source, alreadyKnown: catalogId !== undefined, disabledByFilters: pkg.disabledByFilters };
		if (managedSources.has(pkg.source) || managedSources.has(source)) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

async function projectDirectLoadCandidates(ctx: ExtensionCommandContext, paths: Awaited<ReturnType<typeof getPaths>>): Promise<{ adoptable: DirectLoadCandidate[]; alreadyManaged: DirectLoadCandidate[]; warnings: string[] }> {
	const constructRead = await readJson(paths.projectConstructPath);
	const direct = await collectDirectProjectResources(ctx, paths, constructRead);
	const adoptable: DirectLoadCandidate[] = [];
	const alreadyManaged: DirectLoadCandidate[] = [];
	for (const resource of direct.resources) {
		const candidate: DirectLoadCandidate = {
			kind: resource.kind,
			id: `${resource.kind}:${resource.name}`,
			path: resource.path,
			displayPath: resource.displayPath,
			resource,
		};
		if (resource.managed) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id) || a.displayPath.localeCompare(b.displayPath)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id) || a.displayPath.localeCompare(b.displayPath)),
		warnings: direct.warnings,
	};
}

function parseLoadArgs(args: string): LoadArgs {
	return { queries: args.split(/\s+/).filter(Boolean) };
}

async function candidateMatchesQuery(paths: Awaited<ReturnType<typeof getPaths>>, candidate: AnyLoadCandidate, query: string): Promise<boolean> {
	if (candidate.id === query) return true;
	if (candidate.kind !== "package") {
		return candidate.path === query || candidate.displayPath === query || candidate.resource.name === query || `${candidate.kind}:${candidate.resource.name}` === query;
	}
	if (candidate.source === query) return true;
	const settingsDir = dirname(paths.projectSettingsPath);
	const normalized = new Set([
		await normalizeSourceForLibrary(query, settingsDir),
		await normalizeSourceForLibrary(query, paths.cwd),
	]);
	return normalized.has(candidate.source);
}

function candidateKey(candidate: AnyLoadCandidate): string {
	return candidate.kind === "package" ? `package:${candidate.source}` : `${candidate.kind}:${candidate.path}`;
}

function candidateValue(candidate: AnyLoadCandidate): string {
	return candidate.kind === "package" ? candidate.source : candidate.displayPath;
}

function candidateDescription(candidate: AnyLoadCandidate): string | undefined {
	if (candidate.kind === "package") return candidate.alreadyKnown ? "Already in the Construct library; load will arm project metadata." : undefined;
	return candidate.resource.enabled
		? `Project ${candidate.kind} discovered by Pi; load will adopt it into project Construct metadata only.`
		: `Project ${candidate.kind} is disabled by Pi filters; load will preserve that disabled state in Construct metadata.`;
}

async function findLoadCandidates(
	paths: Awaited<ReturnType<typeof getPaths>>,
	candidates: { adoptable: AnyLoadCandidate[]; alreadyManaged: AnyLoadCandidate[] },
	queries: string[],
): Promise<{ selected: AnyLoadCandidate[]; alreadyManaged: string[]; missing: string[] }> {
	const selected = new Map<string, AnyLoadCandidate>();
	const alreadyManaged: string[] = [];
	const missing: string[] = [];
	for (const query of queries) {
		const adoptableMatches: AnyLoadCandidate[] = [];
		for (const candidate of candidates.adoptable) {
			if (await candidateMatchesQuery(paths, candidate, query)) adoptableMatches.push(candidate);
		}
		if (adoptableMatches.length > 0) {
			for (const candidate of adoptableMatches) selected.set(candidateKey(candidate), candidate);
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
	directMetadataChanged?: number;
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
			const itemId = await uniqueManagedIdInConstruct(construct, item?.id ?? deriveId(source), source, source, paths);
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

function directBaseId(resource: DirectResourceSummary): string {
	return deriveId(`${resource.kind}-${resource.name}`);
}

function sameDirectResource(value: unknown, resource: DirectResourceSummary): boolean {
	return isObject(value) && value.kind === resource.kind && (value.path === resource.displayPath || value.path === resource.path);
}

function uniqueDirectManagedIdInConstruct(construct: JsonObject, resource: DirectResourceSummary): string {
	const items = isObject(construct.items) ? construct.items : {};
	for (const [id, value] of Object.entries(items)) {
		if (sameDirectResource(value, resource)) return id;
	}
	const baseId = directBaseId(resource);
	const existing = new Set(Object.keys(items));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
}

function projectRelativeBaseDir(paths: Awaited<ReturnType<typeof getPaths>>, resource: DirectResourceSummary): string | undefined {
	if (!resource.baseDir) return undefined;
	const normalizedProject = paths.cwd.replace(/\/+$/, "");
	if (resource.baseDir === normalizedProject) return ".";
	if (resource.baseDir.startsWith(`${normalizedProject}/`)) return resource.baseDir.slice(normalizedProject.length + 1);
	return resource.baseDir;
}

function upsertConstructDirectResource(construct: JsonObject, resource: DirectResourceSummary, paths: Awaited<ReturnType<typeof getPaths>>): JsonObject {
	const existingItems = isObject(construct.items) ? construct.items : {};
	const id = uniqueDirectManagedIdInConstruct(construct, resource);
	const existingItem = isObject(existingItems[id]) ? existingItems[id] : {};
	const now = new Date().toISOString();
	return {
		...construct,
		version: 1,
		managedBy: "the-construct",
		loadedAt: typeof construct.loadedAt === "string" ? construct.loadedAt : now,
		targetCwd: paths.realCwd,
		items: {
			...existingItems,
			[id]: {
				...existingItem,
				kind: resource.kind,
				path: resource.displayPath,
				...(resource.settingsPath ? { settingsPath: resource.settingsPath } : {}),
				...(resource.baseDir ? { baseDir: projectRelativeBaseDir(paths, resource) } : {}),
				scope: resource.scope,
				origin: resource.origin,
				source: resource.source,
				enabled: resource.enabled,
				loadedAt: typeof existingItem.loadedAt === "string" ? existingItem.loadedAt : now,
				updatedAt: now,
			},
		},
	};
}

async function loadDirectResourcesIntoConstruct(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	paths: Awaited<ReturnType<typeof getPaths>>,
	resources: DirectResourceSummary[],
): Promise<{ metadataChanged: number; warnings: string[] }> {
	if (resources.length === 0) return { metadataChanged: 0, warnings: [] };
	const warnings: string[] = [];
	let metadataChanged = 0;
	try {
		const constructRead = await readJson(paths.projectConstructPath);
		let construct = parseProjectConstruct(constructRead);
		for (const resource of resources) {
			construct = upsertConstructDirectResource(construct, resource, paths);
			metadataChanged += 1;
		}
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		warnings.push(`Could not update project Construct metadata for direct resources: ${error instanceof Error ? error.message : String(error)}`);
	}
	const remembered = await rememberKnownProject(ctx);
	if (remembered.warning) warnings.push(remembered.warning);
	return { metadataChanged, warnings };
}

export function formatLoadResult(result: ConstructLoadResult): string {
	const skipped = Math.max(0, result.selectedSources - result.added.length);
	return [
		"Construct load complete.",
		`Added to Construct: ${result.added.length}`,
		`Already known: ${Math.max(skipped, result.alreadyKnown)}`,
		`Errors: ${result.warnings.length}`,
		result.metadataChanged > 0 ? `Project items armed: ${result.metadataChanged}` : undefined,
		result.directMetadataChanged && result.directMetadataChanged > 0 ? `Direct project resources adopted: ${result.directMetadataChanged}` : undefined,
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
		showText(ctx, `Construct load failed.\nCannot load because ${describeJsonReadIssue(".pi/settings.json", settingsRead)}`);
		return;
	}
	if (settingsRead.state === "ok" && !isObject(settingsRead.data)) {
		showText(ctx, "Construct load failed.\nCannot load because .pi/settings.json is not a JSON object.");
		return;
	}

	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "invalid") {
		showText(ctx, `Construct load failed.\nCannot load because ${describeJsonReadIssue(".pi/construct.json", constructRead)}`);
		return;
	}
	if (constructRead.state === "ok" && !isObject(constructRead.data)) {
		showText(ctx, "Construct load failed.\nCannot load because .pi/construct.json is not a JSON object.");
		return;
	}

	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		showText(ctx, `Construct load failed.\nCannot load because ${describeJsonReadIssue("Construct library catalog", catalogRead)}`);
		return;
	}
	const catalogCheck = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && catalogCheck.warnings.length > 0) {
		showText(ctx, [`Construct load failed.`, `Cannot load because Construct library catalog has structural warnings. Fix ${paths.userCatalogPath} first.`, ...catalogCheck.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	let candidates: { adoptable: AnyLoadCandidate[]; alreadyManaged: AnyLoadCandidate[]; directWarnings: string[] };
	try {
		const packageCandidates = await projectLoadCandidates(paths);
		const directCandidates = await projectDirectLoadCandidates(ctx, paths);
		candidates = {
			adoptable: [...packageCandidates.adoptable, ...directCandidates.adoptable],
			alreadyManaged: [...packageCandidates.alreadyManaged, ...directCandidates.alreadyManaged],
			directWarnings: directCandidates.warnings,
		};
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
				"No project resources are waiting to be loaded.",
				candidates.alreadyManaged.length > 0 ? `Already Construct-managed here: ${candidates.alreadyManaged.length}` : "No Construct-managed project resources found.",
				...candidates.directWarnings.map((warning) => `! ${warning}`),
				"No files were changed.",
			].join("\n"),
		);
		return;
	}

	let selectedCandidates: AnyLoadCandidate[] = [];
	const selectionWarnings: string[] = [...candidates.directWarnings];
	if (loadArgs.queries.length > 0) {
		const direct = await findLoadCandidates(paths, candidates, loadArgs.queries);
		selectedCandidates = direct.selected;
		selectionWarnings.push(...direct.alreadyManaged.map((query) => `Already Construct-managed here: ${query}`));
		selectionWarnings.push(...direct.missing.map((query) => `Not an unloaded project resource: ${query}`));
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = candidates.adoptable.map((candidate) => ({
			id: candidateKey(candidate),
			label: candidate.id,
			value: candidateValue(candidate),
			description: candidateDescription(candidate),
			checked: false,
			section: candidate.kind === "package" ? "UNLOADED PACKAGES — available to load" : "UNLOADED DIRECT RESOURCES — adopt metadata only",
		}));
		const selected = await pickCheckboxes(ctx, "Construct load — add project resources", pickerItems);
		if (!selected) {
			showText(ctx, "Construct load cancelled. No files were changed.");
			return;
		}
		const adoptableByKey = new Map(candidates.adoptable.map((candidate) => [candidateKey(candidate), candidate]));
		selectedCandidates = selected.selectedIds.map((key) => adoptableByKey.get(key)).filter((candidate): candidate is AnyLoadCandidate => candidate !== undefined);
	} else {
		selectedCandidates = candidates.adoptable;
	}

	if (selectedCandidates.length === 0) {
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), "No files were changed."].join("\n"));
		return;
	}

	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct load");
	if (!ready) {
		showText(ctx, "Construct load cancelled. No files were changed.");
		return;
	}

	try {
		const freshPackageCandidates = await projectLoadCandidates(paths);
		const freshDirectCandidates = await projectDirectLoadCandidates(ctx, paths);
		const freshCandidates: { adoptable: AnyLoadCandidate[]; alreadyManaged: AnyLoadCandidate[]; directWarnings: string[] } = {
			adoptable: [...freshPackageCandidates.adoptable, ...freshDirectCandidates.adoptable],
			alreadyManaged: [...freshPackageCandidates.alreadyManaged, ...freshDirectCandidates.alreadyManaged],
			directWarnings: freshDirectCandidates.warnings,
		};
		selectionWarnings.push(...freshCandidates.directWarnings);
		const selectedBeforeWait = new Set(selectedCandidates.map(candidateKey));
		const freshSelected = freshCandidates.adoptable.filter((candidate) => selectedBeforeWait.has(candidateKey(candidate)));
		const freshSelectedKeys = new Set(freshSelected.map(candidateKey));
		selectionWarnings.push(...selectedCandidates.filter((candidate) => !freshSelectedKeys.has(candidateKey(candidate))).map((candidate) => `No longer an unloaded project resource after waiting: ${candidateValue(candidate)}`));
		selectedCandidates = freshSelected;
		candidates = freshCandidates;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\nCould not re-check project resources after waiting.\n${message}`);
		return;
	}

	if (selectedCandidates.length === 0) {
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), "No files were changed."].join("\n"));
		return;
	}

	const selectedPackageCandidates = selectedCandidates.filter((candidate): candidate is LoadCandidate => candidate.kind === "package");
	const selectedDirectCandidates = selectedCandidates.filter((candidate): candidate is DirectLoadCandidate => candidate.kind !== "package");
	const selectedSources = selectedPackageCandidates.map((candidate) => candidate.source);
	const selectedAfterWait = new Set(selectedSources);
	const enabledBySource = new Map(selectedPackageCandidates.filter((candidate) => selectedAfterWait.has(candidate.source)).map((candidate) => [candidate.source, !candidate.disabledByFilters]));
	let result: ConstructLoadResult;
	try {
		result = await loadSourcesIntoConstruct(ctx, paths, selectedSources, { enabledBySource });
		const directResult = await loadDirectResourcesIntoConstruct(ctx, paths, selectedDirectCandidates.map((candidate) => candidate.resource));
		result.directMetadataChanged = directResult.metadataChanged;
		result.warnings.push(...directResult.warnings, ...selectionWarnings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	await showSummary(ctx, formatLoadResult(result));
}

