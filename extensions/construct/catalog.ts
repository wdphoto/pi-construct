import { dirname } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CatalogAgentSkill, CatalogAgentSkillsInventory, CatalogData, CatalogItem, CatalogProfile, ConstructPaths, JsonReadResult, LoadResult } from "./types.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "./json.js";
import { getPaths } from "./paths.js";
import { getPackages } from "./project-settings.js";
export { isLocalPathSource, normalizeSourceForLibrary } from "./sources.js";
import { normalizeSourceForLibrary, packageSourceMatchValues } from "./sources.js";

export const MAX_CATALOG_AGENT_SKILLS = 64;
export const MAX_AGENT_SKILL_NAME_LENGTH = 64;
export const MAX_AGENT_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_AGENT_SKILL_ROOT_LENGTH = 512;

/**
 * Canonicalize a package-relative Agent Skill root. Only `.` and bounded POSIX relative paths
 * are accepted; leading `/` or `\\`, Windows drive absolute forms, backslashes/non-POSIX
 * separators, empty/`.`/`..` segments, and over-length roots are rejected. The input is trimmed
 * first so whitespace-prefixed absolute forms cannot slip through.
 */
function canonicalAgentSkillRoot(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const root = value.trim();
	if (!root || root.length > MAX_AGENT_SKILL_ROOT_LENGTH) return undefined;
	if (root.startsWith("/") || root.startsWith("\\")) return undefined;
	if (/^[A-Za-z]:($|[\\/])/.test(root)) return undefined;
	if (root.includes("\\")) return undefined;
	if (root === ".") return ".";
	const segments = root.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
	return root;
}

/** Canonicalize one advisory entry; unknown fields are dropped and limits enforced on trimmed values. */
export function canonicalizeAgentSkillEntry(value: unknown): CatalogAgentSkill | undefined {
	if (!isObject(value)) return undefined;
	const name = typeof value.name === "string" ? value.name.trim() : "";
	const description = typeof value.description === "string" ? value.description.trim() : "";
	const root = canonicalAgentSkillRoot(value.root);
	if (!name || name.length > MAX_AGENT_SKILL_NAME_LENGTH) return undefined;
	if (!description || description.length > MAX_AGENT_SKILL_DESCRIPTION_LENGTH) return undefined;
	if (!root) return undefined;
	return { name, description, root };
}

/**
 * Bounded canonical conversion shared by the catalog parser and every writer. Returns
 * `undefined` when the input cannot form a parser-valid snapshot: an invalid entry, a duplicate
 * canonical root, an empty set, or more than the maximum entry count. Writers must therefore
 * never emit an inventory that would later block catalog mutation on parse.
 */
export function canonicalCatalogAgentSkillsInventory(entries: readonly unknown[]): CatalogAgentSkillsInventory | undefined {
	if (entries.length === 0 || entries.length > MAX_CATALOG_AGENT_SKILLS) return undefined;
	const skills: CatalogAgentSkill[] = [];
	const seenRoots = new Set<string>();
	for (const entry of entries) {
		const skill = canonicalizeAgentSkillEntry(entry);
		if (!skill) return undefined;
		if (seenRoots.has(skill.root)) return undefined;
		seenRoots.add(skill.root);
		skills.push(skill);
	}
	return { skills };
}

/**
 * Authoritative inspection opinion for a catalog item's advisory Agent Skills inventory:
 * a bounded inventory to store, or `null` to clear stale data. Omitting a source (no map entry)
 * means "not inspected / no opinion" and preserves whatever is currently stored.
 */
export type CatalogAgentSkillsOpinion = CatalogAgentSkillsInventory | null;

function applyAgentSkillsOpinion(item: CatalogItem, opinion: CatalogAgentSkillsOpinion | undefined, hasOpinion: boolean): { item: CatalogItem; changed: boolean } {
	if (!hasOpinion) return { item, changed: false };
	if (opinion === null || opinion === undefined) {
		if (item.agentSkills === undefined) return { item, changed: false };
		const cleared = { ...item };
		delete cleared.agentSkills;
		return { item: cleared, changed: true };
	}
	if (JSON.stringify(item.agentSkills) === JSON.stringify(opinion)) return { item, changed: false };
	return { item: { ...item, agentSkills: opinion }, changed: true };
}

