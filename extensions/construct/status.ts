import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatCatalogItem, parseCatalog } from "./catalog.js";
import { describeRead, isObject, readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { CONSTRUCT_TITLE } from "./metadata.js";
import { collectPackageSourceSets, formatList, getManagedItems, getPackages } from "./project-settings.js";
import { parseKnownProjects } from "./projects.js";
import { collectDirectProjectResources, directResourceKinds, resourcePlural } from "./resources.js";
import { normalizeSourceForLibrary } from "./sources.js";

interface StatusData {
	paths: Awaited<ReturnType<typeof getPaths>>;
	userCatalog: Awaited<ReturnType<typeof readJson>>;
	userSettings: Awaited<ReturnType<typeof readJson>>;
	userProjects: Awaited<ReturnType<typeof readJson>>;
	projectSettings: Awaited<ReturnType<typeof readJson>>;
	projectConstruct: Awaited<ReturnType<typeof readJson>>;
	catalog: ReturnType<typeof parseCatalog>;
	knownProjects: ReturnType<typeof parseKnownProjects>;
	packages: ReturnType<typeof getPackages>;
	managed: Awaited<ReturnType<typeof getManagedItems>>;
	directResources: Awaited<ReturnType<typeof collectDirectProjectResources>>;
	commands: ReturnType<ExtensionAPI["getCommands"]>;
	tools: ReturnType<ExtensionAPI["getAllTools"]>;
	activeTools: ReturnType<ExtensionAPI["getActiveTools"]>;
	mode: ExtensionCommandContext["mode"];
	hasUI: boolean;
	trusted: boolean;
}

function parseStatusMode(args = ""): { verbose: boolean; warnings: string[] } {
	const tokens = args.split(/\s+/).filter(Boolean);
	const warnings: string[] = [];
	let verbose = false;
	for (const token of tokens) {
		if (["full", "verbose", "details", "debug"].includes(token)) verbose = true;
		else warnings.push(`Unknown status argument ignored: ${token}`);
	}
	return { verbose, warnings };
}

async function collectStatusData(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<StatusData> {
	const paths = await getPaths(ctx);
	const [userCatalog, userSettings, userProjects, projectSettings, projectConstruct] = await Promise.all([
		readJson(paths.userCatalogPath),
		readJson(paths.userSettingsPath),
		readJson(paths.userProjectsPath),
		readJson(paths.projectSettingsPath),
		readJson(paths.projectConstructPath),
	]);

	const catalog = parseCatalog(userCatalog);
	const knownProjects = parseKnownProjects(userProjects);
	const packages = getPackages(projectSettings);
	const packageSources = await collectPackageSourceSets(packages, dirname(paths.projectSettingsPath));
	const managed = await getManagedItems(projectConstruct, packageSources.declaredSources, paths, packageSources.disabledSources);
	const directResources = await collectDirectProjectResources(ctx, paths, projectConstruct);
	return {
		paths,
		userCatalog,
		userSettings,
		userProjects,
		projectSettings,
		projectConstruct,
		catalog,
		knownProjects,
		packages,
		managed,
		directResources,
		commands: pi.getCommands(),
		tools: pi.getAllTools(),
		activeTools: pi.getActiveTools(),
		mode: ctx.mode,
		hasUI: ctx.hasUI,
		trusted: ctx.isProjectTrusted(),
	};
}

function compactCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function compactRead(result: Awaited<ReturnType<typeof readJson>>): string {
	if (result.state === "ok") return "ok";
	if (result.state === "missing") return "missing";
	return "invalid/unreadable JSON";
}

function autoloadEnabled(data: StatusData): boolean {
	return data.userSettings.state === "ok" && isObject(data.userSettings.data) && data.userSettings.data.autoload === true;
}

function buildCompactStatus(data: StatusData, argumentWarnings: string[]): string {
	const enabled = data.managed.filter((item) => item.enabled === true).length;
	const disabled = data.managed.filter((item) => item.enabled === false).length;
	const unknown = data.managed.length - enabled - disabled;
	const drift = data.managed.filter((item) => item.drift);
	const invalidPackages = data.packages.filter((pkg) => pkg.form === "invalid").length;
	const directProjectResources = data.directResources.resources.length;
	const warnings = [
		...argumentWarnings,
		...data.catalog.warnings,
		...data.knownProjects.warnings,
		...data.directResources.warnings,
		...drift.map((item) => `${item.id} drift: ${item.drift}`),
		...(invalidPackages > 0 ? [`${invalidPackages} invalid package declaration${invalidPackages === 1 ? "" : "s"} in .pi/settings.json`] : []),
	];

	return [
		`${CONSTRUCT_TITLE} status`,
		"=".repeat(`${CONSTRUCT_TITLE} status`.length),
		`Project: ${data.paths.cwd}`,
		data.paths.realCwd === data.paths.cwd ? undefined : `Canonical: ${data.paths.realCwd}`,
		`Trust: ${data.trusted ? "trusted" : "not trusted"}`,
		"",
		"Loadout",
		"-------",
		`Library: ${compactCount(data.catalog.data.items.length, "package")} · ${compactCount(data.catalog.data.profiles.length, "saved loadout")}`,
		`Known projects: ${data.knownProjects.data.projects.length}`,
		`Project packages: ${data.packages.length}`,
		directProjectResources > 0 ? `Direct project resources: ${directProjectResources}` : undefined,
		`Construct-managed: ${enabled} enabled · ${disabled} disabled${unknown > 0 ? ` · ${unknown} unknown` : ""}${drift.length > 0 ? ` · ${drift.length} drift` : ""}`,
		`Autoload: ${autoloadEnabled(data) ? "on" : "off"}`,
		"Load: manual only (/construct load)",
		"",
		"Files",
		"-----",
		`Project settings: ${compactRead(data.projectSettings)}`,
		`Construct metadata: ${compactRead(data.projectConstruct)}`,
		`Construct library: ${compactRead(data.userCatalog)}`,
		`Construct settings: ${compactRead(data.userSettings)}`,
		`Known-project index: ${compactRead(data.userProjects)}`,
		"",
		"Runtime",
		"-------",
		`Slash commands: ${data.commands.length}`,
		`Tools: ${data.activeTools.length}/${data.tools.length} active`,
		warnings.length > 0 ? "" : undefined,
		warnings.length > 0 ? "Warnings" : undefined,
		warnings.length > 0 ? "--------" : undefined,
		...warnings.map((warning) => `! ${warning}`),
		"",
		"Use /construct for the loadout menu. Use /construct status full for details.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

function directResourceState(resource: StatusData["directResources"]["resources"][number]): string {
	return resource.managed ? "managed" : "unloaded";
}

function directResourceLine(resource: StatusData["directResources"]["resources"][number]): string {
	const enabled = resource.enabled ? "enabled" : "disabled";
	const settingsPath = resource.settingsPath ? `, settings ${resource.settingsPath}` : "";
	return `- ${resource.kind} ${resource.name} (${enabled}, ${resource.source}, ${directResourceState(resource)}${settingsPath}) — ${resource.displayPath}`;
}

async function packageDeclarationLine(pkg: StatusData["packages"][number], settingsDir: string): Promise<string> {
	const details: string[] = [pkg.form];
	if (pkg.disabledByFilters) details.push("disabled by filters");
	if (pkg.form !== "invalid" && pkg.source.trim()) {
		const normalized = await normalizeSourceForLibrary(pkg.source, settingsDir);
		if (normalized !== pkg.source) details.push(`normalized ${normalized}`);
	}
	return `- ${pkg.source} (${details.join(", ")})`;
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = keyFor(item);
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
}

function formatCounts(counts: Record<string, number>): string {
	const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
	return entries.length > 0 ? entries.map(([key, count]) => `${key} ${count}`).join(" · ") : "none";
}

function duplicateNameLines<T>(label: string, items: T[], nameFor: (item: T) => string, sourceFor: (item: T) => string): string[] {
	const byName = new Map<string, string[]>();
	for (const item of items) {
		const name = nameFor(item);
		const sources = byName.get(name) ?? [];
		sources.push(sourceFor(item));
		byName.set(name, sources);
	}
	return [...byName.entries()]
		.filter(([, sources]) => sources.length > 1)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, sources]) => `! Duplicate ${label} ${name}: ${sources.join("; ")}`);
}

async function buildVerboseStatus(data: StatusData, argumentWarnings: string[]): Promise<string> {
	const catalogPreview = data.catalog.data.items.slice(0, 5).map(formatCatalogItem);
	const profilePreview = data.catalog.data.profiles.slice(0, 5).map((profile) => `- ${profile.id}: ${profile.sources.length || profile.items.length} package sources`);
	const knownProjectPreview = data.knownProjects.data.projects.slice(0, 5).map((project) => `- ${project.realPath ?? project.path}: ${project.packages.length} packages`);
	const commandCounts = countBy(data.commands, (command) => command.source);
	const activeToolNames = new Set(data.activeTools);
	const activeTools = data.tools.filter((tool) => activeToolNames.has(tool.name));
	const toolSourceCounts = countBy(data.tools, (tool) => tool.sourceInfo.source);
	const activeToolSourceCounts = countBy(activeTools, (tool) => tool.sourceInfo.source);
	const runtimeNotes = [
		...duplicateNameLines("slash command", data.commands, (command) => `/${command.name}`, (command) => `${command.source}:${command.sourceInfo.path}`),
		...duplicateNameLines("tool", data.tools, (tool) => tool.name, (tool) => `${tool.sourceInfo.source}:${tool.sourceInfo.path}`),
	];
	const packageLines = await Promise.all(data.packages.map((pkg) => packageDeclarationLine(pkg, dirname(data.paths.projectSettingsPath))));
	const managedLines = data.managed.map((item) => {
		const enabled = item.enabled === undefined ? "unknown" : item.enabled ? "enabled" : "disabled";
		const source = item.source ? ` — ${item.source}` : "";
		const drift = item.drift ? ` [drift: ${item.drift}]` : "";
		return `- ${item.id} (${item.kind}, ${enabled})${source}${drift}`;
	});
	const directResourceLines = directResourceKinds.flatMap((kind) => {
		const resources = data.directResources.resources.filter((resource) => resource.kind === kind);
		return [`${resourcePlural(kind)}: ${resources.length}`, ...formatList(resources.map(directResourceLine), `no project ${resourcePlural(kind)}`)];
	});

	return [
		"Construct status details",
		"========================",
		`Target cwd: ${data.paths.cwd}`,
		data.paths.realCwd === data.paths.cwd ? undefined : `Canonical cwd: ${data.paths.realCwd}`,
		`Mode: ${data.mode}`,
		`UI available: ${data.hasUI ? "yes" : "no"}`,
		`Project trusted: ${data.trusted ? "yes" : "no"}`,
		...argumentWarnings.map((warning) => `! ${warning}`),
		"",
		"User Construct state",
		"--------------------",
		`Autoload: ${autoloadEnabled(data) ? "on" : "off"} (trusted TUI quit-time prompt)`,
		"Load writes: user library and selected .pi/construct.json metadata only",
		`Construct library: ${describeRead(data.userCatalog)}`,
		`Construct settings: ${describeRead(data.userSettings)}`,
		`Known-project index: ${describeRead(data.userProjects)}`,
		`Library items: ${data.catalog.data.items.length}`,
		...formatList(catalogPreview, "no library preview"),
		`Saved loadouts: ${data.catalog.data.profiles.length}`,
		...formatList(profilePreview, "no saved loadouts"),
		...data.catalog.warnings.map((warning) => `! ${warning}`),
		`Known projects: ${data.knownProjects.data.projects.length}`,
		...formatList(knownProjectPreview, "no known projects indexed"),
		...data.knownProjects.warnings.map((warning) => `! ${warning}`),
		"",
		"Project Pi state",
		"----------------",
		`Project settings: ${describeRead(data.projectSettings)}`,
		`Package declarations: ${data.packages.length}`,
		...formatList(packageLines, "no project packages declared"),
		`Construct metadata: ${describeRead(data.projectConstruct)}`,
		`Construct-managed items: ${data.managed.length}`,
		...formatList(managedLines, "no Construct-managed items"),
		`Direct project resources: ${data.directResources.resources.length}`,
		...directResourceLines,
		...data.directResources.warnings.map((warning) => `! ${warning}`),
		"",
		"Runtime inventory",
		"-----------------",
		`Slash commands: ${data.commands.length} (${formatCounts(commandCounts)})`,
		`Tools: ${data.activeTools.length}/${data.tools.length} active`,
		`Tool sources: ${formatCounts(toolSourceCounts)}`,
		`Active tool sources: ${formatCounts(activeToolSourceCounts)}`,
		...runtimeNotes,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function buildStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext, args = ""): Promise<string> {
	const mode = parseStatusMode(args);
	const data = await collectStatusData(pi, ctx);
	return mode.verbose ? await buildVerboseStatus(data, mode.warnings) : buildCompactStatus(data, mode.warnings);
}
