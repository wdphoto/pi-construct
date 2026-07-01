import { basename, dirname, extname, isAbsolute, relative, sep } from "node:path";
import type { PathMetadata, ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, DirectResourceKind, DirectResourceSummary, JsonReadResult } from "./types.js";
import { isObject } from "./json.js";
import { resolveProjectPackageResources, type ResolvedPackageResources } from "./pi-adapter/package-manager.js";

const resolvedResourceKeys = {
	extension: "extensions",
	skill: "skills",
	prompt: "prompts",
	theme: "themes",
} as const;

export const directResourceKinds: DirectResourceKind[] = ["extension", "skill", "prompt", "theme"];

export function resourcePlural(kind: DirectResourceKind): (typeof resolvedResourceKeys)[DirectResourceKind] {
	return resolvedResourceKeys[kind];
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function relativeIfInside(base: string, path: string): string | undefined {
	const rel = relative(base, path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return toPosixPath(rel);
}

function displayPath(paths: ConstructPaths, resourcePath: string): string {
	const projectRelative = relativeIfInside(paths.cwd, resourcePath);
	if (projectRelative) return projectRelative;
	return toPosixPath(resourcePath);
}

function settingsRelativePath(metadata: PathMetadata, resourcePath: string): string | undefined {
	if (!metadata.baseDir) return undefined;
	return relativeIfInside(metadata.baseDir, resourcePath);
}

function stripKnownExtension(name: string): string {
	const ext = extname(name);
	return ext ? name.slice(0, -ext.length) : name;
}

export function directResourceName(kind: DirectResourceKind, path: string): string {
	const fileName = basename(path);
	if (kind === "skill" && fileName === "SKILL.md") return basename(dirname(path));
	if (kind === "extension" && (fileName === "index.ts" || fileName === "index.js")) return basename(dirname(path));
	return stripKnownExtension(fileName);
}

export function directResourceKey(kind: DirectResourceKind, path: string): string {
	return `${kind}:${toPosixPath(path)}`;
}

function managedDirectResourceKeys(construct: JsonReadResult, paths: ConstructPaths): Map<string, string> {
	const keys = new Map<string, string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return keys;
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value)) continue;
		if (!directResourceKinds.includes(value.kind as DirectResourceKind)) continue;
		if (typeof value.path !== "string" || !value.path.trim()) continue;
		const rawPath = value.path.trim();
		keys.set(directResourceKey(value.kind as DirectResourceKind, rawPath), id);
		if (!isAbsolute(rawPath)) keys.set(directResourceKey(value.kind as DirectResourceKind, `${paths.cwd}/${rawPath}`), id);
	}
	return keys;
}

function directResourceFromResolved(kind: DirectResourceKind, resolved: ResolvedResource, paths: ConstructPaths, managedKeys: Map<string, string>): DirectResourceSummary | undefined {
	if (resolved.metadata.origin !== "top-level" || resolved.metadata.scope !== "project") return undefined;
	const path = toPosixPath(resolved.path);
	const key = directResourceKey(kind, path);
	const managedId = managedKeys.get(key) ?? managedKeys.get(directResourceKey(kind, resolved.path));
	return {
		id: key,
		kind,
		name: directResourceName(kind, path),
		path,
		displayPath: displayPath(paths, resolved.path),
		settingsPath: settingsRelativePath(resolved.metadata, resolved.path),
		baseDir: resolved.metadata.baseDir ? toPosixPath(resolved.metadata.baseDir) : undefined,
		scope: resolved.metadata.scope,
		origin: resolved.metadata.origin,
		source: resolved.metadata.source,
		enabled: resolved.enabled,
		managed: managedId !== undefined,
		managedId,
	};
}

export async function collectDirectProjectResources(
	ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">,
	paths: ConstructPaths,
	construct: JsonReadResult,
): Promise<{ resources: DirectResourceSummary[]; warnings: string[] }> {
	const warnings: string[] = [];
	const managedKeys = managedDirectResourceKeys(construct, paths);
	let resolved: ResolvedPackageResources;
	try {
		const result = await resolveProjectPackageResources(paths, ctx.isProjectTrusted());
		resolved = result.resolved;
		warnings.push(...result.settingsErrors.map((error) => `Pi settings were not fully loaded for resource inventory: ${error}`));
	} catch (error) {
		return { resources: [], warnings: [`Could not inspect direct project resources: ${error instanceof Error ? error.message : String(error)}`] };
	}

	const resources: DirectResourceSummary[] = [];
	for (const kind of directResourceKinds) {
		for (const entry of resolved[resolvedResourceKeys[kind]]) {
			const resource = directResourceFromResolved(kind, entry, paths, managedKeys);
			if (resource) resources.push(resource);
		}
	}
	resources.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.displayPath.localeCompare(b.displayPath));
	return { resources, warnings };
}
