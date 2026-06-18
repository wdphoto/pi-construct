import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogItem, ConstructPaths, JsonReadResult, SyncResult } from "./types.js";
import { isObject, readJson, writeJson } from "./json.js";
import { getPaths } from "./paths.js";
import { getPackages } from "./project-settings.js";

export function parseCatalog(catalog: JsonReadResult): { data: CatalogData; warnings: string[] } {
	const warnings: string[] = [];
	if (catalog.state === "missing") return { data: { version: 1, items: [] }, warnings };
	if (catalog.state === "invalid") {
		warnings.push(`Catalog is invalid JSON: ${catalog.error}`);
		return { data: { version: 1, items: [] }, warnings };
	}
	if (!isObject(catalog.data)) {
		warnings.push("Catalog JSON is not an object.");
		return { data: { version: 1, items: [] }, warnings };
	}
	if (catalog.data.version !== 1) warnings.push("Catalog version is missing or not 1; preserving only valid MVP package items.");
	if (!Array.isArray(catalog.data.items)) {
		warnings.push("Catalog items is missing or not an array.");
		return { data: { version: 1, items: [] }, warnings };
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
			id: item.id.trim(),
			name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined,
			kind: "package",
			source: item.source.trim(),
			description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined,
		});
	}
	return { data: { version: 1, items }, warnings };
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

export function isLocalPathSource(source: string): boolean {
	return source.startsWith("./") || source.startsWith("../") || source.startsWith("/") || source.startsWith("~");
}

export async function normalizeSourceForLibrary(source: string, baseDir: string): Promise<string> {
	const trimmed = source.trim();
	if (!isLocalPathSource(trimmed)) return trimmed;
	const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
	const absolute = expanded.startsWith("/") ? expanded : resolve(baseDir, expanded);
	return realpath(absolute).catch(() => absolute);
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

export async function syncSourcesToCatalog(
	ctx: Pick<ExtensionCommandContext, "cwd">,
	sources: string[],
): Promise<SyncResult> {
	const paths = await getPaths(ctx);
	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		return { added: [], alreadyKnown: 0, warnings: [`Skipped Construct library sync because catalog JSON is invalid: ${catalogRead.error}`] };
	}

	const { data: catalog, warnings } = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && warnings.length > 0) {
		return { added: [], alreadyKnown: 0, warnings: [`Skipped Construct library sync because catalog has warnings; fix ${paths.userCatalogPath} first.`, ...warnings] };
	}

	const existingSources = new Set(catalog.items.map((item) => item.source));
	const nextItems = [...catalog.items];
	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	for (const source of sources) {
		if (!source) continue;
		if (existingSources.has(source)) {
			alreadyKnown += 1;
			continue;
		}
		const item: CatalogItem = { id: uniqueId(deriveId(source), nextItems), kind: "package", source };
		nextItems.push(item);
		added.push(item);
		existingSources.add(source);
	}

	if (added.length > 0) {
		await writeJson(paths.userCatalogPath, { version: 1, items: nextItems.sort((a, b) => a.id.localeCompare(b.id)) });
	}
	return { added, alreadyKnown, warnings };
}

export async function syncProjectPackagesToCatalog(ctx: Pick<ExtensionCommandContext, "cwd">): Promise<SyncResult> {
	const paths = await getPaths(ctx);
	return syncSourcesToCatalog(ctx, await packageSourcesFromSettings(paths.projectSettingsPath));
}

