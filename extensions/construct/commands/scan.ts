import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, ProjectTrustStore, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { deriveId, parseCatalog } from "../catalog.js";
import { loadProjectResourcesIntoConstruct } from "./load.js";
import { describeJsonReadIssue, isObject, readJson } from "../json.js";
import { collectPackageSourceSets, getManagedItems, getPackages } from "../project-settings.js";
import { directResourceKey, directResourceKinds, directResourceName } from "../resources.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary } from "../sources.js";
import type { ConstructPaths, DirectResourceKind, JsonReadResult, PackageDeclarationSummary } from "../types.js";
import { pickCheckboxes, setConstructStatus, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

const ignoredDirectoryNames = new Set(["node_modules", ".git", "dist", "build"]);
const ignoredPiDirectoryNames = new Set(["npm", "git"]);
const extensionExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);

interface ScanPackageFinding {
	source: string;
	disabledByFilters?: boolean;
	missing: string[];
}

interface ScanResourceFinding {
	kind: DirectResourceKind;
	name: string;
	path: string;
	relativePath: string;
}

interface ScanProject {
	path: string;
	realPath: string;
	settings: JsonReadResult;
	construct: JsonReadResult;
	packages: PackageDeclarationSummary[];
	unloadedPackages: ScanPackageFinding[];
	unloadedResources: ScanResourceFinding[];
	warnings: string[];
}

interface SkippedProject {
	path: string;
	reason: string;
}

interface ScanDisplayContext {
	heading: string;
	basePath?: string;
}

interface ScanResult {
	display: ScanDisplayContext;
	projects: ScanProject[];
	skippedProjects: SkippedProject[];
	warnings: string[];
}