/**
 * Parse a bounded, canonical advisory Agent Skills inventory. Only `name`, `description`, and
 * `root` from valid entries are kept; unknown per-skill or inventory fields are dropped so a
 * hand-edited catalog cannot smuggle extra state (for example absolute paths) into previews.
 * Duplicate canonical roots reject the whole snapshot so previews never render ambiguous rows.
 */
function parseAgentSkillsInventory(value: unknown, label: string, warnings: string[]): CatalogAgentSkillsInventory | undefined {
	if (value === undefined) return undefined;
	if (!isObject(value) || !Array.isArray(value.skills)) {
		warnings.push(`${label} agentSkills is not an object with a skills array; ignored.`);
		return undefined;
	}
	if (value.skills.length > MAX_CATALOG_AGENT_SKILLS) {
		warnings.push(`${label} agentSkills has ${value.skills.length} entries (max ${MAX_CATALOG_AGENT_SKILLS}); ignored.`);
		return undefined;
	}
	const skills: CatalogAgentSkill[] = [];
	const seenRoots = new Set<string>();
	for (const [index, entry] of value.skills.entries()) {
		const skill = canonicalizeAgentSkillEntry(entry);
		if (!skill) {
			warnings.push(`${label} agentSkills entry ${index} is invalid; ignored.`);
			continue;
		}
		if (seenRoots.has(skill.root)) {
			warnings.push(`${label} agentSkills entry ${index} repeats root ${skill.root}; ignored.`);
			return undefined;
		}
		seenRoots.add(skill.root);
		skills.push(skill);
	}
	if (skills.length === 0) {
		warnings.push(`${label} agentSkills has no valid skills; ignored.`);
		return undefined;
	}
	return { skills };
}

export function parseCatalog(catalog: JsonReadResult): { data: CatalogData; warnings: string[] } {
	const warnings: string[] = [];
	if (catalog.state === "missing") return { data: { version: 1, items: [], profiles: [] }, warnings };
	if (catalog.state === "invalid") {
		warnings.push(describeJsonReadIssue("Catalog", catalog));
		return { data: { version: 1, items: [], profiles: [] }, warnings };
	}
	if (!isObject(catalog.data)) {
		warnings.push("Catalog JSON is not an object.");
		return { data: { version: 1, items: [], profiles: [] }, warnings };
	}
	if (catalog.data.version !== 1) warnings.push("Catalog version is missing or not 1; preserving only valid MVP package items.");
	if (!Array.isArray(catalog.data.items)) {
		warnings.push("Catalog items is missing or not an array.");
		return { data: { version: 1, items: [], profiles: [] }, warnings };
	}

	const items: CatalogItem[] = [];
	for (const [index, item] of catalog.data.items.entries()) {
		if (!isObject(item)) {
			warnings.push(`Catalog item ${index} is not an object; ignored.`);
			continue;
		}
		if (item.kind !== "package") {
			warnings.push(`Catalog item ${index} is not kind=package; ignored for MVP.`);
			continue;
		}
		if (typeof item.id !== "string" || !item.id.trim()) {
			warnings.push(`Catalog item ${index} has no id; ignored.`);
			continue;
		}
		if (typeof item.source !== "string" || !item.source.trim()) {
			warnings.push(`Catalog item ${item.id} has no source; ignored.`);
			continue;
		}
		items.push({
			...item,
			id: item.id.trim(),
			name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined,
			kind: "package",
			source: item.source.trim(),
			description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined,
			agentSkills: parseAgentSkillsInventory(item.agentSkills, `Catalog item ${item.id}`, warnings),
		});
	}

	const profiles: CatalogProfile[] = [];
	const rawProfiles = catalog.data.profiles;
	if (rawProfiles !== undefined) {
		if (!Array.isArray(rawProfiles)) warnings.push("Catalog profiles is not an array; ignored.");
		else {
			for (const [index, profile] of rawProfiles.entries()) {
				if (!isObject(profile)) {
					warnings.push(`Catalog profile ${index} is not an object; ignored.`);
					continue;
				}
				if (typeof profile.id !== "string" || !profile.id.trim()) {
					warnings.push(`Catalog profile ${index} has no id; ignored.`);
					continue;
				}
				const profileItems = Array.isArray(profile.items) ? profile.items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
				const profileSources = Array.isArray(profile.sources) ? profile.sources.filter((source): source is string => typeof source === "string" && source.trim().length > 0).map((source) => source.trim()) : [];
				profiles.push({
					...profile,
					id: profile.id.trim(),
					name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : undefined,
					kind: "profile",
					items: profileItems,
					sources: profileSources,
					createdAt: typeof profile.createdAt === "string" ? profile.createdAt : undefined,
					updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : undefined,
				});
			}
		}
	}
	return { data: { version: 1, items, profiles }, warnings };
}

