import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ConstructPaths, JsonObject } from "./types.js";

export function isLocalPathSource(source: string): boolean {
	return source.startsWith("./") || source.startsWith("../") || source.startsWith("/") || source.startsWith("~");
}

export function formatPackageSourceLabel(source: string): string {
	const trimmed = source.trim().replace(/\/+$/, "");
	const githubUrl = trimmed.match(/^https?:\/\/github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (githubUrl) return `github:${githubUrl[1]}`;
	const gitGithub = trimmed.match(/^git:(?:github\.com[:/])?([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (gitGithub) return `github:${gitGithub[1]}`;
	const sshGithub = trimmed.match(/^git@github\.com:([^/?#]+\/[^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
	if (sshGithub) return `github:${sshGithub[1]}`;
	if (isLocalPathSource(trimmed)) return `local:${basename(trimmed) || trimmed}`;
	return source;
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

export async function packageSourceIdentity(declaredSource: string | undefined, requestedSource: string | undefined, paths: ConstructPaths): Promise<ManagedPackageSourceIdentity> {
	const declared = declaredSource?.trim() || undefined;
	const requested = requestedSource?.trim() || undefined;
	const installSource = requested ?? declared;
	const displaySource = installSource;
	const matchSources = new Set<string>();
	const settingsDir = dirname(paths.projectSettingsPath);

	const declaredNormalizedSource = declared ? await normalizeSourceForLibrary(declared, settingsDir) : undefined;
	const requestedNormalizedSource = requested ? await normalizeSourceForLibrary(requested, paths.cwd) : undefined;
	if (declared) {
		matchSources.add(declared);
		if (declaredNormalizedSource) matchSources.add(declaredNormalizedSource);
	}
	if (requested) {
		matchSources.add(requested);
		if (requestedNormalizedSource) matchSources.add(requestedNormalizedSource);
	}

	return {
		declaredSource: declared,
		requestedSource: requested,
		installSource,
		displaySource,
		normalizedInstallSource: requestedNormalizedSource ?? declaredNormalizedSource ?? installSource,
		matchSources,
	};
}

export async function managedPackageSourceIdentity(item: JsonObject, paths: ConstructPaths): Promise<ManagedPackageSourceIdentity> {
	const declaredSource = typeof item.source === "string" ? item.source : undefined;
	const requestedSource = typeof item.requestedSource === "string" ? item.requestedSource : undefined;
	return packageSourceIdentity(declaredSource, requestedSource, paths);
}
