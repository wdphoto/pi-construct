import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import type { ConstructPaths, JsonObject, JsonReadResult, ManagedItemSummary, PackageDeclarationSummary } from "./types.js";
import { isObject, readJson, writeJson } from "./json.js";

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

export function getPackages(settings: JsonReadResult): PackageDeclarationSummary[] {
	if (settings.state !== "ok" || !isObject(settings.data)) return [];
	const packages = settings.data.packages;
	if (!Array.isArray(packages)) return [];

	return packages.map((entry): PackageDeclarationSummary => {
		if (typeof entry === "string") {
			return { source: entry, form: "string", enabled: true };
		}
		if (isObject(entry) && typeof entry.source === "string") {
			return { source: entry.source, form: "object", enabled: true };
		}
		return { source: "<invalid package declaration>", form: "invalid", enabled: false };
	});
}

export function getManagedItems(construct: JsonReadResult, packageSources: Set<string>): ManagedItemSummary[] {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	return Object.entries(construct.data.items).map(([id, value]) => {
		if (!isObject(value)) {
			return { id, kind: "unknown", drift: "invalid metadata" };
		}
		const kind = typeof value.kind === "string" ? value.kind : "unknown";
		const source = typeof value.source === "string" ? value.source : undefined;
		const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
		let drift: string | undefined;
		if (source) {
			const declared = packageSources.has(source);
			if (enabled === true && !declared) drift = "enabled in Construct metadata, missing from .pi/settings.json";
			if (enabled === false && declared) drift = "disabled in Construct metadata, still present in .pi/settings.json";
		}
		return { id, kind, source, enabled, drift };
	});
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
		throw new Error(`Cannot update invalid Construct metadata: ${construct.error}`);
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
): JsonObject {
	const existingItems = isObject(construct.items) ? construct.items : {};
	const now = new Date().toISOString();
	const existingItem = isObject(existingItems[itemId]) ? existingItems[itemId] : {};
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
				enabled: true,
				loadedAt: typeof existingItem.loadedAt === "string" ? existingItem.loadedAt : now,
				updatedAt: now,
			},
		},
	};
}

export function uniqueManagedId(baseId: string, construct: JsonReadResult, source: string): string {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return baseId;
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (isObject(value) && (value.source === source || value.requestedSource === source)) return id;
	}
	const existing = new Set(Object.keys(construct.data.items));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
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
	if (settings.state === "invalid") throw new Error(`Cannot edit invalid .pi/settings.json: ${settings.error}`);
	if (!isObject(settings.data)) throw new Error("Cannot edit .pi/settings.json because it is not a JSON object.");
	return { ...settings.data };
}

export async function removePackageDeclaration(paths: ConstructPaths, source: string): Promise<{ removed: boolean; backupPath?: string; settingsMissing: boolean }> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "missing") return { removed: false, settingsMissing: true };

	const settings = readSettingsObject(settingsRead);
	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const nextPackages = packages.filter((entry) => packageSource(entry) !== source);
	const removed = nextPackages.length !== packages.length;
	if (!removed) return { removed: false, settingsMissing: false };

	const backupPath = await backupProjectSettingsIfPresent(paths);
	settings.packages = nextPackages;
	await writeJson(paths.projectSettingsPath, settings);
	return { removed: true, backupPath, settingsMissing: false };
}
