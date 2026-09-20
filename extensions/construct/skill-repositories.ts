import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { CatalogAgentSkillsInventory, ConstructPaths, DirectResourceSummary } from "./types.js";
import { canonicalCatalogAgentSkillsInventory } from "./catalog.js";
import { isObject } from "./json.js";
import { isLocalPathSource } from "./sources.js";
import { createProjectPackageManager, getTemporaryInstalledPath } from "./pi-adapter/package-manager.js";
import { createProjectSettingsManager, flushProjectSettings } from "./pi-adapter/settings.js";
import { backupProjectSettingsIfPresent } from "./project-settings.js";

/**
 * Git package declarations that Pi installs/clones but whose checkout exposes no
 * native Pi package resources. Construct discovers valid Agent Skills in the
 * managed checkout and links selected skill roots through the project-level
 * top-level `skills` array. Pi still owns clone/update via `pi update --extensions`.
 */

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function relativeInside(base: string, path: string): string | undefined {
	const value = relative(base, path);
	if (!value || value.startsWith("..") || isAbsolute(value)) return undefined;
	return toPosix(value);
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isInsideOrSame(base: string, path: string): boolean {
	const value = relative(base, path);
	return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function hasGlob(value: string): boolean {
	return /[*?{}[\]]/.test(value);
}

function literalGlobPrefix(value: string): string | undefined {
	const index = value.search(/[*?{}[\]]/);
	return index < 0 ? undefined : value.slice(0, index);
}

/** Like {@link relativeInside}, but the base itself maps to "." instead of being discarded. */
function relativeInsideOrDot(base: string, path: string): string | undefined {
	const value = relative(base, path);
	if (value === "") return ".";
	if (value.startsWith("..") || isAbsolute(value)) return undefined;
	return toPosix(value);
}

export interface PackageSkillCandidate {
	name: string;
	description: string;
	/** Skill root relative to the managed package checkout (posix). */
	packageRelativeRoot: string;
	/** SKILL.md relative to the managed package checkout (posix). */
	packageRelativeFile: string;
	/** Present for a live checkout; omitted from read-only catalog/cache previews. */
	absoluteRoot?: string;
	absoluteFile?: string;
	/** Skill root relative to the project `.pi` settings directory (posix). */
	settingsPath?: string;
	linked: boolean;
	enabled: boolean;
}

export interface PackageSkillRepository {
	source: string;
	/** Present for a live checkout; omitted from advisory catalog previews. */
	packageRoot?: string;
	skills: PackageSkillCandidate[];
	diagnostics: string[];
	/** True for read-only catalog or temporary-cache previews. */
	catalogPreview?: boolean;
}

/**
 * Canonical bounded conversion of a discovered repository into advisory catalog data. Returns
 * `undefined` when the repository cannot produce a parser-valid snapshot (no skills, more than
 * the maximum entry count, an invalid length, or a duplicate canonical root), so writers never
 * emit a catalog entry that would later block mutation when parsed.
 */
export function catalogAgentSkillsInventory(repository: PackageSkillRepository): CatalogAgentSkillsInventory | undefined {
	return canonicalCatalogAgentSkillsInventory(repository.skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		root: skill.packageRelativeRoot,
	})));
}

/** Build a read-only Available-row view from relative advisory catalog data. */
export function catalogAgentSkillsPreview(source: string, inventory: CatalogAgentSkillsInventory): PackageSkillRepository {
	return {
		source,
		catalogPreview: true,
		diagnostics: [],
		skills: inventory.skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			packageRelativeRoot: skill.root,
			packageRelativeFile: skill.root === "." ? "SKILL.md" : `${skill.root}/SKILL.md`,
			linked: false,
			enabled: false,
		})),
	};
}

export type PackageSkillRepositoryState = "active" | "inactive";

type MarketplaceRoots =
	| { state: "missing" }
	| { state: "ok"; roots: string[] }
	| { state: "invalid"; diagnostic: string };

/**
 * Claude Code plugin marketplaces declare their skill roots in
 * `.claude-plugin/marketplace.json`. Respect that list when present so template
 * or example skills that are not published plugins are not offered.
 *
 * A present-but-malformed manifest is reported as invalid and must never fall
 * back to recursively publishing every SKILL.md in the checkout.
 */