type ScanProgress = (message: string) => void;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function expandUserPath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function resolveScanRoot(rawArgs: string, cwd: string): string | undefined {
	const arg = rawArgs.trim();
	if (!arg) return undefined;
	const expanded = expandUserPath(arg);
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function projectPaths(projectDir: string): ConstructPaths {
	const agentDir = getAgentDir();
	const constructDir = join(agentDir, "construct");
	return {
		cwd: projectDir,
		realCwd: projectDir,
		constructDir,
		userCatalogPath: join(constructDir, "catalog.json"),
		userSettingsPath: join(constructDir, "settings.json"),
		userProjectsPath: join(constructDir, "projects.json"),
		projectSettingsPath: join(projectDir, CONFIG_DIR_NAME, "settings.json"),
		projectConstructPath: join(projectDir, CONFIG_DIR_NAME, "construct.json"),
	};
}

function isResourceDirectoryName(name: string): boolean {
	return name === "extensions" || name === "skills" || name === "prompts" || name === "themes";
}

async function hasProjectMarker(dir: string): Promise<boolean> {
	const piDir = join(dir, CONFIG_DIR_NAME);
	if (!existsSync(piDir)) return false;
	if (existsSync(join(piDir, "settings.json")) || existsSync(join(piDir, "construct.json"))) return true;
	try {
		const entries = await readdir(piDir, { withFileTypes: true });
		return entries.some((entry) => entry.isDirectory() && isResourceDirectoryName(entry.name));
	} catch {
		return false;
	}
}

function shouldSkipDirectory(parent: string, name: string): boolean {
	if (ignoredDirectoryNames.has(name)) return true;
	if (basename(parent) === CONFIG_DIR_NAME && ignoredPiDirectoryNames.has(name)) return true;
	if (name === CONFIG_DIR_NAME) return true;
	return false;
}

async function findProjects(root: string, warnings: string[], progress?: ScanProgress): Promise<string[]> {
	const projects: string[] = [];
	async function visit(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			warnings.push(`Could not read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (await hasProjectMarker(dir)) {
			projects.push(dir);
			progress?.(`Construct: searching ${root} · ${projects.length} project${projects.length === 1 ? "" : "s"} found`);
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (shouldSkipDirectory(dir, entry.name)) continue;
			await visit(join(dir, entry.name));
		}
	}
	await visit(root);
	return projects.sort((a, b) => a.localeCompare(b));
}

function resourceCandidateKeys(kind: DirectResourceKind, projectDir: string, path: string): Set<string> {
	const keys = new Set<string>();
	const add = (candidate: string) => keys.add(directResourceKey(kind, candidate));
	const relativePath = toPosixPath(relative(projectDir, path));
	add(path);
	add(resolve(path));
	add(relativePath);
	add(join(projectDir, relativePath));
	if (relativePath.startsWith(`${CONFIG_DIR_NAME}/`)) {
		const withoutConfig = relativePath.slice(CONFIG_DIR_NAME.length + 1);
		add(withoutConfig);
		add(join(projectDir, withoutConfig));
		add(join(projectDir, CONFIG_DIR_NAME, withoutConfig));
	}
	return keys;
}

function addIfFile(resources: ScanResourceFinding[], projectDir: string, path: string, kind: DirectResourceKind, managedKeys: Set<string>, seenKeys: Set<string>): void {
	const candidateKeys = resourceCandidateKeys(kind, projectDir, path);
	for (const key of candidateKeys) {
		if (managedKeys.has(key)) return;
		if (seenKeys.has(key)) return;
	}
	for (const key of candidateKeys) seenKeys.add(key);
	const name = directResourceName(kind, path);
	resources.push({ kind, name, path, relativePath: toPosixPath(relative(projectDir, path)) });
}

function formatPackageFinding(pkg: ScanPackageFinding): string {
	return `${pkg.source}${pkg.disabledByFilters ? " (disabled)" : ""} — ${pkg.missing.join(", ")}`;
}

function formatResourceFinding(resource: ScanResourceFinding): string {
	return `${resource.kind} ${resource.name} — ${resource.relativePath}`;
}

async function directChildren(dir: string): Promise<import("node:fs").Dirent[]> {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function walkFiles(dir: string, shouldInclude: (path: string) => boolean, skipDir: (name: string) => boolean = () => false): Promise<string[]> {
	const files: string[] = [];
	async function visit(current: string): Promise<void> {
		for (const entry of await directChildren(current)) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				if (!skipDir(entry.name)) await visit(path);
				continue;
			}
			if (entry.isFile() && shouldInclude(path)) files.push(path);
		}
	}
	await visit(dir);
	return files.sort((a, b) => a.localeCompare(b));
}

async function collectProjectResourceFiles(projectDir: string): Promise<Array<{ kind: DirectResourceKind; path: string }>> {
	const piDir = join(projectDir, CONFIG_DIR_NAME);
	const resources: Array<{ kind: DirectResourceKind; path: string }> = [];

	const extensionsDir = join(piDir, "extensions");
	for (const entry of await directChildren(extensionsDir)) {
		const path = join(extensionsDir, entry.name);
		if (entry.isFile() && extensionExtensions.has(extname(entry.name))) resources.push({ kind: "extension", path });
		if (entry.isDirectory()) {
			for (const indexName of ["index.ts", "index.js", "index.mjs", "index.cjs"]) {
				const indexPath = join(path, indexName);
				if (existsSync(indexPath)) resources.push({ kind: "extension", path: indexPath });
			}
		}
	}

	const skillsDir = join(piDir, "skills");
	for (const entry of await directChildren(skillsDir)) {
		const path = join(skillsDir, entry.name);
		if (entry.isFile() && extname(entry.name) === ".md") resources.push({ kind: "skill", path });
	}
	for (const path of await walkFiles(skillsDir, (path) => basename(path) === "SKILL.md", (name) => ignoredDirectoryNames.has(name))) resources.push({ kind: "skill", path });

	const promptsDir = join(piDir, "prompts");
	for (const entry of await directChildren(promptsDir)) {
		const path = join(promptsDir, entry.name);
		if (entry.isFile() && extname(entry.name) === ".md") resources.push({ kind: "prompt", path });
	}

	const themesDir = join(piDir, "themes");
	for (const entry of await directChildren(themesDir)) {
		const path = join(themesDir, entry.name);
		if (entry.isFile() && extname(entry.name) === ".json") resources.push({ kind: "theme", path });
	}

	return resources.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
}

async function managedPackageSources(construct: JsonReadResult, paths: ConstructPaths): Promise<Set<string>> {
	const sources = new Set<string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return sources;
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		for (const source of identity.matchSources) sources.add(source);
		if (identity.normalizedInstallSource) sources.add(identity.normalizedInstallSource);
	}
	return sources;
}

function managedDirectResourceKeys(construct: JsonReadResult, projectDir: string): Set<string> {
	const keys = new Set<string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return keys;
	const add = (kind: DirectResourceKind, path: string) => keys.add(directResourceKey(kind, path));
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value)) continue;
		if (!directResourceKinds.includes(value.kind as DirectResourceKind)) continue;
		if (typeof value.path !== "string" || !value.path.trim()) continue;
		const kind = value.kind as DirectResourceKind;
		const rawPath = value.path.trim();
		add(kind, rawPath);
		if (isAbsolute(rawPath)) {
			add(kind, resolve(rawPath));
			continue;
		}
		add(kind, join(projectDir, rawPath));
		if (rawPath.startsWith(`${CONFIG_DIR_NAME}/`)) {
			const withoutConfig = rawPath.slice(CONFIG_DIR_NAME.length + 1);
			add(kind, withoutConfig);
			add(kind, join(projectDir, withoutConfig));
			add(kind, join(projectDir, CONFIG_DIR_NAME, withoutConfig));
		} else {
			add(kind, join(projectDir, CONFIG_DIR_NAME, rawPath));
		}
	}
	return keys;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
	for (const value of a) {
		if (b.has(value)) return true;
	}
	return false;
}

async function packageIdentitySources(pkg: PackageDeclarationSummary, settingsDir: string): Promise<Set<string>> {
	const sources = new Set<string>([pkg.source]);
	sources.add(await normalizeSourceForLibrary(pkg.source, settingsDir));
	return sources;
}

async function scanProject(projectDir: string, catalogSources: Set<string>, progress?: ScanProgress, scanLabel?: string): Promise<ScanProject> {
	const paths = projectPaths(projectDir);
	paths.realCwd = await realpath(projectDir).catch(() => projectDir);
	const [settings, construct] = await Promise.all([readJson(paths.projectSettingsPath), readJson(paths.projectConstructPath)]);
	const packages = getPackages(settings);
	const settingsDir = dirname(paths.projectSettingsPath);
	const managedSources = await managedPackageSources(construct, paths);
	const packageSourceSets = await collectPackageSourceSets(packages, settingsDir);
	const managedSummaries = await getManagedItems(construct, packageSourceSets.declaredSources, paths, packageSourceSets.disabledSources);
	const managedDirectKeys = managedDirectResourceKeys(construct, projectDir);
	const warnings: string[] = [];
	if (settings.state === "invalid") warnings.push(describeJsonReadIssue(`${toPosixPath(relative(projectDir, paths.projectSettingsPath))}`, settings));
	if (construct.state === "invalid") warnings.push(describeJsonReadIssue(`${toPosixPath(relative(projectDir, paths.projectConstructPath))}`, construct));
	warnings.push(...managedSummaries.filter((item) => item.drift).map((item) => `${item.id} drift: ${item.drift}`));

	const unloadedPackages: ScanPackageFinding[] = [];
	const seenPackageKeys = new Set<string>();
	for (const pkg of packages) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) {
			if (pkg.form === "invalid") warnings.push("Invalid package declaration ignored.");
			continue;
		}
		const identitySources = await packageIdentitySources(pkg, settingsDir);
		const identityKey = [...identitySources].sort()[0] ?? pkg.source;
		if (seenPackageKeys.has(identityKey)) continue;
		seenPackageKeys.add(identityKey);
		const missing: string[] = [];
		if (!overlaps(identitySources, managedSources)) missing.push("missing from project metadata");
		if (missing.length === 0) continue;
		if (!overlaps(identitySources, catalogSources)) missing.unshift("missing from library");
		unloadedPackages.push({ source: pkg.source, disabledByFilters: pkg.disabledByFilters, missing });
	}

	const unloadedResources: ScanResourceFinding[] = [];
	const seenResourceKeys = new Set<string>();
	const resourceFiles = await collectProjectResourceFiles(projectDir);
	progress?.(`${scanLabel ?? `Construct: scanning ${basename(projectDir)}`} · ${resourceFiles.length} local resource file${resourceFiles.length === 1 ? "" : "s"} found`);
	for (const resource of resourceFiles) addIfFile(unloadedResources, projectDir, resource.path, resource.kind, managedDirectKeys, seenResourceKeys);

	return {
		path: projectDir,
		realPath: paths.realCwd,
		settings,
		construct,
		packages,
		unloadedPackages,
		unloadedResources,
		warnings,
	};
}

function projectHasUnloaded(project: ScanProject): boolean {
	return project.unloadedPackages.length > 0 || project.unloadedResources.length > 0;
}

function formatProjectPath(display: ScanDisplayContext, project: Pick<ScanProject, "path">): string {
	if (!display.basePath) return toPosixPath(project.path);
	const rel = relative(display.basePath, project.path);
	return rel && !rel.startsWith("..") && !isAbsolute(rel) ? toPosixPath(rel) : toPosixPath(project.path);
}

function formatScan(display: ScanDisplayContext, projects: ScanProject[], skippedProjects: SkippedProject[], warnings: string[]): string {
	const projectsWithUnloaded = projects.filter(projectHasUnloaded);
	const unloadedPackageCount = projects.reduce((sum, project) => sum + project.unloadedPackages.length, 0);
	const unloadedResourceCount = projects.reduce((sum, project) => sum + project.unloadedResources.length, 0);
	const lines = [
		"Construct scan",
		"==============",
		display.heading,
		`Trusted projects scanned: ${projects.length}`,
		`Skipped untrusted projects: ${skippedProjects.length}`,
		`Projects with unloaded resources: ${projectsWithUnloaded.length}`,
		`Unloaded package declarations: ${unloadedPackageCount}`,
		`Unloaded direct resources: ${unloadedResourceCount}`,
		"Scope: trusted project-local .pi resources only; user/global skill and package caches are not scanned.",
	];

	if (projectsWithUnloaded.length === 0) lines.push("", "No unloaded resources found.");
	else {
		lines.push("", "Unloaded resources", "------------------");
		for (const project of projectsWithUnloaded) {
			lines.push(formatProjectPath(display, project));
			for (const pkg of project.unloadedPackages) lines.push(`- package ${formatPackageFinding(pkg)}`);
			for (const resource of project.unloadedResources) lines.push(`- ${formatResourceFinding(resource)}`);
			lines.push("");
		}
		while (lines.at(-1) === "") lines.pop();
	}

	if (skippedProjects.length > 0) {
		lines.push("", "Skipped projects", "----------------");
		for (const project of skippedProjects) lines.push(`- ${formatProjectPath(display, project)}: ${project.reason}`);
	}

	const allWarnings = [
		...warnings,
		...projects.flatMap((project) => project.warnings.map((warning) => `${formatProjectPath(display, project)}: ${warning}`)),
	];
	if (allWarnings.length > 0) lines.push("", "Warnings", "--------", ...allWarnings.map((warning) => `! ${warning}`));
	lines.push("", "No files were changed.");
	return lines.join("\n");
}

function isBroadOrPrivateRoot(root: string): string | undefined {
	const resolved = resolve(root);
	const home = resolve(homedir());
	const privateRoots = [join(home, ".pi"), join(home, ".agents"), join(home, ".claude"), join(home, ".codex")].map((path) => resolve(path));
	if (resolved === dirname(resolved)) return "filesystem root is too broad";
	if (resolved === home) return "home directory is too broad";
	for (const privateRoot of privateRoots) {
		if (resolved === privateRoot || resolved.startsWith(`${privateRoot}${sep}`)) return `${privateRoot} is a private/global agent directory`;
	}
	return undefined;
}

function uniquePaths(paths: string[]): string[] {
	return [...new Set(paths.map((path) => resolve(path)))].sort((a, b) => a.localeCompare(b));
}

async function uniqueRealPaths(paths: string[]): Promise<string[]> {
	const byRealPath = new Map<string, string>();
	for (const path of paths) {
		const resolved = resolve(path);
		const real = await realpath(resolved).catch(() => resolved);
		if (!byRealPath.has(real)) byRealPath.set(real, resolved);
	}
	return [...byRealPath.values()].sort((a, b) => a.localeCompare(b));
}

async function trustedRootsFromTrustStore(warnings: string[]): Promise<{ roots: string[]; skipped: SkippedProject[] }> {
	const trustPath = join(getAgentDir(), "trust.json");
	const read = await readJson(trustPath);
	if (read.state === "missing") return { roots: [], skipped: [] };
	if (read.state === "invalid") {
		warnings.push(describeJsonReadIssue("Pi trust store", read));
		return { roots: [], skipped: [] };
	}
	if (!isObject(read.data)) {
		warnings.push("Pi trust store is not a JSON object.");
		return { roots: [], skipped: [] };
	}
	const roots: string[] = [];
	const skipped: SkippedProject[] = [];
	for (const [path, decision] of Object.entries(read.data)) {
		if (decision !== true) continue;
		const root = resolve(expandUserPath(path));
		const broadReason = isBroadOrPrivateRoot(root);
		if (broadReason) {
			skipped.push({ path: root, reason: `trusted root skipped: ${broadReason}` });
			continue;
		}
		if (!existsSync(root)) {
			skipped.push({ path: root, reason: "trusted root no longer exists" });
			continue;
		}
		roots.push(root);
	}
	return { roots: uniquePaths(roots), skipped };
}

async function isCurrentTrustedProject(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, projectDir: string): Promise<boolean> {
	if (!ctx.isProjectTrusted()) return false;
	const [ctxReal, projectReal] = await Promise.all([realpath(ctx.cwd).catch(() => ctx.cwd), realpath(projectDir).catch(() => projectDir)]);
	return ctxReal === projectReal;
}

async function trustedProjectDirs(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, projectDirs: string[], warnings: string[]): Promise<{ trusted: string[]; skipped: SkippedProject[] }> {
	const trustStore = new ProjectTrustStore(getAgentDir());
	const trusted: string[] = [];
	const skipped: SkippedProject[] = [];
	for (const projectDir of projectDirs) {
		if (await isCurrentTrustedProject(ctx, projectDir)) {
			trusted.push(projectDir);
			continue;
		}
		try {
			if (trustStore.get(projectDir) === true) trusted.push(projectDir);
			else skipped.push({ path: projectDir, reason: "not trusted by Pi" });
		} catch (error) {
			warnings.push(`Could not read Pi trust state for ${projectDir}: ${error instanceof Error ? error.message : String(error)}`);
			skipped.push({ path: projectDir, reason: "trust state could not be read" });
		}
	}
	return { trusted, skipped };
}

async function candidateProjectsFromRoots(roots: string[], warnings: string[], progress?: ScanProgress): Promise<string[]> {
	const projectDirs: string[] = [];
	for (let index = 0; index < roots.length; index += 1) {
		const root = roots[index]!;
		progress?.(`Construct: searching trusted root ${index + 1}/${roots.length} ${root}`);
		projectDirs.push(...(await findProjects(root, warnings, progress)));
	}
	return uniqueRealPaths(projectDirs);
}

async function buildScanResult(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, args = "", progress?: ScanProgress): Promise<ScanResult> {
	const root = resolveScanRoot(args, ctx.cwd);
	const warnings: string[] = [];
	const trustedRootSkips: SkippedProject[] = [];
	let display: ScanDisplayContext;
	let projectDirs: string[];
	progress?.("Construct: preparing scan roots");
	if (root) {
		display = { heading: `Root: ${root}`, basePath: root };
		const broadReason = isBroadOrPrivateRoot(root);
		if (broadReason) return { display, projects: [], skippedProjects: [], warnings: [`Scan root refused: ${broadReason}`] };
		if (!existsSync(root)) return { display, projects: [], skippedProjects: [], warnings: [`Scan root does not exist: ${root}`] };
		progress?.(`Construct: searching ${root}`);
		projectDirs = await findProjects(root, warnings, progress);
	} else {
		const trustedRoots = await trustedRootsFromTrustStore(warnings);
		trustedRootSkips.push(...trustedRoots.skipped);
		display = { heading: `Source: Pi trust store (${trustedRoots.roots.length} trusted root${trustedRoots.roots.length === 1 ? "" : "s"})` };
		projectDirs = await candidateProjectsFromRoots(trustedRoots.roots, warnings, progress);
		if (trustedRoots.roots.length === 0 && trustedRootSkips.length === 0) warnings.push("No trusted Pi paths found. Trust a project or run /construct scan <path>.");
	}

	progress?.(`Construct: checking trust for ${projectDirs.length} project${projectDirs.length === 1 ? "" : "s"}`);
	const catalogRead = await readJson(join(getAgentDir(), "construct", "catalog.json"));
	const parsedCatalog = parseCatalog(catalogRead);
	warnings.push(...parsedCatalog.warnings.map((warning) => `Construct library: ${warning}`));
	const catalogSources = new Set(parsedCatalog.data.items.map((item) => item.source));
	projectDirs = await uniqueRealPaths(projectDirs);
	const { trusted, skipped } = await trustedProjectDirs(ctx, projectDirs, warnings);
	const projects: ScanProject[] = [];
	for (let index = 0; index < trusted.length; index += 1) {
		const projectDir = trusted[index]!;
		const scanLabel = `Construct: scanning project ${index + 1}/${trusted.length} ${basename(projectDir)}`;
		progress?.(scanLabel);
		projects.push(await scanProject(projectDir, catalogSources, progress, scanLabel));
	}
	progress?.("Construct: scan complete");
	return { display, projects, skippedProjects: [...trustedRootSkips, ...skipped], warnings };
}

export async function buildScan(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, args = ""): Promise<string> {
	const result = await buildScanResult(ctx, args);
	return formatScan(result.display, result.projects, result.skippedProjects, result.warnings);
}

function scanFindingItems(result: ScanResult): CheckboxPickerItem[] {
	const items: CheckboxPickerItem[] = [];
	for (const project of result.projects.filter(projectHasUnloaded)) {
		const section = formatProjectPath(result.display, project);
		for (let index = 0; index < project.unloadedPackages.length; index += 1) {
			const pkg = project.unloadedPackages[index]!;
			items.push({
				id: `package:${project.path}:${index}`,
				label: deriveId(pkg.source),
				value: pkg.source,
				description: `${pkg.missing.join(", ")}. Press Enter to load selected scan rows into Construct.`,
				checked: false,
				section,
				sectionTone: "accent",
				stateText: "pkg",
				stateTone: "accent",
			});
		}
		for (let index = 0; index < project.unloadedResources.length; index += 1) {
			const resource = project.unloadedResources[index]!;
			items.push({
				id: `${resource.kind}:${project.path}:${index}`,
				label: `${resource.kind}:${resource.name}`,
				value: resource.relativePath,
				description: `Unadopted project ${resource.kind}. Press Enter to load selected scan rows into Construct.`,
				checked: false,
				section,
				sectionTone: "accent",
				stateText: resource.kind,
				stateTone: resource.kind === "extension" ? "success" : "muted",
			});
		}
	}
	return items;
}

function selectedScanRequests(result: ScanResult, selectedIds: string[]): Array<{ project: ScanProject; queries: string[] }> {
	const selected = new Set(selectedIds);
	const requests: Array<{ project: ScanProject; queries: string[] }> = [];
	for (const project of result.projects) {
		const queries: string[] = [];
		for (let index = 0; index < project.unloadedPackages.length; index += 1) {
			if (selected.has(`package:${project.path}:${index}`)) queries.push(project.unloadedPackages[index]!.source);
		}
		for (let index = 0; index < project.unloadedResources.length; index += 1) {
			const resource = project.unloadedResources[index]!;
			if (selected.has(`${resource.kind}:${project.path}:${index}`)) queries.push(resource.relativePath);
		}
		if (queries.length > 0) requests.push({ project, queries });
	}
	return requests;
}

async function showScanChecklist(ctx: ExtensionCommandContext, result: ScanResult): Promise<void> {
	const items = scanFindingItems(result);
	if (items.length === 0) {
		await showSummary(ctx, formatScan(result.display, result.projects, result.skippedProjects, result.warnings));
		return;
	}
	await pickCheckboxes(ctx, `Construct scan: ${items.length} unloaded finding${items.length === 1 ? "" : "s"}`, items, {
		initialSelection: "empty",
		filterLabel: "Filter findings",
		filterHint: "Type to narrow by project/source/resource · Space selects",
		confirmHint: "Enter loads selected",
		footerHint: "  Type to search/filter · Space toggles · Enter loads selected into Construct · Esc closes\n  Scan loads package declarations plus project metadata; it never edits .pi/settings.json.",
		onSubmit: async (selectedIds, update, signal) => {
			if (selectedIds.length === 0) {
				return {
					title: "No scan findings selected",
					lines: ["Select findings with Space, then press Enter to load them into Construct.", "", "No files were changed."],
				};
			}
			const requests = selectedScanRequests(result, selectedIds);
			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct scan load", update, signal);
			if (!ready || signal.aborted) return { title: "Construct scan load cancelled", lines: ["No files were changed."] };
			const lines: string[] = [`Selected findings: ${selectedIds.length}`, `Projects: ${requests.length}`, ""];
			let loadedPackages = 0;
			let adoptedDirect = 0;
			let warningCount = 0;
			for (let index = 0; index < requests.length; index += 1) {
				if (signal.aborted) return { title: "Construct scan load cancelled", lines: [...lines, "", "Cancelled before finishing selected projects."] };
				const request = requests[index]!;
				const projectLabel = formatProjectPath(result.display, request.project);
				update("Loading scan findings", [`Project ${index + 1}/${requests.length}: ${projectLabel}`, `Selected resources: ${request.queries.length}`]);
				try {
					const loadResult = await loadProjectResourcesIntoConstruct(request.project.path, request.queries);
					loadedPackages += loadResult.metadataChanged;
					adoptedDirect += loadResult.directMetadataChanged ?? 0;
					warningCount += loadResult.warnings.length;
					lines.push(projectLabel, `+ Packages armed: ${loadResult.metadataChanged}`, `+ Direct resources adopted: ${loadResult.directMetadataChanged ?? 0}`);
					for (const warning of loadResult.warnings) lines.push(`! ${warning}`);
				} catch (error) {
					warningCount += 1;
					lines.push(projectLabel, `! ${error instanceof Error ? error.message : String(error)}`);
				}
				lines.push("");
			}
			while (lines.at(-1) === "") lines.pop();
			return {
				title: "Construct scan load complete",
				lines: [
					`Packages armed: ${loadedPackages}`,
					`Direct resources adopted: ${adoptedDirect}`,
					`Warnings: ${warningCount}`,
					"No /reload needed; scan load only updates the Construct library and project metadata.",
					"",
					...lines,
				],
				confirmHint: "Press Enter/Esc to close",
			};
		},
	});
}

export async function handleScan(args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		showText(ctx, await buildScan(ctx, args));
		return;
	}
	try {
		const result = await buildScanResult(ctx, args, (message) => setConstructStatus(ctx, message));
		setConstructStatus(ctx, undefined);
		await showScanChecklist(ctx, result);
	} finally {
		setConstructStatus(ctx, undefined);
	}
}
