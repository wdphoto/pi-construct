import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ConstructPaths, JsonObject } from "./types.js";

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

export interface ManagedPackageSourceIdentity {
	declaredSource?: string;
	requestedSource?: string;
	installSource?: string;
	displaySource?: string;
	normalizedInstallSource?: string;
	matchSources: Set<string>;
}

export async function managedPackageSourceIdentity(item: JsonObject, paths: ConstructPaths): Promise<ManagedPackageSourceIdentity> {
	const declaredSource = typeof item.source === "string" && item.source.trim() ? item.source.trim() : undefined;
	const requestedSource = typeof item.requestedSource === "string" && item.requestedSource.trim() ? item.requestedSource.trim() : undefined;
	const installSource = requestedSource ?? declaredSource;
	const displaySource = installSource;
	const matchSources = new Set<string>();
	const settingsDir = dirname(paths.projectSettingsPath);

	const declaredNormalizedSource = declaredSource ? await normalizeSourceForLibrary(declaredSource, settingsDir) : undefined;
	const requestedNormalizedSource = requestedSource ? await normalizeSourceForLibrary(requestedSource, paths.cwd) : undefined;
	if (declaredSource) {
		matchSources.add(declaredSource);
		if (declaredNormalizedSource) matchSources.add(declaredNormalizedSource);
	}
	if (requestedSource) {
		matchSources.add(requestedSource);
		if (requestedNormalizedSource) matchSources.add(requestedNormalizedSource);
	}

	return {
		declaredSource,
		requestedSource,
		installSource,
		displaySource,
		normalizedInstallSource: requestedNormalizedSource ?? declaredNormalizedSource ?? installSource,
		matchSources,
	};
}