export function deriveId(source: string): string {
	let candidate = source.trim().replace(/\/+$/, "");
	if (candidate.startsWith("npm:")) {
		candidate = candidate.slice(4);
		const versionAt = candidate.lastIndexOf("@");
		if (versionAt > 0) candidate = candidate.slice(0, versionAt);
	} else if (
		candidate.startsWith("/") ||
		candidate.startsWith("./") ||
		candidate.startsWith("../") ||
		candidate.startsWith("~")
	) {
		candidate = candidate.split("/").filter(Boolean).at(-1) ?? candidate;
	} else {
		candidate = candidate
			.replace(/^git:/, "")
			.replace(/^https?:\/\//, "")
			.replace(/^ssh:\/\//, "")
			.replace(/\.git$/, "");
		const refAt = candidate.lastIndexOf("@");
		if (refAt > candidate.lastIndexOf("/")) candidate = candidate.slice(0, refAt);
		const parts = candidate.split(/[/:]/).filter(Boolean);
		candidate = parts.at(-1) ?? candidate;
	}
	const id = candidate
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return id || "package";
}

export function uniqueId(baseId: string, items: CatalogItem[]): string {
	const existing = new Set(items.map((item) => item.id));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
}

export function findCatalogItem(items: CatalogItem[], query: string): CatalogItem | undefined {
	return items.find((item) => item.id === query || item.source === query || item.name === query);
}

export async function findCatalogItemForSource(items: CatalogItem[], source: string, baseDir: string): Promise<CatalogItem | undefined> {
	const sourceMatches = new Set(await packageSourceMatchValues(source, baseDir));
	for (const item of items) {
		if (item.source === source || sourceMatches.has(item.source)) return item;
		const itemMatches = await packageSourceMatchValues(item.source, baseDir);
		if (itemMatches.some((candidate) => sourceMatches.has(candidate))) return item;
	}
	return undefined;
}

export function formatCatalogItem(item: CatalogItem): string {
	const name = item.name ? ` (${item.name})` : "";
	const description = item.description ? ` — ${item.description}` : "";
	return `- ${item.id}${name}: ${item.source}${description}`;
}

export async function loadCatalog(ctx: Pick<ExtensionCommandContext, "cwd">): Promise<{ paths: ConstructPaths; read: JsonReadResult; catalog: CatalogData; warnings: string[] }> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userCatalogPath);
	const { data, warnings } = parseCatalog(read);
	return { paths, read, catalog: data, warnings };
}

export async function packageSourcesFromSettings(settingsPath: string): Promise<string[]> {
	const settings = await readJson(settingsPath);
	const baseDir = dirname(settingsPath);
	const packages = getPackages(settings).filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.source.trim());
	const sources: string[] = [];
	for (const pkg of packages) {
		sources.push(await normalizeSourceForLibrary(pkg.source, baseDir));
	}
	return sources;
}

