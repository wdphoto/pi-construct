import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, DirectResourceSummary, DirectResourceKind, JsonObject } from "../types.js";
import { dirname } from "node:path";
import { accessSync, constants } from "node:fs";
import { deriveId, findCatalogItem, findCatalogItemForSource, loadCatalog, normalizeSourceForLibrary, parseCatalog, addSourcesToCatalog, updateExistingCatalogAgentSkills, type CatalogAgentSkillsOpinion } from "../catalog.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { collectProjectInventory, type ProjectInventory } from "../project-inventory.js";
import { matchingPiProjectOverride, parseProjectConstruct, uniqueManagedIdInConstruct, upsertConstructItem } from "../project-settings.js";
import { collectProjectPackageResources, packageResourceMatches, skillInspectionFor } from "../package-resources.js";
import { catalogAgentSkillsInventory, packageSkillRepositoryFor, skillRepositoriesOwnPath, type PackageSkillRepository } from "../skill-repositories.js";
import { rememberKnownProject } from "../projects.js";
import { secretLikeSources, generatedCacheSources } from "../saved-loadouts.js";
import { formatPackageSourceLabel, isExplicitPackageSource, isLocalPathSource, packageSourceMatchValues } from "../sources.js";
import { TrustRefusedError, targetTrustDecision, type TargetTrustContext } from "../target-trust.js";
import { pickCheckboxes, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

interface LoadCandidate {
	kind: "package";
	id: string;
	source: string;
	matchSources: string[];
	alreadyKnown?: boolean;
	disabledByFilters?: boolean;
	agentSkills?: CatalogAgentSkillsOpinion;
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

interface LoadQueryPartition {
	/** Explicit package sources, including machine-specific local paths, that may be adopted or remembered. */
	sources: string[];
	/** Non-explicit queries (ids, resource names) that must match project candidates. */
	queries: string[];
	/** Inputs refused before any write (secret-like or generated Pi cache paths). */
	refused: { value: string; reason: string }[];
}

/**
 * Preclassify `/construct load` arguments so explicit package sources can fall back to a
 * library-only add while ids/resource names keep existing project-adoption semantics. Refusals
 * mirror `/construct import`: secret-like URLs and generated Pi cache paths are never remembered.
 */
export function partitionLoadQueries(queries: string[]): LoadQueryPartition {
	const sources: string[] = [];
	const others: string[] = [];
	const refused: { value: string; reason: string }[] = [];
	for (const query of queries) {
		if (secretLikeSources([query]).length > 0) {
			refused.push({ value: query, reason: "looks like it contains credentials or secrets" });
			continue;
		}
		if (generatedCacheSources([query]).length > 0) {
			refused.push({ value: query, reason: "looks like a generated Pi package cache path" });
			continue;
		}
		if (isExplicitPackageSource(query)) sources.push(query);
		else others.push(query);
	}
	return { sources, queries: others, refused };
}

interface NormalizedExplicitSources {
	/** Normalized local absolute paths and unchanged git/npm sources, deduped in request order. */
	ordered: string[];
	/** Raw source -> normalized value, for callers that normalize a subset later. */
	bySource: Map<string, string>;
	/** Local paths that do not exist or are not readable. */
	missing: string[];
}

/**
 * Normalize explicit sources at command time. Relative local paths resolve against the current
 * project working directory, `~` expands, and existing paths become realpaths via the shared
 * `normalizeSourceForLibrary` behavior; git/npm sources are unchanged. Local paths are validated
 * for existence/readability (Pi's native local install refuses a missing path) without inspecting
 * package structure. This never resolves package resources, installs, copies, or scans them.
 */
export async function normalizeExplicitSources(sources: string[], cwd: string): Promise<NormalizedExplicitSources> {
	const ordered: string[] = [];
	const bySource = new Map<string, string>();
	const missing: string[] = [];
	const seen = new Set<string>();
	for (const source of sources) {
		const value = await normalizeSourceForLibrary(source, cwd);
		bySource.set(source, value);
		if (isLocalPathSource(source)) {
			try {
				accessSync(value, constants.R_OK);
			} catch {
				missing.push(value);
				continue;
			}
		}
		if (seen.has(value)) continue;
		seen.add(value);
		ordered.push(value);
	}
	return { ordered, bySource, missing };
}

function missingLocalSourceLines(missing: string[]): string[] {
	return [
		"These local package sources do not exist or are not readable:",
		...missing.map((path) => `! ${path}`),
		"Local package sources are machine-specific and must point at an existing file or directory.",
	];
}

interface LibraryOnlyAddResult {
	requested: number;
	added: CatalogItem[];
	alreadyKnown: number;
	warnings: string[];
}

/**
 * Add explicit sources to the user Construct library only. Never depends on project trust and never
 * installs or touches project files/known-project records; the catalog write is the only mutation.
 */
async function addLibraryOnlySources(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	sources: string[],
): Promise<LibraryOnlyAddResult> {
	const result = await addSourcesToCatalog(ctx, sources);
	return { requested: sources.length, added: result.added, alreadyKnown: result.alreadyKnown, warnings: result.warnings };
}

function libraryOnlyLines(result: LibraryOnlyAddResult): string[] {
	// `addSourcesToCatalog` returns warnings and adds nothing when the catalog is invalid or has
	// structural warnings; report that honestly instead of claiming a completed add.
	const refused = result.warnings.length > 0 && result.added.length === 0;
	const lines = refused
		? ["Construct library was not changed (library only)."]
		: [`Construct library updated (library only): added ${result.added.length}, already known ${result.alreadyKnown}, requested ${result.requested}.`];
	const shown = result.added.slice(0, 8);
	lines.push(...shown.map((item) => `+ ${formatPackageSourceLabel(item.source)} (${item.source})`));
	if (result.added.length > shown.length) lines.push(`…and ${result.added.length - shown.length} more added`);
	if (result.added.some((item) => isLocalPathSource(item.source))) {
		lines.push("! Local sources are machine-specific and break if the directory moves; prefer a git or npm source for portability.");
	}
	lines.push("The library-only sources did not install packages or change project files.");
	lines.push(...result.warnings.map((warning) => `! ${warning}`));
	return lines;
}

function constructManagedPackageStates(inventory: ProjectInventory): Map<string, boolean | undefined> {
	const sources = new Map<string, boolean | undefined>();
	for (const item of inventory.managedPackages) {
		for (const source of item.matchSources) sources.set(source, item.metadata.enabled);
	}
	return sources;
}

async function projectLoadCandidates(inventory: ProjectInventory): Promise<{ adoptable: LoadCandidate[]; alreadyManaged: LoadCandidate[] }> {
	const { paths } = inventory;
	const managedPackageStates = constructManagedPackageStates(inventory);
	const settingsDir = dirname(paths.projectSettingsPath);
	const catalogItemsBySource = new Map<string, string>();
	for (const item of inventory.catalog.data.items) {
		for (const match of await packageSourceMatchValues(item.source, settingsDir)) catalogItemsBySource.set(match, item.id);
	}

	const seen = new Set<string>();
	const adoptable: LoadCandidate[] = [];
	const alreadyManaged: LoadCandidate[] = [];
	for (const pkg of inventory.packageDeclarations) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		if (pkg.projectOverride) continue;
		const source = await normalizeSourceForLibrary(pkg.source, settingsDir);
		const matches = await packageSourceMatchValues(pkg.source, settingsDir);
		const seenKey = matches.at(-1) ?? source;
		if (seen.has(seenKey)) continue;
		seen.add(seenKey);
		const catalogId = matches.map((match) => catalogItemsBySource.get(match)).find((id): id is string => id !== undefined);
		const candidate: LoadCandidate = { kind: "package", id: catalogId ?? deriveId(source), source, matchSources: matches, alreadyKnown: catalogId !== undefined, disabledByFilters: pkg.disabledByFilters };
		const managedMatch = matches.map((match) => managedPackageStates.get(match)).find((state) => state !== undefined);
		const managedKnown = managedMatch !== undefined || matches.some((match) => managedPackageStates.has(match));
		if (managedMatch === false && !pkg.disabledByFilters) adoptable.push(candidate);
		else if (managedKnown) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function projectDirectLoadCandidates(inventory: ProjectInventory, skillRepositories: readonly PackageSkillRepository[]): { adoptable: DirectLoadCandidate[]; alreadyManaged: DirectLoadCandidate[]; warnings: string[] } {
	const adoptable: DirectLoadCandidate[] = [];
	const alreadyManaged: DirectLoadCandidate[] = [];
	for (const resource of inventory.directResources.resources) {
		// Skills owned by a carrier package are managed through its child rows, not as
		// independent direct resources, so never offer them for direct adoption.
		if (resource.kind === "skill" && skillRepositoriesOwnPath(skillRepositories, resource.path)) continue;
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
		warnings: inventory.directResources.warnings,
	};
}

async function collectLoadCandidates(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">): Promise<{ paths: Awaited<ReturnType<typeof getPaths>>; adoptable: AnyLoadCandidate[]; alreadyManaged: AnyLoadCandidate[]; directWarnings: string[] }> {
	const inventory = await collectProjectInventory(ctx);
	const packageCandidates = await projectLoadCandidates(inventory);
	// Read-only: reuse the inventory's direct resources and only ask Pi for the carrier
	// repositories, so linked carrier skills are not offered as independent direct resources.
	const packageResources = await collectProjectPackageResources(ctx, inventory);
	const directCandidates = projectDirectLoadCandidates(inventory, packageResources.skillRepositories);
	const warnings: string[] = [];
	const seenWarnings = new Set<string>();
	const pushWarnings = (values: readonly string[]): void => {
		for (const value of values) {
			if (seenWarnings.has(value)) continue;
			seenWarnings.add(value);
			warnings.push(value);
		}
	};
	pushWarnings(directCandidates.warnings);
	pushWarnings(packageResources.warnings);
	for (const candidate of [...packageCandidates.adoptable, ...packageCandidates.alreadyManaged]) {
		const repository = packageSkillRepositoryFor(packageResources.skillRepositories, { source: candidate.source, matchSources: candidate.matchSources });
		if (repository) {
			const inventorySnapshot = catalogAgentSkillsInventory(repository);
			if (inventorySnapshot) {
				candidate.agentSkills = inventorySnapshot;
			} else {
				candidate.agentSkills = null;
				pushWarnings([`${candidate.id}: Agent Skill inventory could not be recorded (too many, duplicate, or invalid skill roots); any stale advisory snapshot was cleared.`]);
			}
			continue;
		}
		// No adapter. Clear only when authoritative: Pi matched native resources, or a real checkout
		// was inspected and produced no adapter. Otherwise leave no opinion so a valid snapshot survives.
		const hasNative = packageResources.resources.some((resource) => packageResourceMatches(resource, { matchSources: candidate.matchSources }));
		const inspection = skillInspectionFor(packageResources, { source: candidate.source, matchSources: candidate.matchSources });
		if (hasNative || inspection?.inspected) {
			candidate.agentSkills = null;
		} else if (inspection && !inspection.inspected) {
			pushWarnings([`${candidate.id}: Agent Skill checkout could not be inspected; any existing advisory snapshot was preserved.`]);
		}
	}
	return {
		paths: inventory.paths,
		adoptable: [...packageCandidates.adoptable, ...directCandidates.adoptable],
		alreadyManaged: [...packageCandidates.alreadyManaged, ...directCandidates.alreadyManaged],
		directWarnings: warnings,
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
	const queryMatches = new Set([...(await packageSourceMatchValues(query, settingsDir)), ...(await packageSourceMatchValues(query, paths.cwd))]);
	const candidateMatches = await packageSourceMatchValues(candidate.source, settingsDir);
	return candidateMatches.some((match) => queryMatches.has(match));
}

function candidateKey(candidate: AnyLoadCandidate): string {
	return candidate.kind === "package" ? `package:${candidate.source}` : `${candidate.kind}:${candidate.path}`;
}

function candidateValue(candidate: AnyLoadCandidate): string {
	return candidate.kind === "package" ? candidate.source : candidate.displayPath;
}

function candidateDescription(candidate: AnyLoadCandidate): string | undefined {
	if (candidate.kind === "package") {
		return candidate.alreadyKnown
			? "Already in the Construct library; load only arms project metadata."
			: "Already declared in this project; load adopts it into Construct metadata and will not install or enable it.";
	}
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

/**
 * Already Construct-managed declarations are not re-selected by `/construct load`, so their
 * advisory Agent Skill snapshots would otherwise never be recorded. Apply the same authoritative
 * set/clear/no-opinion decisions computed during candidate collection to already-present library
 * entries only (`updateExistingCatalogAgentSkills` never creates a catalog item).
 */
async function refreshManagedAdvisorySnapshots(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	alreadyManaged: readonly AnyLoadCandidate[],
	prewrite?: () => Promise<void>,
): Promise<{ updated: number; warnings: string[]; refused?: "untrusted" | "unknown" }> {
	const opinions = new Map<string, CatalogAgentSkillsOpinion>();
	for (const candidate of alreadyManaged) {
		if (candidate.kind !== "package" || candidate.agentSkills === undefined) continue;
		opinions.set(candidate.source, candidate.agentSkills);
	}
	if (opinions.size === 0) return { updated: 0, warnings: [] };
	try {
		const result = await updateExistingCatalogAgentSkills(ctx, opinions, prewrite);
		return { updated: result.updated, warnings: result.warnings };
	} catch (error) {
		if (error instanceof TrustRefusedError) return { updated: 0, warnings: [error.message], refused: error.reason };
		return { updated: 0, warnings: [`Could not refresh advisory Agent Skill inventory: ${error instanceof Error ? error.message : String(error)}`] };
	}
}

function advisoryRefreshNote(updated: number): string {
	return `Advisory Agent Skill inventory refreshed for ${updated} library entr${updated === 1 ? "y" : "ies"}.`;
}

/** Advisory snapshot lines for a report, noting a refreshed count only when something changed. */
function advisoryResultLines(advisory: { updated: number; warnings: string[] }): string[] {
	const lines = advisory.warnings.map((warning) => `! ${warning}`);
	if (advisory.updated > 0) lines.push(advisoryRefreshNote(advisory.updated));
	return lines;
}

/**
 * Fresh current-project trust check for interactive writes that run after a picker or idle wait.
 * AGENTS requires the canonical current project to use `ctx.isProjectTrusted()` (session decisions
 * included) before every write; this reuses Pi's target trust decision so a session grant/denial is
 * honored and an unreadable lookup refuses instead of silently writing.
 */
function currentProjectPrewrite(ctx: ExtensionCommandContext, targetDir: string): () => Promise<void> {
	return async () => {
		const trust = await targetTrustDecision(ctx, targetDir);
		if (trust !== "trusted") throw new TrustRefusedError(targetDir, trust);
	};
}

export interface ConstructLoadResult {
	added: CatalogItem[];
	alreadyKnown: number;
	warnings: string[];
	metadataChanged: number;
	selectedSources: number;
	directMetadataChanged?: number;
	refused?: "untrusted" | "unknown";
}

export async function loadSourcesIntoConstruct(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	paths: Awaited<ReturnType<typeof getPaths>>,
	selectedSources: string[],
	options: { enabledBySource?: Map<string, boolean>; prewrite?: () => Promise<void>; agentSkillsBySource?: ReadonlyMap<string, CatalogAgentSkillsOpinion> } = {},
): Promise<ConstructLoadResult> {
	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	const warnings: string[] = [];
	let refused: "untrusted" | "unknown" | undefined;
	let result: { added: CatalogItem[]; alreadyKnown: number; warnings: string[] };
	try {
		result = await addSourcesToCatalog(ctx, selectedSources, options.prewrite, options.agentSkillsBySource);
	} catch (error) {
		if (error instanceof TrustRefusedError) {
			return { added: [], alreadyKnown: 0, warnings: [error.message], metadataChanged: 0, selectedSources: selectedSources.length, refused: error.reason };
		}
		throw error;
	}
	added.push(...result.added);
	alreadyKnown += result.alreadyKnown;
	warnings.push(...result.warnings);

	const addedBySource = new Map(added.map((item) => [item.source, item]));
	let metadataChanged = 0;
	{
		const { catalog } = await loadCatalog(ctx);
		try {
			const constructRead = await readJson(paths.projectConstructPath);
			let construct = parseProjectConstruct(constructRead);
			let nextMetadataChanged = 0;
			for (const source of selectedSources) {
				const item = addedBySource.get(source) ?? (await findCatalogItemForSource(catalog.items, source, dirname(paths.projectSettingsPath))) ?? findCatalogItem(catalog.items, source);
				const itemId = await uniqueManagedIdInConstruct(construct, item?.id ?? deriveId(source), source, source, paths);
				const enabled = options.enabledBySource?.get(source);
				construct = upsertConstructItem(construct, itemId, source, source, paths, { enabled });
				nextMetadataChanged += 1;
			}
			await options.prewrite?.();
			await writeJson(paths.projectConstructPath, construct);
			metadataChanged = nextMetadataChanged;
		} catch (error) {
			if (error instanceof TrustRefusedError) refused = error.reason;
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`Could not update project Construct metadata: ${message}`);
		}
	}

	// Once a trust refusal is latched, later writes (known-project index) must not resume.
	if (!refused) {
		try {
			const remembered = await rememberKnownProject(ctx, options.prewrite);
			if (remembered.warning) warnings.push(remembered.warning);
		} catch (error) {
			if (error instanceof TrustRefusedError) refused = error.reason;
			else throw error;
		}
	}

	return { added, alreadyKnown, warnings, metadataChanged, selectedSources: selectedSources.length, ...(refused ? { refused } : {}) };
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

export async function loadDirectResourcesIntoConstruct(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	paths: Awaited<ReturnType<typeof getPaths>>,
	resources: DirectResourceSummary[],
	prewrite?: () => Promise<void>,
): Promise<{ metadataChanged: number; warnings: string[]; refused?: "untrusted" | "unknown" }> {
	if (resources.length === 0) return { metadataChanged: 0, warnings: [] };
	const warnings: string[] = [];
	let metadataChanged = 0;
	let refused: "untrusted" | "unknown" | undefined;
	try {
		const constructRead = await readJson(paths.projectConstructPath);
		let construct = parseProjectConstruct(constructRead);
		let nextMetadataChanged = 0;
		for (const resource of resources) {
			construct = upsertConstructDirectResource(construct, resource, paths);
			nextMetadataChanged += 1;
		}
		// Count only after the write actually succeeds so a refused or failed write
		// never reports unwritten resources as adopted.
		await prewrite?.();
		await writeJson(paths.projectConstructPath, construct);
		metadataChanged = nextMetadataChanged;
	} catch (error) {
		if (error instanceof TrustRefusedError) refused = error.reason;
		warnings.push(`Could not update project Construct metadata for direct resources: ${error instanceof Error ? error.message : String(error)}`);
	}
	// Once a trust refusal is latched, the known-project index write must not resume.
	if (!refused) {
		try {
			const remembered = await rememberKnownProject(ctx, prewrite);
			if (remembered.warning) warnings.push(remembered.warning);
		} catch (error) {
			if (error instanceof TrustRefusedError) refused = error.reason;
			else throw error;
		}
	}
	return { metadataChanged, warnings, ...(refused ? { refused } : {}) };
}

export interface ConstructLoadTrust {
	// Current-project callers may pass the live context; the target's own saved trust is used
	// for any other directory. Callers that pass no context still get native target checking.
	ctx?: TargetTrustContext;
	signal?: AbortSignal;
}

export async function loadProjectResourcesIntoConstruct(
	projectDir: string,
	queries: string[],
	trust: ConstructLoadTrust,
): Promise<ConstructLoadResult> {
	const paths = await getPaths({ cwd: projectDir });
	const initialTrust = await targetTrustDecision(trust.ctx, projectDir);
	if (initialTrust !== "trusted") {
		return {
			added: [],
			alreadyKnown: 0,
			warnings: [
				initialTrust === "unknown"
					? `Skipped because Pi trust state for ${projectDir} could not be read.`
					: `Skipped because ${projectDir} is not trusted by Pi.`,
			],
			metadataChanged: 0,
			selectedSources: 0,
			directMetadataChanged: 0,
			refused: initialTrust,
		};
	}
	// Forward the verified native decision (never an unconditional trust assumption) into the
	// resolver predicate used for inspection, and recheck freshness before every write.
	const projectTrusted = initialTrust === "trusted";
	const projectCtx = { cwd: projectDir, isProjectTrusted: () => projectTrusted };
	const refusal: { reason?: "untrusted" | "unknown" } = {};
	const prewrite = async () => {
		if (trust.signal?.aborted) throw new Error("Construct load cancelled before write.");
		const decision = await targetTrustDecision(trust.ctx, projectDir);
		// Re-check cancellation after the native trust await, before any actual write.
		if (trust.signal?.aborted) throw new Error("Construct load cancelled before write.");
		if (decision !== "trusted") {
			refusal.reason = decision;
			throw new TrustRefusedError(projectDir, decision);
		}
	};

	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "invalid") throw new Error(`Cannot load because ${describeJsonReadIssue(".pi/settings.json", settingsRead)}`);
	if (settingsRead.state === "ok" && !isObject(settingsRead.data)) throw new Error("Cannot load because .pi/settings.json is not a JSON object.");

	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "invalid") throw new Error(`Cannot load because ${describeJsonReadIssue(".pi/construct.json", constructRead)}`);
	if (constructRead.state === "ok" && !isObject(constructRead.data)) throw new Error("Cannot load because .pi/construct.json is not a JSON object.");

	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") throw new Error(`Cannot load because ${describeJsonReadIssue("Construct library catalog", catalogRead)}`);
	const catalogCheck = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && catalogCheck.warnings.length > 0) {
		throw new Error([`Cannot load because Construct library catalog has structural warnings. Fix ${paths.userCatalogPath} first.`, ...catalogCheck.warnings].join("\n"));
	}

	const candidates = await collectLoadCandidates(projectCtx);
	const found = await findLoadCandidates(paths, candidates, queries);
	const selectionWarnings = [
		...candidates.directWarnings,
		...found.alreadyManaged.map((query) => `Already Construct-managed here: ${query}`),
		...found.missing.map((query) => `Not an unloaded project resource: ${query}`),
	];
	const selectedPackageCandidates = found.selected.filter((candidate): candidate is LoadCandidate => candidate.kind === "package");
	const selectedDirectCandidates = found.selected.filter((candidate): candidate is DirectLoadCandidate => candidate.kind !== "package");
	const selectedSources = selectedPackageCandidates.map((candidate) => candidate.source);
	const enabledBySource = new Map(selectedPackageCandidates.map((candidate) => [candidate.source, !candidate.disabledByFilters]));
	const agentSkillsBySource = new Map(selectedPackageCandidates.flatMap((candidate) => candidate.agentSkills !== undefined ? [[candidate.source, candidate.agentSkills] as const] : []));
	const result: ConstructLoadResult =
		selectedSources.length > 0
			? await loadSourcesIntoConstruct({ cwd: projectDir }, paths, selectedSources, { enabledBySource, prewrite, agentSkillsBySource })
			: { added: [], alreadyKnown: 0, warnings: [], metadataChanged: 0, selectedSources: 0 };
	result.warnings.push(...selectionWarnings);
	if (result.refused) {
		// Latched refusal: later direct adoption and known-project writes must not resume.
		result.directMetadataChanged = 0;
		return result;
	}
	// Already Construct-managed carriers are not re-selected above, so refresh their advisory
	// snapshots here. This only touches existing library entries and never creates one.
	const advisory = await refreshManagedAdvisorySnapshots({ cwd: projectDir }, candidates.alreadyManaged, prewrite);
	result.warnings.push(...advisory.warnings);
	if (advisory.refused) {
		result.refused = advisory.refused;
		result.directMetadataChanged = 0;
		return result;
	}
	const directResult = await loadDirectResourcesIntoConstruct(
		{ cwd: projectDir },
		paths,
		selectedDirectCandidates.map((candidate) => candidate.resource),
		prewrite,
	);
	result.directMetadataChanged = directResult.metadataChanged;
	result.warnings.push(...directResult.warnings);
	result.refused = directResult.refused ?? refusal.reason;
	return result;
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
	// Interactive writes happen after the picker/idle wait; recheck current-project trust at write
	// time so a lost session grant or denial never lets a stale catalog/metadata write through.
	const prewrite = currentProjectPrewrite(ctx, paths.cwd);
	const partition = partitionLoadQueries(loadArgs.queries);
	if (partition.refused.length > 0) {
		showText(ctx, ["Construct load refused.", ...partition.refused.map((entry) => `! Not loaded: ${entry.reason}.`)].join("\n"));
		return;
	}
	// Normalize local paths at command time (relative to ctx.cwd) and refuse missing/unreadable
	// local sources before any project matching or write. Pi owns any later package resolution or
	// installation; Construct only records the source.
	const normalizedExplicit = await normalizeExplicitSources(partition.sources, ctx.cwd);
	if (normalizedExplicit.missing.length > 0) {
		showText(ctx, ["Construct load refused.", ...missingLocalSourceLines(normalizedExplicit.missing)].join("\n"));
		return;
	}
	if (!ctx.isProjectTrusted()) {
		// Library-only adds do not read or write project files, so they do not need project trust.
		// Any project-declaration query still needs trust and is refused below.
		if (loadArgs.queries.length > 0 && partition.queries.length === 0) {
			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct load");
			if (!ready) {
				showText(ctx, "Construct load cancelled. No files were changed.");
				return;
			}
			try {
				const result = await addLibraryOnlySources(ctx, normalizedExplicit.ordered);
				showText(ctx, libraryOnlyLines(result).join("\n"));
			} catch (error) {
				showText(ctx, `Construct load failed.\n${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}
		showText(ctx, ["Construct load failed.", "Project is not trusted by Pi, so Construct will not adopt project resources here.", "Explicit package sources can still be added with /load <source> or /construct load <source>.", "Trust this project in Pi, then run /construct load again to adopt project declarations."].join("\n"));
		return;
	}

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
		candidates = await collectLoadCandidates(ctx);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	if (candidates.adoptable.length === 0 && loadArgs.queries.length === 0) {
		const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
		showText(
			ctx,
			[
				"Construct load complete.",
				`Project: ${paths.cwd}`,
				"No project resources are waiting to be loaded.",
				candidates.alreadyManaged.length > 0 ? `Already Construct-managed here: ${candidates.alreadyManaged.length}` : "No Construct-managed project resources found.",
				...candidates.directWarnings.map((warning) => `! ${warning}`),
				...advisory.warnings.map((warning) => `! ${warning}`),
				advisory.updated > 0 ? advisoryRefreshNote(advisory.updated) : "No files were changed.",
			].join("\n"),
		);
		return;
	}

	let selectedCandidates: AnyLoadCandidate[] = [];
	let libraryOnlySources: string[] = [];
	let normalizedLibraryOnlySources: string[] = [];
	const selectionWarnings: string[] = [...candidates.directWarnings];
	if (loadArgs.queries.length > 0) {
		const loadQueries: string[] = [];
		for (const query of loadArgs.queries) {
			const projectOverride = await matchingPiProjectOverride(paths, query);
			if (projectOverride) selectionWarnings.push(`${projectOverride} is a Pi project override (autoload: false); manage it with pi config -l.`);
			else loadQueries.push(query);
		}
		const direct = await findLoadCandidates(paths, candidates, loadQueries);
		selectedCandidates = direct.selected;
		selectionWarnings.push(...direct.alreadyManaged.map((query) => `Already Construct-managed here: ${query}`));
		libraryOnlySources = direct.missing.filter((query) => isExplicitPackageSource(query));
		normalizedLibraryOnlySources = libraryOnlySources.map((source) => normalizedExplicit.bySource.get(source) ?? source);
		selectionWarnings.push(...direct.missing.filter((query) => !isExplicitPackageSource(query)).map((query) => `Not an unloaded project resource: ${query}`));
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = candidates.adoptable.map((candidate) => ({
			id: candidateKey(candidate),
			label: candidate.id,
			value: candidateValue(candidate),
			description: candidateDescription(candidate),
			checked: false,
			section: candidate.kind === "package" ? "UNLOADED PACKAGES — adopt already-declared packages" : "UNLOADED DIRECT RESOURCES — adopt metadata only",
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
		// Explicit sources that match no project candidate become library-only additions.
		if (libraryOnlySources.length > 0) {
			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct load");
			if (!ready) {
				showText(ctx, "Construct load cancelled. No files were changed.");
				return;
			}
			// Already Construct-managed candidates still get the same advisory snapshot refresh the
			// ordinary "no resources selected" path performs; the library-only add must not bypass it.
			const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
			try {
				const added = await addLibraryOnlySources(ctx, normalizedLibraryOnlySources);
				showText(ctx, [...selectionWarnings.map((warning) => `! ${warning}`), ...advisoryResultLines(advisory), ...libraryOnlyLines(added)].join("\n"));
			} catch (error) {
				showText(ctx, [...advisoryResultLines(advisory), `Construct load failed.\n${error instanceof Error ? error.message : String(error)}`].join("\n"));
			}
			return;
		}
		const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), ...advisory.warnings.map((warning) => `! ${warning}`), advisory.updated > 0 ? advisoryRefreshNote(advisory.updated) : "No files were changed."].join("\n"));
		return;
	}

	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct load");
	if (!ready) {
		showText(ctx, "Construct load cancelled. No files were changed.");
		return;
	}

	try {
		const freshCandidates = await collectLoadCandidates(ctx);
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
		if (libraryOnlySources.length > 0) {
			// Already Construct-managed candidates still get the advisory snapshot refresh the ordinary
			// "no resources selected" path performs; the library-only add must not bypass it.
			const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
			try {
				const added = await addLibraryOnlySources(ctx, normalizedLibraryOnlySources);
				showText(ctx, [...selectionWarnings.map((warning) => `! ${warning}`), ...advisoryResultLines(advisory), ...libraryOnlyLines(added)].join("\n"));
			} catch (error) {
				showText(ctx, [...advisoryResultLines(advisory), `Construct load failed.\n${error instanceof Error ? error.message : String(error)}`].join("\n"));
			}
			return;
		}
		const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
		showText(ctx, ["No resources selected for Construct load.", ...selectionWarnings.map((warning) => `! ${warning}`), ...advisory.warnings.map((warning) => `! ${warning}`), advisory.updated > 0 ? advisoryRefreshNote(advisory.updated) : "No files were changed."].join("\n"));
		return;
	}

	const selectedPackageCandidates = selectedCandidates.filter((candidate): candidate is LoadCandidate => candidate.kind === "package");
	const selectedDirectCandidates = selectedCandidates.filter((candidate): candidate is DirectLoadCandidate => candidate.kind !== "package");
	const selectedSources = selectedPackageCandidates.map((candidate) => candidate.source);
	const selectedAfterWait = new Set(selectedSources);
	const enabledBySource = new Map(selectedPackageCandidates.filter((candidate) => selectedAfterWait.has(candidate.source)).map((candidate) => [candidate.source, !candidate.disabledByFilters]));
	const agentSkillsBySource = new Map(selectedPackageCandidates.flatMap((candidate) => candidate.agentSkills !== undefined ? [[candidate.source, candidate.agentSkills] as const] : []));
	let result: ConstructLoadResult;
	try {
		result = await loadSourcesIntoConstruct(ctx, paths, selectedSources, { enabledBySource, agentSkillsBySource, prewrite });
		result.warnings.push(...selectionWarnings);
		// A latched trust refusal from the package/library write must stop later current-project
		// advisory/direct writes. The independent global library-only add below still runs because it
		// never reads or writes project state.
		if (result.refused) {
			result.directMetadataChanged = 0;
		} else {
			const advisory = await refreshManagedAdvisorySnapshots(ctx, candidates.alreadyManaged, prewrite);
			result.warnings.push(...advisory.warnings);
			// An advisory refusal must likewise stop direct adoption.
			if (advisory.refused) {
				result.refused = advisory.refused;
				result.directMetadataChanged = 0;
			} else {
				const directResult = await loadDirectResourcesIntoConstruct(ctx, paths, selectedDirectCandidates.map((candidate) => candidate.resource), prewrite);
				result.directMetadataChanged = directResult.metadataChanged;
				result.warnings.push(...directResult.warnings);
				result.refused = directResult.refused ?? result.refused;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct load failed.\n${message}`);
		return;
	}

	let extraLines: string[] = [];
	if (libraryOnlySources.length > 0) {
		try {
			const added = await addLibraryOnlySources(ctx, normalizedLibraryOnlySources);
			extraLines = ["Construct library (explicit sources):", ...libraryOnlyLines(added)];
		} catch (error) {
			extraLines = [`! Construct library add failed: ${error instanceof Error ? error.message : String(error)}`];
		}
	}
	await showSummary(ctx, [formatLoadResult(result), ...(extraLines.length > 0 ? ["", ...extraLines] : [])].join("\n"));
}

/**
 * Thin top-level `/load <source ...>` command: always add explicit package sources to the user
 * Construct library without installing them, reading/writing project configuration, or needing
 * project trust. It refuses non-source inputs and secret-like URLs or generated Pi cache paths.
 */
export async function handleDirectLoad(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const inputs = parseLoadArgs(args).queries;
	if (inputs.length === 0) {
		showText(ctx, ["Construct /load — add explicit package sources to the library", "Usage: /load <package-source ...>", "Accepts npm: specs (npm:name, npm:@scope/name, npm:name@version), Git source forms (git:, http://, https://, ssh://, git://, git@host:path), and local paths (./relative, ../relative, ~/path, absolute).", "Paths containing spaces are not supported, and local paths are machine-specific and must exist and be readable when added. Construct only records them; it does not install, copy, scan, or inspect them, and does not change project files."].join("\n"));
		return;
	}
	const partition = partitionLoadQueries(inputs);
	const problems = [
		...partition.refused.map((entry) => `! Refused input: ${entry.reason}.`),
		...partition.queries.map((value) => `! Not an explicit package source: ${value}. Use an npm: spec, a Git source form, or a local path (./, ../, ~/, or absolute).`),
	];
	if (problems.length > 0) {
		showText(ctx, ["Construct /load refused.", ...problems].join("\n"));
		return;
	}
	const normalized = await normalizeExplicitSources(partition.sources, ctx.cwd);
	if (normalized.missing.length > 0) {
		showText(ctx, ["Construct /load refused.", ...missingLocalSourceLines(normalized.missing)].join("\n"));
		return;
	}
	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct /load");
	if (!ready) {
		showText(ctx, "Construct /load cancelled. No files were changed.");
		return;
	}
	try {
		const result = await addLibraryOnlySources(ctx, normalized.ordered);
		showText(ctx, libraryOnlyLines(result).join("\n"));
	} catch (error) {
		showText(ctx, `Construct /load failed.\n${error instanceof Error ? error.message : String(error)}`);
	}
}
