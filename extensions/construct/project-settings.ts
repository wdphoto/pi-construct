import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConstructPaths, DirectResourceSummary, JsonObject, JsonReadResult, ManagedItemSummary, PackageDeclarationSummary } from "./types.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "./json.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary, packageSourceIdentity } from "./sources.js";

export function looksLikePackageSource(value: string): boolean {
	return (
		value.startsWith("npm:") ||
		value.startsWith("git:") ||
		value.startsWith("https://") ||
		value.startsWith("http://") ||
		value.startsWith("ssh://") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith("/") ||
		value.startsWith("~")
	);
}

const packageResourceFilterKeys = ["extensions", "skills", "prompts", "themes"] as const;

const directResourceSettingsKeys = {
	extension: "extensions",
	skill: "skills",
	prompt: "prompts",
	theme: "themes",
} as const;

export function packageResourcesDisabled(entry: unknown): boolean {
	if (!isObject(entry) || typeof entry.source !== "string") return false;
	return packageResourceFilterKeys.every((key) => Array.isArray(entry[key]) && entry[key].length === 0);
}

export function getPackages(settings: JsonReadResult): PackageDeclarationSummary[] {
	if (settings.state !== "ok" || !isObject(settings.data)) return [];
	const packages = settings.data.packages;
	if (!Array.isArray(packages)) return [];

	return packages.map((entry): PackageDeclarationSummary => {
		if (typeof entry === "string") {
			return { source: entry, form: "string", enabled: true, disabledByFilters: false };
		}
		if (isObject(entry) && typeof entry.source === "string") {
			return { source: entry.source, form: "object", enabled: true, disabledByFilters: packageResourcesDisabled(entry) };
		}
		return { source: "<invalid package declaration>", form: "invalid", enabled: false, disabledByFilters: false };
	});
}

export interface PackageSourceSets {
	declaredSources: Set<string>;
	activeSources: Set<string>;
	disabledSources: Set<string>;
}

export async function collectPackageSourceSets(packages: PackageDeclarationSummary[], settingsDir: string): Promise<PackageSourceSets> {
	const declaredSources = new Set<string>();
	const activeSources = new Set<string>();
	const disabledSources = new Set<string>();
	for (const pkg of packages) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		const normalized = await normalizeSourceForLibrary(pkg.source, settingsDir);
		for (const source of [pkg.source, normalized]) {
			declaredSources.add(source);
			if (pkg.disabledByFilters) disabledSources.add(source);
			else activeSources.add(source);
		}
	}
	return { declaredSources, activeSources, disabledSources };
}

export async function getManagedItems(
	construct: JsonReadResult,
	packageSources: Set<string>,
	paths: ConstructPaths,
	disabledPackageSources = new Set<string>(),
): Promise<ManagedItemSummary[]> {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	const summaries: ManagedItemSummary[] = [];
	const seenPackageKeys = new Set<string>();
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value)) {
			summaries.push({ id, kind: "unknown", drift: "invalid metadata" });
			continue;
		}
		const kind = typeof value.kind === "string" ? value.kind : "unknown";
		const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
		let source: string | undefined;
		let drift: string | undefined;
		if (kind === "package") {
			const identity = await managedPackageSourceIdentity(value, paths);
			source = identity.displaySource;
			const identityKey = identity.normalizedInstallSource ?? source;
			if (identityKey) {
				if (seenPackageKeys.has(identityKey)) continue;
				seenPackageKeys.add(identityKey);
			}
			if (source) {
				const declared = [...identity.matchSources].some((candidate) => packageSources.has(candidate));
				const disabledByFilters = [...identity.matchSources].some((candidate) => disabledPackageSources.has(candidate));
				if (enabled === true && !declared) drift = "enabled in Construct metadata, missing from .pi/settings.json";
				if (enabled === true && disabledByFilters) drift = "enabled in Construct metadata, disabled by package filters";
				if (enabled === false && !declared) drift = "disabled in Construct metadata, missing from .pi/settings.json";
				if (enabled === false && declared && !disabledByFilters) drift = "disabled in Construct metadata, still active in .pi/settings.json";
			}
		} else if (typeof value.path === "string") {
			source = value.path;
		}
		summaries.push({ id, kind, source, enabled, drift });
	}
	return summaries;
}

export function formatList(lines: string[], empty: string): string[] {
	return lines.length > 0 ? lines : [`- ${empty}`];
}

