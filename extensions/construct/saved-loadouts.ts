import type { CatalogData, CatalogProfile } from "./types.js";
import { deriveId } from "./catalog.js";
import { isObject } from "./json.js";
import { isLocalPathSource } from "./sources.js";

export type ParsedLoadoutSnippet = { name: string; sources: string[] };

export function savedLoadoutId(name: string): string {
	return deriveId(name);
}

export function findSavedLoadout(catalog: CatalogData, query: string): CatalogProfile | undefined {
	return catalog.profiles.find((profile) => profile.id === query || profile.name === query);
}

export function savedLoadoutSources(catalog: CatalogData, profile: CatalogProfile): string[] {
	return profile.sources.length > 0
		? profile.sources
		: profile.items.map((id) => catalog.items.find((item) => item.id === id)?.source).filter((source): source is string => typeof source === "string");
}

export function uniqueSorted(sources: string[]): string[] {
	return [...new Set(sources.filter((source) => source.trim().length > 0))].sort();
}

export function replacementLines(existingSources: string[], nextSources: string[]): string[] {
	const existing = new Set(existingSources);
	const next = new Set(nextSources);
	const added = nextSources.filter((source) => !existing.has(source));
	const removed = existingSources.filter((source) => !next.has(source));
	const unchanged = nextSources.filter((source) => existing.has(source));
	const lines = [`Existing package sources: ${existingSources.length}`, `New package sources:      ${nextSources.length}`, ""];
	function section(title: string, marker: string, sources: string[]): void {
		lines.push(`${title}:`);
		if (sources.length === 0) lines.push("- none");
		else lines.push(...sources.slice(0, 8).map((source) => `${marker} ${source}`));
		if (sources.length > 8) lines.push(`…and ${sources.length - 8} more`);
		lines.push("");
	}
	section("Added", "+", added);
	section("Removed", "-", removed);
	section("Unchanged", " ", unchanged);
	return lines;
}

export function generatedCacheSources(sources: string[]): string[] {
	return sources.filter((source) => source.includes("/.pi/agent/npm/") || source.includes("/.pi/agent/git/"));
}

export function secretLikeSources(sources: string[]): string[] {
	return sources.filter((source) => /\/\/[^/\s:@]+:[^/\s@]+@/.test(source) || /[?&#](?:token|api[_-]?key|password|secret)=/i.test(source));
}

export function loadoutShareSnippetText(input: { name: string; sources: string[]; warnings?: string[] }): string {
	const snippet = {
		kind: "construct-loadout",
		version: 1,
		name: input.name,
		sources: input.sources,
	};
	const lines = ["Construct loadout share snippet", "===============================", "Copy this JSON:", "", JSON.stringify(snippet, null, 2)];
	if (input.warnings && input.warnings.length > 0) lines.push("", "Warnings", "--------", ...input.warnings.map((warning) => `! ${warning}`));
	return lines.join("\n");
}

export function parseLoadoutSnippet(raw: string): { snippet?: ParsedLoadoutSnippet; errors: string[]; warnings: string[] } {
	const text = raw.trim();
	if (!text) return { errors: ["Usage: /construct import <construct-loadout-json>"], warnings: [] };
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return { errors: ["No JSON object found in import text."], warnings: [] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch (error) {
		return { errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
	}
	if (!isObject(parsed)) return { errors: ["Snippet JSON must be an object."], warnings: [] };

	const errors: string[] = [];
	const warnings: string[] = [];
	if (parsed.kind !== "construct-loadout") errors.push('Snippet kind must be "construct-loadout".');
	if (parsed.version !== 1) errors.push("Snippet version must be 1.");
	const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
	if (!name) errors.push("Snippet name must be a non-empty string.");
	const rawSources = Array.isArray(parsed.sources) ? parsed.sources : undefined;
	if (!rawSources) errors.push("Snippet sources must be an array.");
	const sourceStrings = (rawSources ?? []).filter((source): source is string => typeof source === "string" && source.trim().length > 0).map((source) => source.trim());
	const sources = uniqueSorted(sourceStrings);
	if (rawSources && sourceStrings.length !== rawSources.length) errors.push("Snippet sources must be non-empty strings.");
	if (sources.length === 0) errors.push("Snippet must include at least one source.");
	const secretLike = secretLikeSources(sources);
	if (secretLike.length > 0) errors.push("Snippet contains source strings that look like secrets.");
	const generatedCache = generatedCacheSources(sources);
	if (generatedCache.length > 0) errors.push("Snippet contains generated Pi package cache paths.");
	const localPaths = sources.filter(isLocalPathSource);
	if (localPaths.length > 0) warnings.push(`Local path sources may not work on another machine: ${localPaths.join(", ")}`);
	return errors.length > 0 ? { errors, warnings } : { snippet: { name, sources }, errors: [], warnings };
}

export function importPreviewLines(snippet: ParsedLoadoutSnippet, warnings: string[], existingSources?: string[]): string[] {
	const id = savedLoadoutId(snippet.name);
	const lines = [`Name: ${snippet.name}`, `Saved id: ${id}`, `Package sources: ${snippet.sources.length}`, ""];
	if (existingSources) {
		lines.push(...replacementLines(existingSources, snippet.sources));
	} else {
		lines.push("Sources:", ...snippet.sources.slice(0, 12).map((source) => `+ ${source}`));
		if (snippet.sources.length > 12) lines.push(`…and ${snippet.sources.length - 12} more`);
	}
	if (warnings.length > 0) lines.push("", "Warnings", "--------", ...warnings.map((warning) => `! ${warning}`));
	return lines;
}
