import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, ProjectTrustStore, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { deriveId, parseCatalog } from "../catalog.js";
import { loadProjectResourcesIntoConstruct } from "./load.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { applyDirectResourceDrift, collectPackageSourceSets, formatManagedItemDrift, getManagedItems, getPackages, removeConstructItemsById } from "../project-settings.js";
import { collectDirectProjectResources } from "../resources.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary } from "../sources.js";
import type { ConstructPaths, DirectResourceKind, JsonReadResult, ManagedItemSummary, PackageDeclarationSummary } from "../types.js";
import { pickCheckboxes, setConstructStatus, showSummary, showText, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";

const ignoredDirectoryNames = new Set(["node_modules", ".git", "dist", "build"]);
const ignoredPiDirectoryNames = new Set(["npm", "git"]);

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
	driftedMetadata: ManagedItemSummary[];
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
	if (existsSync(join(dir, ".agents", "skills"))) return true;
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

function formatPackageFinding(pkg: ScanPackageFinding): string {
	return `${pkg.source}${pkg.disabledByFilters ? " (disabled)" : ""} — ${pkg.missing.join(", ")}`;
}

function formatResourceFinding(resource: ScanResourceFinding): string {
	return `${resource.kind} ${resource.name} — ${resource.relativePath}`;
}

const scanResourceKindOrder: DirectResourceKind[] = ["extension", "skill", "prompt", "theme"];

function resourceKindLabel(kind: DirectResourceKind): string {
	if (kind === "extension") return "Direct extensions";
	if (kind === "skill") return "Direct skills";
	if (kind === "prompt") return "Direct prompts";
	return "Direct themes";
}

function scanSectionLabel(display: ScanDisplayContext, project: ScanProject, label: string): string {
	return `${formatProjectPath(display, project)} · ${label}`;
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
	const directInventory = await collectDirectProjectResources({ cwd: projectDir, isProjectTrusted: () => true }, paths, construct);
	const managedSummaries = applyDirectResourceDrift(
		await getManagedItems(construct, packageSourceSets.declaredSources, paths, packageSourceSets.disabledSources, packageSourceSets.projectOverrideSources),
		directInventory.resources,
	);
	const warnings: string[] = [];
	warnings.push(...directInventory.warnings);
	if (settings.state === "invalid") warnings.push(describeJsonReadIssue(`${toPosixPath(relative(projectDir, paths.projectSettingsPath))}`, settings));
	if (construct.state === "invalid") warnings.push(describeJsonReadIssue(`${toPosixPath(relative(projectDir, paths.projectConstructPath))}`, construct));
	const driftedMetadata = managedSummaries.filter((item) => item.drift);

	const unloadedPackages: ScanPackageFinding[] = [];
	const seenPackageKeys = new Set<string>();
	for (const pkg of packages) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) {
			if (pkg.form === "invalid") warnings.push("Invalid package declaration ignored.");
			continue;
		}
		if (pkg.projectOverride) continue;
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

	const unloadedResources: ScanResourceFinding[] = directInventory.resources
		.filter((resource) => !resource.managed)
		.map((resource) => ({
			kind: resource.kind,
			name: resource.name,
			path: resource.path,
			relativePath: resource.displayPath,
		}));
	progress?.(`${scanLabel ?? `Construct: scanning ${basename(projectDir)}`} · ${directInventory.resources.length} Pi-resolved direct resource${directInventory.resources.length === 1 ? "" : "s"} found`);

	return {
		path: projectDir,
		realPath: paths.realCwd,
		settings,
		construct,
		packages,
		unloadedPackages,
		unloadedResources,
		driftedMetadata,
		warnings,
	};
}

function projectHasUnloaded(project: ScanProject): boolean {
	return project.unloadedPackages.length > 0 || project.unloadedResources.length > 0;
}

function projectHasScanFindings(project: ScanProject): boolean {
	return projectHasUnloaded(project) || project.driftedMetadata.length > 0;
}

function formatProjectPath(display: ScanDisplayContext, project: Pick<ScanProject, "path">): string {
	if (!display.basePath) return toPosixPath(project.path);
	const rel = relative(display.basePath, project.path);
	return rel && !rel.startsWith("..") && !isAbsolute(rel) ? toPosixPath(rel) : toPosixPath(project.path);
}