export function timestampForFile(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

export async function backupProjectSettingsIfPresent(paths: ConstructPaths): Promise<string | undefined> {
	if (!existsSync(paths.projectSettingsPath)) return undefined;
	const backupPath = `${paths.projectSettingsPath}.bak.${timestampForFile()}`;
	await copyFile(paths.projectSettingsPath, backupPath);
	return backupPath;
}

export function parseProjectConstruct(construct: JsonReadResult): JsonObject {
	if (construct.state === "missing") {
		return { version: 1, managedBy: "the-construct", items: {} };
	}
	if (construct.state === "invalid") {
		throw new Error(`Cannot update Construct metadata because ${describeJsonReadIssue(".pi/construct.json", construct)}`);
	}
	if (!isObject(construct.data)) {
		throw new Error("Cannot update Construct metadata because .pi/construct.json is not an object.");
	}
	return { ...construct.data };
}

export function upsertConstructItem(
	construct: JsonObject,
	itemId: string,
	declaredSource: string,
	requestedSource: string,
	paths: ConstructPaths,
	options: { enabled?: boolean } = {},
): JsonObject {
	const existingItems = isObject(construct.items) ? construct.items : {};
	const now = new Date().toISOString();
	const existingItem = isObject(existingItems[itemId]) ? existingItems[itemId] : {};
	const enabled = options.enabled ?? true;
	return {
		...construct,
		version: 1,
		managedBy: "the-construct",
		loadedAt: typeof construct.loadedAt === "string" ? construct.loadedAt : now,
		targetCwd: paths.realCwd,
		items: {
			...existingItems,
			[itemId]: {
				...existingItem,
				kind: "package",
				source: declaredSource,
				...(declaredSource === requestedSource ? {} : { requestedSource }),
				enabled,
				loadedAt: typeof existingItem.loadedAt === "string" ? existingItem.loadedAt : now,
				updatedAt: now,
			},
		},
	};
}

function sourceSetsOverlap(a: Set<string>, b: Set<string>): boolean {
	for (const value of a) {
		if (b.has(value)) return true;
	}
	return false;
}

export async function uniqueManagedIdInConstruct(construct: JsonObject, baseId: string, declaredSource: string, requestedSource: string, paths: ConstructPaths): Promise<string> {
	const items = isObject(construct.items) ? construct.items : {};
	const targetIdentity = await packageSourceIdentity(declaredSource, requestedSource, paths);
	for (const [id, value] of Object.entries(items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (identity.normalizedInstallSource && targetIdentity.normalizedInstallSource && identity.normalizedInstallSource === targetIdentity.normalizedInstallSource) return id;
		if (sourceSetsOverlap(identity.matchSources, targetIdentity.matchSources)) return id;
	}
	const existing = new Set(Object.keys(items));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
}

export async function uniqueManagedId(baseId: string, construct: JsonReadResult, declaredSource: string, requestedSource: string, paths: ConstructPaths): Promise<string> {
	if (construct.state !== "ok" || !isObject(construct.data)) return baseId;
	return uniqueManagedIdInConstruct(construct.data, baseId, declaredSource, requestedSource, paths);
}

export function chooseDeclaredSource(before: PackageDeclarationSummary[], after: PackageDeclarationSummary[], requestedSource: string): string {
	if (after.some((pkg) => pkg.source === requestedSource)) return requestedSource;
	const beforeSources = new Set(before.map((pkg) => pkg.source));
	const added = after.filter((pkg) => !beforeSources.has(pkg.source));
	if (added.length > 0) return added.at(-1)?.source ?? requestedSource;
	return after.at(-1)?.source ?? requestedSource;
}

export function packageSource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry;
	if (isObject(entry) && typeof entry.source === "string") return entry.source;
	return undefined;
}

export function readSettingsObject(settings: JsonReadResult): JsonObject {
	if (settings.state === "missing") return {};
	if (settings.state === "invalid") throw new Error(`Cannot edit .pi/settings.json because ${describeJsonReadIssue(".pi/settings.json", settings)}`);
	if (!isObject(settings.data)) throw new Error("Cannot edit .pi/settings.json because it is not a JSON object.");
	return { ...settings.data };
}

async function targetSourceMatches(paths: ConstructPaths, source: string, rawSource: string): Promise<boolean> {
	const settingsDir = dirname(paths.projectSettingsPath);
	const targetMatches = new Set([
		source,
		await normalizeSourceForLibrary(source, settingsDir),
		await normalizeSourceForLibrary(source, paths.cwd),
	]);
	const normalized = await normalizeSourceForLibrary(rawSource, settingsDir);
	return targetMatches.has(rawSource) || targetMatches.has(normalized);
}

function packageEntryWithDisabledResources(entry: unknown, source: string): JsonObject {
	const base: JsonObject = isObject(entry) ? { ...entry, source } : { source };
	for (const key of packageResourceFilterKeys) base[key] = [];
	return base;
}

function packageEntryWithEnabledResources(entry: unknown, source: string): unknown {
	if (!isObject(entry)) return source;
	const next: JsonObject = { ...entry, source };
	for (const key of packageResourceFilterKeys) delete next[key];
	const keys = Object.keys(next);
	return keys.length === 1 && next.source === source ? source : next;
}

export async function setMatchingPackageResourcesDisabled(
	paths: ConstructPaths,
	source: string,
	disabled: boolean,
	options: { backupPath?: string } = {},
): Promise<{ updated: boolean; backupPath?: string; settingsMissing: boolean }> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "missing") return { updated: false, settingsMissing: true };

	const settings = readSettingsObject(settingsRead);
	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const nextPackages = [];
	let updated = false;
	for (const entry of packages) {
		const rawSource = packageSource(entry);
		if (!rawSource || !(await targetSourceMatches(paths, source, rawSource))) {
			nextPackages.push(entry);
			continue;
		}
		updated = true;
		nextPackages.push(disabled ? packageEntryWithDisabledResources(entry, rawSource) : packageEntryWithEnabledResources(entry, rawSource));
	}
	if (!updated) return { updated: false, settingsMissing: false };

	const backupPath = options.backupPath ?? await backupProjectSettingsIfPresent(paths);
	settings.packages = nextPackages;
	await writeJson(paths.projectSettingsPath, settings);
	return { updated: true, backupPath, settingsMissing: false };
}

