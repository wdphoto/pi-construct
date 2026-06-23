import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatCatalogItem } from "./catalog.js";
import { describeRead } from "./json.js";
import { CONSTRUCT_TITLE } from "./metadata.js";
import { collectProjectInventory, type ProjectInventory } from "./project-inventory.js";
import { formatList } from "./project-settings.js";
import { missingKnownProjectEntries } from "./projects.js";
import { directResourceKinds, resourcePlural } from "./resources.js";
import { normalizeSourceForLibrary } from "./sources.js";

interface StatusData {
	inventory: ProjectInventory;
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
	return {
		inventory: await collectProjectInventory(ctx),
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

function compactRead(result: ProjectInventory["reads"]["userCatalog"]): string {
	if (result.state === "ok") return "ok";
	if (result.state === "missing") return "missing";
	return "invalid/unreadable JSON";
}

function buildCompactStatus(data: StatusData, argumentWarnings: string[]): string {
	const inventory = data.inventory;
	const enabled = inventory.managedItems.filter((item) => item.enabled === true).length;
	const disabled = inventory.managedItems.filter((item) => item.enabled === false).length;
	const unknown = inventory.managedItems.length - enabled - disabled;
	const drift = inventory.managedItems.filter((item) => item.drift);
	const invalidPackages = inventory.packageDeclarations.filter((pkg) => pkg.form === "invalid").length;
	const directProjectResources = inventory.directResources.resources.length;
	const warnings = [
		...argumentWarnings,
		...inventory.catalog.warnings,
		...inventory.knownProjects.warnings,
		...inventory.directResources.warnings,
		...drift.map((item) => `${item.id} drift: ${item.drift}`),
		...(invalidPackages > 0 ? [`${invalidPackages} invalid package declaration${invalidPackages === 1 ? "" : "s"} in .pi/settings.json`] : []),
	];

	return [
		`${CONSTRUCT_TITLE} status`,
		"=".repeat(`${CONSTRUCT_TITLE} status`.length),
		`Project: ${inventory.paths.cwd}`,
		inventory.paths.realCwd === inventory.paths.cwd ? undefined : `Canonical: ${inventory.paths.realCwd}`,
		`Trust: ${data.trusted ? "trusted" : "not trusted"}`,
		"",
		"Loadout",
		"-------",
		`Library: ${compactCount(inventory.catalog.data.items.length, "package")} · ${compactCount(inventory.catalog.data.profiles.length, "saved loadout")}`,
		`Known projects: ${inventory.knownProjects.data.projects.length}`,
		`Project packages: ${inventory.packageDeclarations.length}`,
		directProjectResources > 0 ? `Direct project resources: ${directProjectResources}` : undefined,
		`Construct-managed: ${enabled} enabled · ${disabled} disabled${unknown > 0 ? ` · ${unknown} unknown` : ""}${drift.length > 0 ? ` · ${drift.length} drift` : ""}`,
		"Load: manual only (/construct load)",
		"",
		"Files",
		"-----",
		`Project settings: ${compactRead(inventory.reads.projectSettings)}`,
		`Construct metadata: ${compactRead(inventory.reads.projectConstruct)}`,
		`Construct library: ${compactRead(inventory.reads.userCatalog)}`,
		`Known-project index: ${compactRead(inventory.reads.userProjects)}`,
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

function directResourceState(resource: ProjectInventory["directResources"]["resources"][number]): string {
	return resource.managed ? "managed" : "unloaded";
}

function directResourceLine(resource: ProjectInventory["directResources"]["resources"][number]): string {
	const enabled = resource.enabled ? "enabled" : "disabled";
	const settingsPath = resource.settingsPath ? `, settings ${resource.settingsPath}` : "";
	return `- ${resource.kind} ${resource.name} (${enabled}, ${resource.source}, ${directResourceState(resource)}${settingsPath}) — ${resource.displayPath}`;
}

async function packageDeclarationLine(pkg: ProjectInventory["packageDeclarations"][number], settingsDir: string): Promise<string> {
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
	const inventory = data.inventory;
	const catalogPreview = inventory.catalog.data.items.slice(0, 5).map(formatCatalogItem);
	const profilePreview = inventory.catalog.data.profiles.slice(0, 5).map((profile) => `- ${profile.id}: ${profile.sources.length || profile.items.length} package sources`);
	const knownProjectPreview = inventory.knownProjects.data.projects.slice(0, 5).map((project) => `- ${project.realPath ?? project.path}: ${project.packages.length} packages`);
	const missingKnownProjects = await missingKnownProjectEntries(inventory.knownProjects.data);
	const missingKnownProjectPreview = missingKnownProjects.slice(0, 5).map(({ project, checkedPaths }) => {
		const lastSeen = project.updatedAt ? `, last seen ${project.updatedAt}` : "";
		const checked = checkedPaths.length > 1 ? `; checked ${checkedPaths.join(", ")}` : "";
		return `! Missing known project: ${project.realPath ?? project.path} (${compactCount(project.packages.length, "package")}${lastSeen}${checked})`;
	});
	const commandCounts = countBy(data.commands, (command) => command.source);
	const activeToolNames = new Set(data.activeTools);
	const activeTools = data.tools.filter((tool) => activeToolNames.has(tool.name));
	const toolSourceCounts = countBy(data.tools, (tool) => tool.sourceInfo.source);
	const activeToolSourceCounts = countBy(activeTools, (tool) => tool.sourceInfo.source);
	const runtimeNotes = [
		...duplicateNameLines("slash command", data.commands, (command) => `/${command.name}`, (command) => `${command.source}:${command.sourceInfo.path}`),
		...duplicateNameLines("tool", data.tools, (tool) => tool.name, (tool) => `${tool.sourceInfo.source}:${tool.sourceInfo.path}`),
	];
	const packageLines = await Promise.all(inventory.packageDeclarations.map((pkg) => packageDeclarationLine(pkg, dirname(inventory.paths.projectSettingsPath))));
	const managedLines = inventory.managedItems.map((item) => {
		const enabled = item.enabled === undefined ? "unknown" : item.enabled ? "enabled" : "disabled";
		const source = item.source ? ` — ${item.source}` : "";
		const drift = item.drift ? ` [drift: ${item.drift}]` : "";
		return `- ${item.id} (${item.kind}, ${enabled})${source}${drift}`;
	});
	const directResourceLines = directResourceKinds.flatMap((kind) => {
		const resources = inventory.directResources.resources.filter((resource) => resource.kind === kind);
		return [`${resourcePlural(kind)}: ${resources.length}`, ...formatList(resources.map(directResourceLine), `no project ${resourcePlural(kind)}`)];
	});

	return [
		"Construct status details",
		"========================",
		`Target cwd: ${inventory.paths.cwd}`,
		inventory.paths.realCwd === inventory.paths.cwd ? undefined : `Canonical cwd: ${inventory.paths.realCwd}`,
		`Mode: ${data.mode}`,
		`UI available: ${data.hasUI ? "yes" : "no"}`,
		`Project trusted: ${data.trusted ? "yes" : "no"}`,
		...argumentWarnings.map((warning) => `! ${warning}`),
		"",
		"User Construct state",
		"--------------------",
		"Load writes: user library and selected .pi/construct.json metadata only",
		`Construct library: ${describeRead(inventory.reads.userCatalog)}`,
		`Known-project index: ${describeRead(inventory.reads.userProjects)}`,
		`Library items: ${inventory.catalog.data.items.length}`,
		...formatList(catalogPreview, "no library preview"),
		`Saved loadouts: ${inventory.catalog.data.profiles.length}`,
		...formatList(profilePreview, "no saved loadouts"),
		...inventory.catalog.warnings.map((warning) => `! ${warning}`),
		`Known projects: ${inventory.knownProjects.data.projects.length}`,
		...formatList(knownProjectPreview, "no known projects indexed"),
		missingKnownProjects.length > 0 ? `Known-project missing paths: ${missingKnownProjects.length} (not pruned automatically)` : undefined,
		...missingKnownProjectPreview,
		missingKnownProjects.length > missingKnownProjectPreview.length ? `! …and ${missingKnownProjects.length - missingKnownProjectPreview.length} more missing known-project paths` : undefined,
		...inventory.knownProjects.warnings.map((warning) => `! ${warning}`),
		"",
		"Project Pi state",
		"----------------",
		`Project settings: ${describeRead(inventory.reads.projectSettings)}`,
		`Package declarations: ${inventory.packageDeclarations.length}`,
		...formatList(packageLines, "no project packages declared"),
		`Construct metadata: ${describeRead(inventory.reads.projectConstruct)}`,
		`Construct-managed items: ${inventory.managedItems.length}`,
		...formatList(managedLines, "no Construct-managed items"),
		`Direct project resources: ${inventory.directResources.resources.length}`,
		...directResourceLines,
		...inventory.directResources.warnings.map((warning) => `! ${warning}`),
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