export async function addSourcesToCatalog(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	sources: string[],
	prewrite?: () => Promise<void>,
	agentSkillsBySource: ReadonlyMap<string, CatalogAgentSkillsOpinion> = new Map(),
): Promise<LoadResult> {
	const paths = await getPaths(ctx);
	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		return { added: [], alreadyKnown: 0, warnings: [`Skipped Construct library load because ${describeJsonReadIssue("catalog", catalogRead)}`] };
	}

	const { data: catalog, warnings } = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && warnings.length > 0) {
		return { added: [], alreadyKnown: 0, warnings: [`Skipped Construct library load because catalog has warnings; fix ${paths.userCatalogPath} first.`, ...warnings] };
	}

	const baseDir = dirname(paths.projectSettingsPath);
	const existingSources = new Map<string, number>();
	for (const [index, item] of catalog.items.entries()) {
		for (const match of await packageSourceMatchValues(item.source, baseDir)) existingSources.set(match, index);
	}
	const nextItems = [...catalog.items];
	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	let snapshotsChanged = false;
	for (const source of sources) {
		if (!source) continue;
		const matches = await packageSourceMatchValues(source, baseDir);
		const existingIndex = matches.map((match) => existingSources.get(match)).find((index): index is number => index !== undefined);
		const hasOpinion = agentSkillsBySource.has(source);
		const opinion = hasOpinion ? agentSkillsBySource.get(source) : undefined;
		if (existingIndex !== undefined) {
			alreadyKnown += 1;
			const applied = applyAgentSkillsOpinion(nextItems[existingIndex], opinion, hasOpinion);
			if (applied.changed) {
				nextItems[existingIndex] = applied.item;
				snapshotsChanged = true;
			}
			continue;
		}
		const item: CatalogItem = { id: uniqueId(deriveId(source), nextItems), kind: "package", source, ...(opinion ? { agentSkills: opinion } : {}) };
		const index = nextItems.length;
		nextItems.push(item);
		added.push(item);
		for (const match of matches) existingSources.set(match, index);
	}

	if (added.length > 0 || snapshotsChanged) {
		await prewrite?.();
		await writeJson(paths.userCatalogPath, { ...catalog, version: 1, items: nextItems.sort((a, b) => a.id.localeCompare(b.id)) });
	}
	return { added, alreadyKnown, warnings };
}

/**
 * Update `agentSkills` snapshots on already-present catalog items only. Unlike
 * `addSourcesToCatalog`, this never creates a new Construct library entry: dashboard package
 * removal must not add a source the user never put in the library. Preserves unrelated
 * catalog and item fields and runs the caller's prewrite before writing so trust and idle
 * state can be re-checked.
 */
export async function updateExistingCatalogAgentSkills(
	ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">,
	agentSkillsBySource: ReadonlyMap<string, CatalogAgentSkillsOpinion>,
	prewrite?: () => Promise<void>,
): Promise<{ updated: number; warnings: string[] }> {
	if (agentSkillsBySource.size === 0) return { updated: 0, warnings: [] };
	const paths = await getPaths(ctx);
	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		return { updated: 0, warnings: [`Skipped Construct library update because ${describeJsonReadIssue("catalog", catalogRead)}`] };
	}
	const { data: catalog, warnings } = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && warnings.length > 0) {
		return { updated: 0, warnings: [`Skipped Construct library update because catalog has warnings; fix ${paths.userCatalogPath} first.`, ...warnings] };
	}
	const baseDir = dirname(paths.projectSettingsPath);
	const matchIndex = new Map<string, number>();
	for (const [index, item] of catalog.items.entries()) {
		for (const match of await packageSourceMatchValues(item.source, baseDir)) {
			if (!matchIndex.has(match)) matchIndex.set(match, index);
		}
	}
	const nextItems = [...catalog.items];
	let updated = 0;
	for (const [source, opinion] of agentSkillsBySource) {
		const matches = await packageSourceMatchValues(source, baseDir);
		const index = matches.map((match) => matchIndex.get(match)).find((candidate): candidate is number => candidate !== undefined);
		if (index === undefined) continue; // never create
		const applied = applyAgentSkillsOpinion(nextItems[index], opinion, true);
		if (!applied.changed) continue;
		nextItems[index] = applied.item;
		updated += 1;
	}
	if (updated === 0) return { updated: 0, warnings };
	await prewrite?.();
	await writeJson(paths.userCatalogPath, { ...catalog, version: 1, items: nextItems.sort((a, b) => a.id.localeCompare(b.id)) });
	return { updated, warnings };
}