function directResourceSettingsPath(resource: DirectResourceSummary): string | undefined {
	if (resource.settingsPath) return resource.settingsPath;
	if (resource.displayPath.startsWith(".pi/")) return resource.displayPath.slice(4);
	return undefined;
}

function withoutExactResourceOverrides(entries: unknown[], relativePath: string): unknown[] {
	return entries.filter((entry) => entry !== `+${relativePath}` && entry !== `-${relativePath}`);
}

export async function setDirectResourceEnabled(
	paths: ConstructPaths,
	resource: DirectResourceSummary,
	enabled: boolean,
	options: { backupPath?: string } = {},
): Promise<{ updated: boolean; backupPath?: string; reason?: string }> {
	const relativePath = directResourceSettingsPath(resource);
	if (!relativePath) return { updated: false, reason: `No safe project-relative settings path for ${resource.displayPath}.` };
	const settingsRead = await readJson(paths.projectSettingsPath);
	const settings = readSettingsObject(settingsRead);
	const key = directResourceSettingsKeys[resource.kind];
	const current = Array.isArray(settings[key]) ? settings[key] : [];
	const next = withoutExactResourceOverrides(current, relativePath);
	next.push(`${enabled ? "+" : "-"}${relativePath}`);
	settings[key] = next;
	const backupPath = options.backupPath ?? await backupProjectSettingsIfPresent(paths);
	await writeJson(paths.projectSettingsPath, settings);
	return { updated: true, backupPath };
}

export async function removeMatchingPackageDeclaration(paths: ConstructPaths, source: string, options: { backupPath?: string } = {}): Promise<{ removed: boolean; backupPath?: string; settingsMissing: boolean }> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "missing") return { removed: false, settingsMissing: true };

	const settings = readSettingsObject(settingsRead);
	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const nextPackages = [];
	let removed = false;
	for (const entry of packages) {
		const rawSource = packageSource(entry);
		if (!rawSource) {
			nextPackages.push(entry);
			continue;
		}
		if (await targetSourceMatches(paths, source, rawSource)) {
			removed = true;
			continue;
		}
		nextPackages.push(entry);
	}
	if (!removed) return { removed: false, settingsMissing: false };

	const backupPath = options.backupPath ?? await backupProjectSettingsIfPresent(paths);
	settings.packages = nextPackages;
	await writeJson(paths.projectSettingsPath, settings);
	return { removed: true, backupPath, settingsMissing: false };
}