function marketplaceSkillRoots(packageRoot: string): MarketplaceRoots {
	const path = resolve(packageRoot, ".claude-plugin", "marketplace.json");
	if (!existsSync(path)) return { state: "missing" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { state: "invalid", diagnostic: `.claude-plugin/marketplace.json could not be parsed: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!isObject(parsed) || !Array.isArray(parsed.plugins)) {
		return { state: "invalid", diagnostic: ".claude-plugin/marketplace.json is not a plugin marketplace (expected an object with a plugins array)." };
	}
	const roots: string[] = [];
	for (const plugin of parsed.plugins) {
		if (!isObject(plugin) || typeof plugin.source !== "string") continue;
		const root = canonical(resolve(packageRoot, plugin.source));
		if (!isInsideOrSame(packageRoot, root) || !existsSync(resolve(root, "SKILL.md"))) continue;
		roots.push(root);
	}
	return { state: "ok", roots: [...new Set(roots)].sort() };
}

function nativeSkillRoots(packageRoot: string, source: string): { roots: string[]; diagnostics: string[] } {
	const loaded = loadSkillsFromDir({ dir: packageRoot, source });
	return {
		roots: [...new Set(loaded.skills.map((skill) => canonical(skill.baseDir)))].sort(),
		diagnostics: loaded.diagnostics.map((diagnostic) => diagnostic.message),
	};
}

function resolvedSkillByFile(resources: DirectResourceSummary[]): Map<string, DirectResourceSummary> {
	const result = new Map<string, DirectResourceSummary>();
	for (const resource of resources) {
		if (resource.kind !== "skill") continue;
		result.set(canonical(resource.path), resource);
	}
	return result;
}

export interface PackageSkillDiscovery {
	repository?: PackageSkillRepository;
	diagnostics: string[];
	/** True once a real checkout was located and inspected, even if no adapter/skills were found. */
	inspected: boolean;
}

interface SkillRootInfo {
	name: string;
	description: string;
	relativeRoot: string;
	relativeFile: string;
	absoluteFile: string;
}

/** Shared per-root validation/loading used by both project and temporary-cache inspection. */
function inspectSkillRoot(packageRoot: string, source: string, root: string): SkillRootInfo | undefined {
	const relativeRoot = relativeInsideOrDot(packageRoot, root);
	const absoluteFile = canonical(resolve(root, "SKILL.md"));
	const relativeFile = relativeInsideOrDot(packageRoot, absoluteFile);
	if (!relativeRoot || !relativeFile || !existsSync(absoluteFile)) return undefined;
	const loaded = loadSkillsFromDir({ dir: root, source });
	const skill = loaded.skills.find((candidate) => canonical(candidate.filePath) === absoluteFile);
	if (!skill) return undefined;
	return { name: skill.name, description: skill.description, relativeRoot, relativeFile, absoluteFile };
}

/**
 * Inspect an already-cached Pi temporary checkout for Agent Skills. Cache-only and read-only: it
 * never clones, fetches, inspects another project's `.pi` checkout, or returns absolute/settings
 * paths, so the resulting rows are a non-persistent preview that can never drive a settings write.
 */
export function discoverTemporaryPackageSkillRepository(paths: ConstructPaths, source: string): PackageSkillDiscovery {
	// Only Pi-owned temporary checkouts (git/npm) are in scope. Local sources are the real path, not a
	// cache, so they keep the catalog-snapshot fallback instead.
	if (isLocalPathSource(source)) return { diagnostics: [], inspected: false };
	let installedPath: string | undefined;
	try {
		const { manager } = createProjectPackageManager(paths, { projectTrusted: true });
		installedPath = getTemporaryInstalledPath(manager, source);
	} catch {
		return { diagnostics: [], inspected: false };
	}
	if (!installedPath || !existsSync(installedPath)) return { diagnostics: [], inspected: false };
	const packageRoot = canonical(installedPath);
	const marketplace = marketplaceSkillRoots(packageRoot);
	if (marketplace.state === "invalid") return { diagnostics: [marketplace.diagnostic], inspected: true };
	const native = marketplace.state === "ok" ? { roots: marketplace.roots, diagnostics: [] } : nativeSkillRoots(packageRoot, source);
	if (native.roots.length === 0) return { diagnostics: native.diagnostics, inspected: true };
	const skills: PackageSkillCandidate[] = [];
	for (const root of native.roots) {
		const info = inspectSkillRoot(packageRoot, source, root);
		if (!info) continue;
		skills.push({ name: info.name, description: info.description, packageRelativeRoot: info.relativeRoot, packageRelativeFile: info.relativeFile, linked: false, enabled: false });
	}
	if (skills.length === 0) return { diagnostics: native.diagnostics, inspected: true };
	skills.sort((a, b) => a.name.localeCompare(b.name) || a.packageRelativeRoot.localeCompare(b.packageRelativeRoot));
	// Omit packageRoot and per-skill absolute paths: the temporary cache path is ephemeral and must
	// never be used for settings writes. `catalogPreview` marks this as a read-only cache preview.
	return { repository: { source, skills, diagnostics: native.diagnostics, catalogPreview: true }, diagnostics: native.diagnostics, inspected: true };
}

/**
 * Inspect a managed Git/npm checkout for Agent Skills when Pi resolved zero
 * native package resources. Read-only: never clones, installs, or edits settings.
 */
export async function discoverPackageSkillRepository(
	paths: ConstructPaths,
	source: string,
	directResources: DirectResourceSummary[],
	options: { projectTrusted?: boolean } = {},
): Promise<PackageSkillDiscovery> {
	let installedPath: string | undefined;
	try {
		const { manager } = createProjectPackageManager(paths, { projectTrusted: options.projectTrusted ?? true });
		installedPath = manager.getInstalledPath(source, "project");
	} catch {
		// Resolver failure: not inspected, so callers must keep any existing snapshot.
		return { diagnostics: [], inspected: false };
	}
	if (!installedPath || !existsSync(installedPath)) return { diagnostics: [], inspected: false };
	// A checkout exists from here on: malformed marketplace or zero discovered skills still count
	// as an authoritative "inspected, no adapter" result (diagnostics retained).
	const packageRoot = canonical(installedPath);
	const marketplace = marketplaceSkillRoots(packageRoot);
	if (marketplace.state === "invalid") return { diagnostics: [marketplace.diagnostic], inspected: true };
	const native = marketplace.state === "ok" ? { roots: marketplace.roots, diagnostics: [] } : nativeSkillRoots(packageRoot, source);
	if (native.roots.length === 0) return { diagnostics: native.diagnostics, inspected: true };

	const settingsDir = canonical(dirname(paths.projectSettingsPath));
	const resolvedByFile = resolvedSkillByFile(directResources);
	const skills: PackageSkillCandidate[] = [];
	for (const root of native.roots) {
		const info = inspectSkillRoot(packageRoot, source, root);
		if (!info) continue;
		const settingsPath = relativeInside(settingsDir, root);
		if (!settingsPath) continue;
		const resolvedResource = resolvedByFile.get(info.absoluteFile);
		skills.push({
			name: info.name,
			description: info.description,
			packageRelativeRoot: info.relativeRoot,
			packageRelativeFile: info.relativeFile,
			absoluteRoot: root,
			absoluteFile: info.absoluteFile,
			settingsPath,
			linked: resolvedResource !== undefined,
			enabled: resolvedResource?.enabled ?? false,
		});
	}
	if (skills.length === 0) return { diagnostics: native.diagnostics, inspected: true };
	skills.sort((a, b) => a.name.localeCompare(b.name) || a.packageRelativeRoot.localeCompare(b.packageRelativeRoot));
	return { repository: { source, packageRoot, skills, diagnostics: native.diagnostics }, diagnostics: native.diagnostics, inspected: true };
}

/** Match a managed package row to a discovered skill repository by source identity. */
export function packageSkillRepositoryFor(
	repositories: readonly PackageSkillRepository[],
	target: { source: string; matchSources: readonly string[] },
): PackageSkillRepository | undefined {
	return repositories.find((repository) => repository.source === target.source || target.matchSources.includes(repository.source));
}

/** True when a resolved path (or its skill root) is one of the repository's managed skill roots. */
export function skillRepositoryOwnsPath(repository: PackageSkillRepository, path: string): boolean {
	if (repository.catalogPreview) return false;
	const target = canonical(path);
	return repository.skills.some((skill) =>
		(skill.absoluteFile !== undefined && target === skill.absoluteFile)
		|| (skill.absoluteRoot !== undefined && target === skill.absoluteRoot));
}

export function skillRepositoriesOwnPath(repositories: readonly PackageSkillRepository[], path: string): boolean {
	return repositories.some((repository) => skillRepositoryOwnsPath(repository, path));
}

export function skillRepositoryState(repository: PackageSkillRepository): PackageSkillRepositoryState {
	// Any enabled linked skill is Active. Zero linked skills (nothing linked yet) and the
	// all-linked-off case are both Disabled/inactive; only genuinely unresolved packages
	// with no discovered adapter remain Unresolved upstream.
	return repository.skills.some((skill) => skill.linked && skill.enabled) ? "active" : "inactive";
}

/** Stable per-review signature; any skill/link/enabled change requires re-review. */
export function skillRepositorySignature(repository: PackageSkillRepository): string {
	return JSON.stringify({
		root: repository.packageRoot ?? "catalog-preview",
		skills: repository.skills.map((skill) => ({
			name: skill.name,
			root: skill.packageRelativeRoot,
			linked: skill.linked,
			enabled: skill.enabled,
		})),
	});
}

function entryTarget(entry: unknown, settingsDir: string): string | undefined {
	if (typeof entry !== "string") return undefined;
	const raw = entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
	if (!raw || /[*?{}[\]]/.test(raw)) return undefined;
	return canonical(isAbsolute(raw) ? raw : resolve(settingsDir, raw));
}

export interface SkillRepositoryLinkUpdate {
	updated: boolean;
	needsReload: boolean;
	backupPath?: string;
	linkedCount: number;
	reason?: string;
}

/**
 * Toggle selected Agent Skill roots in the project-level top-level `skills`
 * array. Selected linked skills are removed, selected unlinked skills are added,
 * and unselected skills keep their current state. Writes through SettingsManager
 * after a settings backup so unrelated parsed settings survive.
 */
export async function togglePackageSkillRepositoryLinks(
	paths: ConstructPaths,
	repository: PackageSkillRepository,
	toggledRelativeRoots: Iterable<string>,
	options: { projectTrusted?: boolean; backupPath?: string } = {},
): Promise<SkillRepositoryLinkUpdate> {
	const currentLinked = repository.skills.filter((skill) => skill.linked).length;
	if (repository.catalogPreview || repository.skills.some((skill) => !skill.absoluteRoot || !skill.settingsPath)) {
		return { updated: false, needsReload: false, linkedCount: currentLinked, reason: "Install the package and reopen /construct before changing Agent Skill links." };
	}
	if (options.projectTrusted === false) {
		return { updated: false, needsReload: false, linkedCount: currentLinked, reason: "Project is not trusted by Pi; refusing to edit project skill settings." };
	}
	const toggled = new Set(toggledRelativeRoots);
	if (toggled.size === 0) {
		return { updated: false, needsReload: false, linkedCount: currentLinked, reason: "No Agent Skills were selected." };
	}

	let manager;
	try {
		manager = createProjectSettingsManager(paths.cwd, { projectTrusted: options.projectTrusted });
	} catch (error) {
		return { updated: false, needsReload: false, linkedCount: currentLinked, reason: `Could not read .pi/settings.json: ${error instanceof Error ? error.message : String(error)}` };
	}
	const entries = manager.getProjectSettings().skills ?? [];
	if (entries.some((entry) => typeof entry !== "string")) {
		return { updated: false, needsReload: false, linkedCount: currentLinked, reason: "Project skills contains a non-string entry; refusing to rewrite it." };
	}
	const settingsDir = canonical(dirname(paths.projectSettingsPath));
	const candidateByRoot = new Map(repository.skills.map((skill) => [canonical(skill.absoluteRoot!), skill]));
	const exactEntryByRoot = new Map<string, string>();
	for (const entry of entries) {
		const target = entryTarget(entry, settingsDir);
		if (target !== undefined && !exactEntryByRoot.has(target)) exactEntryByRoot.set(target, entry);
	}
	for (const skill of repository.skills) {
		if (!toggled.has(skill.packageRelativeRoot) || !skill.linked) continue;
		if (!exactEntryByRoot.has(canonical(skill.absoluteRoot!))) {
			return {
				updated: false,
				needsReload: false,
				linkedCount: currentLinked,
				reason: `${skill.name} is linked through a broader skill path or pattern. Use pi config -l to change that path safely.`,
			};
		}
	}

	const retained = entries.filter((entry) => {
		const target = entryTarget(entry, settingsDir);
		return target === undefined || !candidateByRoot.has(target);
	});
	const linkedEntries: string[] = [];
	for (const skill of repository.skills) {
		if (toggled.has(skill.packageRelativeRoot)) {
			// Selected linked skills unlink; selected unlinked skills link with a plain path.
			if (!skill.linked) linkedEntries.push(skill.settingsPath!);
			continue;
		}
		if (!skill.linked) continue;
		// Unselected linked skills keep their exact current entry (including + or ! form).
		linkedEntries.push(exactEntryByRoot.get(canonical(skill.absoluteRoot!)) ?? skill.settingsPath!);
	}
	const next = [...retained, ...linkedEntries].filter((entry, index, values) => values.indexOf(entry) === index);
	const backupPath = options.backupPath ?? await backupProjectSettingsIfPresent(paths);
	manager.setProjectSkillPaths(next);
	await flushProjectSettings(manager, "write project Agent Skill links");
	return { updated: true, needsReload: true, backupPath, linkedCount: linkedEntries.length };
}

export interface PackageSkillLinkRemoval {
	updated: boolean;
	removed: number;
	backupPath?: string;
	packageRoot?: string;
	reason?: string;
}

/**
 * Remove every project-level skill entry that points inside a managed package
 * checkout. Called before removing the carrier package so no dangling project
 * skill paths remain.
 */
export async function removePackageSkillLinks(
	paths: ConstructPaths,
	source: string,
	options: { projectTrusted?: boolean; backupPath?: string } = {},
): Promise<PackageSkillLinkRemoval> {
	if (options.projectTrusted === false) {
		return { updated: false, removed: 0, reason: "Project is not trusted by Pi; refusing to edit project skill settings." };
	}
	let installedPath: string | undefined;
	try {
		const { manager } = createProjectPackageManager(paths, { projectTrusted: options.projectTrusted });
		installedPath = manager.getInstalledPath(source, "project");
	} catch (error) {
		return { updated: false, removed: 0, reason: `Could not resolve the installed package path: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!installedPath || !existsSync(installedPath)) return { updated: false, removed: 0 };
	const packageRoot = canonical(installedPath);

	let manager;
	try {
		manager = createProjectSettingsManager(paths.cwd, { projectTrusted: options.projectTrusted });
	} catch (error) {
		return { updated: false, removed: 0, packageRoot, reason: `Could not read .pi/settings.json: ${error instanceof Error ? error.message : String(error)}` };
	}
	const entries = manager.getProjectSettings().skills ?? [];
	const settingsDir = canonical(dirname(paths.projectSettingsPath));
	let removed = 0;
	const next: string[] = [];
	const broadPatterns: string[] = [];
	for (const entry of entries) {
		const target = entryTarget(entry, settingsDir);
		if (target) {
			if (target === packageRoot || relativeInside(packageRoot, target)) {
				removed += 1;
				continue;
			}
			next.push(entry);
			continue;
		}
		// Glob entries do not resolve to one path. Remove patterns whose literal prefix is inside
		// (or equal to) the checkout; refuse broader patterns that could cover other packages so a
		// known package-root skill setting is never silently left dangling.
		if (typeof entry === "string" && hasGlob(entry)) {
			const raw = entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
			const prefix = literalGlobPrefix(raw);
			if (prefix) {
				const prefixPath = canonical(isAbsolute(prefix) ? prefix : resolve(settingsDir, prefix));
				if (isInsideOrSame(packageRoot, prefixPath)) {
					removed += 1;
					continue;
				}
				if (isInsideOrSame(prefixPath, packageRoot)) {
					broadPatterns.push(entry);
					next.push(entry);
					continue;
				}
			}
		}
		next.push(entry);
	}
	if (broadPatterns.length > 0) {
		return {
			updated: false,
			removed: 0,
			packageRoot,
			reason: `Project skills contains ${broadPatterns.length} broader pattern${broadPatterns.length === 1 ? "" : "s"} that can cover other packages (${broadPatterns.slice(0, 3).join(", ")}${broadPatterns.length > 3 ? ", …" : ""}). Resolve it with pi config -l before removing this package.`,
		};
	}
	if (removed === 0) return { updated: false, removed: 0, packageRoot };
	const backupPath = options.backupPath ?? await backupProjectSettingsIfPresent(paths);
	manager.setProjectSkillPaths(next);
	await flushProjectSettings(manager, "remove project Agent Skill links");
	return { updated: true, removed, packageRoot, backupPath };
}