function formatScan(display: ScanDisplayContext, projects: ScanProject[], skippedProjects: SkippedProject[], warnings: string[]): string {
	const projectsWithUnloaded = projects.filter(projectHasUnloaded);
	const projectsWithDrift = projects.filter((project) => project.driftedMetadata.length > 0);
	const unloadedPackageCount = projects.reduce((sum, project) => sum + project.unloadedPackages.length, 0);
	const unloadedResourceCount = projects.reduce((sum, project) => sum + project.unloadedResources.length, 0);
	const driftedMetadataCount = projects.reduce((sum, project) => sum + project.driftedMetadata.length, 0);
	const lines = [
		"Construct scan",
		"==============",
		display.heading,
		`Trusted projects scanned: ${projects.length}`,
		`Skipped untrusted projects: ${skippedProjects.length}`,
		`Projects with unloaded resources: ${projectsWithUnloaded.length}`,
		`Unloaded package declarations: ${unloadedPackageCount}`,
		`Unloaded direct resources: ${unloadedResourceCount}`,
		`Drifted Construct metadata: ${driftedMetadataCount}`,
		"Scope: Pi-resolved trusted project resources (.pi, project .agents/skills, and project settings paths); user/global resources and package caches are not scanned as direct files.",
	];

	if (projectsWithUnloaded.length === 0) lines.push("", "No unloaded resources found.");
	else {
		lines.push("", "Unloaded resources", "------------------");
		for (const project of projectsWithUnloaded) {
			lines.push(formatProjectPath(display, project));
			if (project.unloadedPackages.length > 0) {
				lines.push("  Package declarations");
				for (const pkg of project.unloadedPackages) lines.push(`  - package ${formatPackageFinding(pkg)}`);
			}
			for (const kind of scanResourceKindOrder) {
				const resources = project.unloadedResources.filter((resource) => resource.kind === kind);
				if (resources.length === 0) continue;
				lines.push(`  ${resourceKindLabel(kind)}`);
				for (const resource of resources) lines.push(`  - ${formatResourceFinding(resource)}`);
			}
			lines.push("");
		}
		while (lines.at(-1) === "") lines.pop();
	}

	if (projectsWithDrift.length > 0) {
		lines.push("", "Drifted Construct metadata", "--------------------------", "Run /construct scan in TUI to select drifted metadata for reconciliation. Print scan is read-only.");
		for (const project of projectsWithDrift) {
			lines.push(formatProjectPath(display, project));
			for (const finding of project.driftedMetadata) lines.push(`- ${formatManagedItemDrift(finding)}`);
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

type DriftRepairAction = "load" | "remove-metadata" | "mark-enabled" | "mark-disabled";

interface DriftRepairSelection {
	id: string;
	action: DriftRepairAction;
}

interface ScanSelectionRequest {
	project: ScanProject;
	queries: string[];
	drift: DriftRepairSelection[];
}

function driftRepairAction(item: ManagedItemSummary): DriftRepairAction | undefined {
	if (!item.drift) return undefined;
	if (item.kind !== "package") {
		return item.drift === "direct resource missing from Pi's resolved project resources" ? "remove-metadata" : undefined;
	}
	if (!item.source) return undefined;
	if (item.drift === "Construct package metadata points to a Pi project override; manage with pi config -l") return "remove-metadata";
	if (item.drift === "disabled in Construct metadata, still active in .pi/settings.json") return "load";
	if (item.drift === "enabled in Construct metadata, disabled by package filters") return "mark-disabled";
	if (item.drift.endsWith("missing from .pi/settings.json")) return "remove-metadata";
	return undefined;
}

function driftRepairDescription(action: DriftRepairAction | undefined): string {
	if (action === "load") return "Re-arm Construct metadata from the active package declaration.";
	if (action === "mark-disabled") return "Mark Construct metadata disabled to match Pi package filters.";
	if (action === "remove-metadata") return "Remove stale project Construct metadata; .pi/settings.json is not edited.";
	return "Inspect drift; no automatic repair is available.";
}

function scanFindingItems(result: ScanResult): CheckboxPickerItem[] {
	const items: CheckboxPickerItem[] = [];
	for (const project of result.projects.filter(projectHasScanFindings)) {
		const packageSection = scanSectionLabel(result.display, project, "Package declarations");
		const driftSection = scanSectionLabel(result.display, project, "Drifted metadata");
		for (let index = 0; index < project.unloadedPackages.length; index += 1) {
			const pkg = project.unloadedPackages[index]!;
			items.push({
				id: `package:${project.path}:${index}`,
				label: deriveId(pkg.source),
				value: pkg.source,
				description: `${pkg.missing.join(", ")}. Press Enter to load selected scan rows into Construct.`,
				checked: false,
				section: packageSection,
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
				section: scanSectionLabel(result.display, project, resourceKindLabel(resource.kind)),
				sectionTone: "accent",
				stateText: resource.kind,
				stateTone: resource.kind === "extension" ? "success" : "muted",
			});
		}
		for (let index = 0; index < project.driftedMetadata.length; index += 1) {
			const item = project.driftedMetadata[index]!;
			const action = driftRepairAction(item);
			items.push({
				id: `drift:${project.path}:${index}`,
				label: item.id,
				value: item.source ?? item.drift ?? item.kind,
				description: `${item.drift ?? "metadata drift"}. ${driftRepairDescription(action)}`,
				checked: false,
				disabled: action === undefined,
				section: driftSection,
				sectionTone: "accent",
				stateText: "drift",
				stateTone: "warning",
			});
		}
	}
	return items;
}

function selectedScanRequests(result: ScanResult, selectedIds: string[]): ScanSelectionRequest[] {
	const selected = new Set(selectedIds);
	const requests: ScanSelectionRequest[] = [];
	for (const project of result.projects) {
		const queries: string[] = [];
		const drift: DriftRepairSelection[] = [];
		for (let index = 0; index < project.unloadedPackages.length; index += 1) {
			if (selected.has(`package:${project.path}:${index}`)) queries.push(project.unloadedPackages[index]!.source);
		}
		for (let index = 0; index < project.unloadedResources.length; index += 1) {
			const resource = project.unloadedResources[index]!;
			if (selected.has(`${resource.kind}:${project.path}:${index}`)) queries.push(resource.relativePath);
		}
		for (let index = 0; index < project.driftedMetadata.length; index += 1) {
			if (!selected.has(`drift:${project.path}:${index}`)) continue;
			const item = project.driftedMetadata[index]!;
			const action = driftRepairAction(item);
			if (!action) continue;
			if (action === "load" && item.source) queries.push(item.source);
			else if (action !== "load") drift.push({ id: item.id, action });
		}
		if (queries.length > 0 || drift.length > 0) requests.push({ project, queries, drift });
	}
	return requests;
}

async function currentDriftedMetadata(projectDir: string): Promise<{ paths: ConstructPaths; construct: JsonReadResult; items: ManagedItemSummary[] }> {
	const paths = projectPaths(projectDir);
	paths.realCwd = await realpath(projectDir).catch(() => projectDir);
	const [settings, construct] = await Promise.all([readJson(paths.projectSettingsPath), readJson(paths.projectConstructPath)]);
	if (settings.state === "invalid") throw new Error(`Cannot repair drift because ${describeJsonReadIssue(".pi/settings.json", settings)}`);
	if (settings.state === "ok" && !isObject(settings.data)) throw new Error("Cannot repair drift because .pi/settings.json is not a JSON object.");
	if (construct.state === "invalid") throw new Error(`Cannot repair drift because ${describeJsonReadIssue(".pi/construct.json", construct)}`);
	if (construct.state === "ok" && !isObject(construct.data)) throw new Error("Cannot repair drift because .pi/construct.json is not a JSON object.");
	const settingsDir = dirname(paths.projectSettingsPath);
	const packageSourceSets = await collectPackageSourceSets(getPackages(settings), settingsDir);
	const directInventory = await collectDirectProjectResources({ cwd: projectDir, isProjectTrusted: () => true }, paths, construct);
	return {
		paths,
		construct,
		items: applyDirectResourceDrift(
			await getManagedItems(construct, packageSourceSets.declaredSources, paths, packageSourceSets.disabledSources, packageSourceSets.projectOverrideSources),
			directInventory.resources,
		).filter((item) => item.drift),
	};
}

async function repairDriftedMetadata(projectDir: string, selections: DriftRepairSelection[]): Promise<{ removed: number; updated: number; skipped: number; warnings: string[] }> {
	if (selections.length === 0) return { removed: 0, updated: 0, skipped: 0, warnings: [] };
	const warnings: string[] = [];
	const selectedActionById = new Map(selections.map((selection) => [selection.id, selection.action]));
	const { construct, items } = await currentDriftedMetadata(projectDir);
	if (construct.state === "missing") return { removed: 0, updated: 0, skipped: selections.length, warnings: ["Project Construct metadata disappeared before repair."] };
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return { removed: 0, updated: 0, skipped: selections.length, warnings: ["Project Construct metadata has no items to repair."] };

	const currentActionById = new Map<string, DriftRepairAction>();
	for (const item of items) {
		const action = driftRepairAction(item);
		if (action) currentActionById.set(item.id, action);
	}

	const nextItems: Record<string, unknown> = { ...construct.data.items };
	const removeIds: string[] = [];
	const now = new Date().toISOString();
	let updated = 0;
	let skipped = 0;
	for (const [id, selectedAction] of selectedActionById) {
		const currentAction = currentActionById.get(id);
		const value = nextItems[id];
		if (currentAction !== selectedAction || !isObject(value)) {
			skipped += 1;
			continue;
		}
		if (selectedAction === "remove-metadata") {
			removeIds.push(id);
			continue;
		}
		if (selectedAction === "mark-enabled" || selectedAction === "mark-disabled") {
			nextItems[id] = { ...value, enabled: selectedAction === "mark-enabled", updatedAt: now };
			updated += 1;
			continue;
		}
		skipped += 1;
	}
	const removal = removeConstructItemsById({ ...construct.data, items: nextItems }, removeIds);
	if (removal.removed > 0 || updated > 0) await writeJson(projectPaths(projectDir).projectConstructPath, removal.construct);
	if (removal.removed !== removeIds.length) skipped += removeIds.length - removal.removed;
	if (skipped > 0) warnings.push(`Skipped drift repairs that changed before apply: ${skipped}`);
	return { removed: removal.removed, updated, skipped, warnings };
}

async function showScanChecklist(ctx: ExtensionCommandContext, result: ScanResult): Promise<void> {
	const items = scanFindingItems(result);
	if (items.length === 0) {
		await showSummary(ctx, formatScan(result.display, result.projects, result.skippedProjects, result.warnings));
		return;
	}
	await pickCheckboxes(ctx, `Construct scan: ${items.length} finding${items.length === 1 ? "" : "s"}`, items, {
		initialSelection: "empty",
		filterLabel: "Filter findings",
		filterHint: "Type to narrow by project/source/resource/drift · Space selects",
		confirmHint: "Enter reconciles selected",
		footerHint: "  Type to search/filter · Space toggles · Enter reconciles selected · Esc closes\n  Scan loads package declarations and repairs Construct metadata; it never edits .pi/settings.json.",
		onSubmit: async (selectedIds, update, signal) => {
			if (selectedIds.length === 0) {
				return {
					title: "No scan findings selected",
					lines: ["Select findings with Space, then press Enter to reconcile them.", "", "No files were changed."],
				};
			}
			const requests = selectedScanRequests(result, selectedIds);
			const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct scan reconcile", update, signal);
			if (!ready || signal.aborted) return { title: "Construct scan reconcile cancelled", lines: ["No files were changed."] };
			const lines: string[] = [`Selected findings: ${selectedIds.length}`, `Projects: ${requests.length}`, ""];
			let loadedPackages = 0;
			let adoptedDirect = 0;
			let removedMetadata = 0;
			let repairedMetadata = 0;
			let warningCount = 0;
			for (let index = 0; index < requests.length; index += 1) {
				if (signal.aborted) return { title: "Construct scan reconcile cancelled", lines: [...lines, "", "Cancelled before finishing selected projects."] };
				const request = requests[index]!;
				const projectLabel = formatProjectPath(result.display, request.project);
				update("Reconciling scan findings", [`Project ${index + 1}/${requests.length}: ${projectLabel}`, `Selected findings: ${request.queries.length + request.drift.length}`]);
				try {
					let projectLoadedPackages = 0;
					let projectAdoptedDirect = 0;
					let projectRemovedMetadata = 0;
					let projectRepairedMetadata = 0;
					const projectWarnings: string[] = [];
					if (request.queries.length > 0) {
						const loadResult = await loadProjectResourcesIntoConstruct(request.project.path, request.queries);
						projectLoadedPackages += loadResult.metadataChanged;
						projectAdoptedDirect += loadResult.directMetadataChanged ?? 0;
						projectWarnings.push(...loadResult.warnings);
					}
					if (request.drift.length > 0) {
						const repairResult = await repairDriftedMetadata(request.project.path, request.drift);
						projectRemovedMetadata += repairResult.removed;
						projectRepairedMetadata += repairResult.updated;
						projectWarnings.push(...repairResult.warnings);
					}
					loadedPackages += projectLoadedPackages;
					adoptedDirect += projectAdoptedDirect;
					removedMetadata += projectRemovedMetadata;
					repairedMetadata += projectRepairedMetadata;
					warningCount += projectWarnings.length;
					lines.push(projectLabel, `+ Packages armed: ${projectLoadedPackages}`, `+ Direct resources adopted: ${projectAdoptedDirect}`, `+ Stale metadata removed: ${projectRemovedMetadata}`, `+ Metadata state repaired: ${projectRepairedMetadata}`);
					for (const warning of projectWarnings) lines.push(`! ${warning}`);
				} catch (error) {
					warningCount += 1;
					lines.push(projectLabel, `! ${error instanceof Error ? error.message : String(error)}`);
				}
				lines.push("");
			}
			while (lines.at(-1) === "") lines.pop();
			return {
				title: "Construct scan reconcile complete",
				lines: [
					`Packages armed: ${loadedPackages}`,
					`Direct resources adopted: ${adoptedDirect}`,
					`Stale metadata removed: ${removedMetadata}`,
					`Metadata state repaired: ${repairedMetadata}`,
					`Warnings: ${warningCount}`,
					"No /reload needed; scan reconcile updates the Construct library and project metadata only.",
					".pi/settings.json was not edited.",
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
