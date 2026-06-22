import { dirname } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, JsonReadResult, KnownProjectEntry, KnownProjectsData } from "./types.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "./json.js";
import { getPaths } from "./paths.js";
import { getPackages } from "./project-settings.js";
import { normalizeSourceForLibrary } from "./sources.js";

export function parseKnownProjects(read: JsonReadResult): { data: KnownProjectsData; warnings: string[] } {
	const warnings: string[] = [];
	if (read.state === "missing") return { data: { version: 1, projects: [] }, warnings };
	if (read.state === "invalid") {
		warnings.push(describeJsonReadIssue("Known-project index", read));
		return { data: { version: 1, projects: [] }, warnings };
	}
	if (!isObject(read.data)) {
		warnings.push("Known-project index JSON is not an object.");
		return { data: { version: 1, projects: [] }, warnings };
	}
	if (read.data.version !== 1) warnings.push("Known-project index version is missing or not 1; preserving only valid project entries.");
	if (!Array.isArray(read.data.projects)) {
		warnings.push("Known-project index projects is missing or not an array.");
		return { data: { version: 1, projects: [] }, warnings };
	}

	const projects: KnownProjectEntry[] = [];
	for (const [index, project] of read.data.projects.entries()) {
		if (!isObject(project)) {
			warnings.push(`Known-project entry ${index} is not an object; ignored.`);
			continue;
		}
		if (typeof project.path !== "string" || !project.path.trim()) {
			warnings.push(`Known-project entry ${index} has no path; ignored.`);
			continue;
		}
		const packages = Array.isArray(project.packages)
			? project.packages.filter((source): source is string => typeof source === "string" && source.trim().length > 0).map((source) => source.trim())
			: [];
		projects.push({
			path: project.path.trim(),
			realPath: typeof project.realPath === "string" && project.realPath.trim() ? project.realPath.trim() : undefined,
			packages,
			updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : undefined,
		});
	}

	return { data: { version: 1, projects }, warnings };
}

export async function readKnownProjects(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<{ paths: ConstructPaths; read: JsonReadResult; data: KnownProjectsData; warnings: string[] }> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userProjectsPath);
	const { data, warnings } = parseKnownProjects(read);
	return { paths, read, data, warnings };
}

async function projectPackageSources(paths: ConstructPaths): Promise<string[]> {
	const settings = await readJson(paths.projectSettingsPath);
	const settingsDir = dirname(paths.projectSettingsPath);
	const sources: string[] = [];
	for (const pkg of getPackages(settings)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		sources.push(await normalizeSourceForLibrary(pkg.source, settingsDir));
	}
	return [...new Set(sources)].sort((a, b) => a.localeCompare(b));
}

export async function rememberKnownProject(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<{ updated: boolean; warning?: string }> {
	const paths = await getPaths(ctx);
	try {
		const read = await readJson(paths.userProjectsPath);
		if (read.state === "invalid") return { updated: false, warning: `Could not update known-project index because ${describeJsonReadIssue("known-project index", read)}` };
		const { data, warnings } = parseKnownProjects(read);
		if (read.state === "ok" && warnings.length > 0) return { updated: false, warning: `Could not update known-project index because it has structural warnings: ${warnings.join("; ")}` };
		const packages = await projectPackageSources(paths);
		const now = new Date().toISOString();
		const project: KnownProjectEntry = { path: paths.cwd, realPath: paths.realCwd, packages, updatedAt: now };
		const key = paths.realCwd || paths.cwd;
		const nextProjects = data.projects.filter((entry) => (entry.realPath || entry.path) !== key && entry.path !== paths.cwd);
		nextProjects.push(project);
		nextProjects.sort((a, b) => (a.realPath ?? a.path).localeCompare(b.realPath ?? b.path));
		await writeJson(paths.userProjectsPath, { version: 1, projects: nextProjects });
		return { updated: true };
	} catch (error) {
		return { updated: false, warning: `Could not update known-project index: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function knownProjectCounts(data: KnownProjectsData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const project of data.projects) {
		const sources = new Set(project.packages);
		for (const source of sources) counts.set(source, (counts.get(source) ?? 0) + 1);
	}
	return counts;
}

export function knownProjectCountForSources(counts: Map<string, number>, sources: Iterable<string>): number {
	let count = 0;
	for (const source of sources) count = Math.max(count, counts.get(source) ?? 0);
	return count;
}
