import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ConstructPaths, JsonObject } from "../types.js";

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

function parseNpmPackageName(source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined;
	const spec = source.slice("npm:".length).trim();
	if (!spec) return undefined;
	if (spec.startsWith("@")) {
		const slash = spec.indexOf("/");
		if (slash < 0) return spec;
		const versionAt = spec.indexOf("@", slash + 1);
		return versionAt > 0 ? spec.slice(0, versionAt) : spec;
	}
	const versionAt = spec.indexOf("@");
	return versionAt > 0 ? spec.slice(0, versionAt) : spec;
}

function trimGitPath(path: string): string {
	let next = path.replace(/^\/+/, "").split(/[?#]/, 1)[0] ?? "";
	const refAt = next.lastIndexOf("@");
	if (refAt > next.lastIndexOf("/")) next = next.slice(0, refAt);
	next = next.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
	return next;
}

function parseGitIdentity(source: string): { host: string; path: string } | undefined {
	const trimmed = source.trim();
	const hasGitPrefix = trimmed.startsWith("git:");
	let value = hasGitPrefix ? trimmed.slice("git:".length).trim() : trimmed;
	if (!value) return undefined;

	const scpLike = value.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/);
	if (scpLike) {
		const host = scpLike[1]?.toLowerCase();
		const path = trimGitPath(scpLike[2] ?? "");
		return host && path.split("/").length >= 2 ? { host, path } : undefined;
	}

	if (/^(https?|ssh|git):\/\//i.test(value)) {
		try {
			const parsed = new URL(value);
			const host = parsed.hostname.toLowerCase();
			const path = trimGitPath(parsed.pathname);
			return host && path.split("/").length >= 2 ? { host, path } : undefined;
		} catch {
			return undefined;
		}
	}

	if (!hasGitPrefix) return undefined;
	if (value.startsWith("github:")) value = `github.com/${value.slice("github:".length)}`;
	const hostPath = value.match(/^([^/:]+(?:\.[^/:]+)*|localhost)[:/](.+)$/);
	if (!hostPath) return undefined;
	const host = hostPath[1]?.toLowerCase();
	const path = trimGitPath(hostPath[2] ?? "");
	return host && path.split("/").length >= 2 ? { host, path } : undefined;
}

export function packageSourceIdentityKey(source: string, normalizedLocalSource?: string): string | undefined {
	const trimmed = source.trim();
	if (!trimmed) return undefined;
	const npmName = parseNpmPackageName(trimmed);
	if (npmName) return `npm:${npmName}`;
	const git = parseGitIdentity(trimmed);
	if (git) return `git:${git.host}/${git.path}`;
	if (isLocalPathSource(trimmed)) return `local:${(normalizedLocalSource ?? trimmed).replace(/\/+$/, "")}`;
	return undefined;
}

export async function packageSourceMatchValues(source: string, baseDir: string): Promise<string[]> {
	const trimmed = source.trim();
	if (!trimmed) return [];
	const values = new Set<string>([trimmed]);
	const normalized = await normalizeSourceForLibrary(trimmed, baseDir);
	values.add(normalized);
	const key = packageSourceIdentityKey(trimmed, normalized);
	if (key) values.add(key);
	return [...values];
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
	const declaredIdentityKey = declared ? packageSourceIdentityKey(declared, declaredNormalizedSource) : undefined;
	const requestedIdentityKey = requested ? packageSourceIdentityKey(requested, requestedNormalizedSource) : undefined;
	if (declared) {
		matchSources.add(declared);
		if (declaredNormalizedSource) matchSources.add(declaredNormalizedSource);
		if (declaredIdentityKey) matchSources.add(declaredIdentityKey);
	}
	if (requested) {
		matchSources.add(requested);
		if (requestedNormalizedSource) matchSources.add(requestedNormalizedSource);
		if (requestedIdentityKey) matchSources.add(requestedIdentityKey);
	}

	return {
		declaredSource: declared,
		requestedSource: requested,
		installSource,
		displaySource,
		normalizedInstallSource: requestedIdentityKey ?? declaredIdentityKey ?? requestedNormalizedSource ?? declaredNormalizedSource ?? installSource,
		matchSources,
	};
}

export async function managedPackageSourceIdentity(item: JsonObject, paths: ConstructPaths): Promise<ManagedPackageSourceIdentity> {
	const declaredSource = typeof item.source === "string" ? item.source : undefined;
	const requestedSource = typeof item.requestedSource === "string" ? item.requestedSource : undefined;
	return packageSourceIdentity(declaredSource, requestedSource, paths);
}
