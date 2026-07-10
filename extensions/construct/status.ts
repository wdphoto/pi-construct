import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatCatalogItem } from "./catalog.js";
import { describeRead } from "./json.js";
import { CONSTRUCT_TITLE } from "./metadata.js";
import { collectProjectPackageResources, type PackageResourceInventory, type PackageResourceSummary } from "./package-resources.js";
import { collectProjectInventory, type ProjectInventory } from "./project-inventory.js";
import { formatList } from "./project-settings.js";
import { missingKnownProjectEntries } from "./projects.js";
import { directResourceKinds, resourcePlural } from "./resources.js";
import { formatPackageSourceLabel, normalizeSourceForLibrary } from "./sources.js";

interface StatusData {
	inventory: ProjectInventory;
	commands: ReturnType<ExtensionAPI["getCommands"]>;
	tools: ReturnType<ExtensionAPI["getAllTools"]>;
	activeTools: ReturnType<ExtensionAPI["getActiveTools"]>;
	mode: ExtensionCommandContext["mode"];
	hasUI: boolean;
	trusted: boolean;
	packageResources?: PackageResourceInventory;
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

async function collectStatusData(pi: ExtensionAPI, ctx: ExtensionCommandContext, options: { packageResources?: boolean } = {}): Promise<StatusData> {
	const inventory = await collectProjectInventory(ctx);
	return {
		inventory,
		commands: pi.getCommands(),
		tools: pi.getAllTools(),
		activeTools: pi.getActiveTools(),
		mode: ctx.mode,
		hasUI: ctx.hasUI,
		trusted: ctx.isProjectTrusted(),
		packageResources: options.packageResources ? await collectProjectPackageResources(ctx, inventory) : undefined,
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
	const projectPackageCount = inventory.packageDeclarations.filter((pkg) => !pkg.projectOverride).length;
	const projectOverrideCount = inventory.projectOverrides.length;
	const warnings = [
		...argumentWarnings,
		...(data.trusted ? [] : ["Project is not trusted by Pi; shown project declarations are read-only and are not runtime-active until trusted."]),
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
		`Project packages: ${projectPackageCount}`,
		projectOverrideCount > 0 ? `Pi project overrides: ${projectOverrideCount} (manage with pi config -l)` : undefined,
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

function packageResourceLine(resource: PackageResourceSummary): string {
	const enabled = resource.enabled ? "enabled" : "disabled";
	return `  - ${resource.kind} ${resource.name} (${enabled}) — ${resource.packageRelativePath}`;
}

function packageResourceGroupLines(packageResources: PackageResourceInventory | undefined): string[] {
	if (!packageResources) return ["Package-contained resources: not collected"];
	const resources = packageResources.resources;
	if (resources.length === 0) return ["Package-contained resources: 0", "- no project package resources resolved"];
	const bySource = new Map<string, PackageResourceSummary[]>();
	for (const resource of resources) {
		const group = bySource.get(resource.packageSource) ?? [];
		group.push(resource);
		bySource.set(resource.packageSource, group);
	}
	const lines = [`Package-contained resources: ${resources.length} (project packages only)`];
	for (const [source, group] of [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const enabled = group.filter((resource) => resource.enabled).length;
		const disabled = group.length - enabled;
		const managed = group.some((resource) => resource.packageManaged);
		const managedId = group.find((resource) => resource.packageManagedId)?.packageManagedId;
		lines.push(`- ${formatPackageSourceLabel(source)}: ${enabled} enabled · ${disabled} disabled${managedId ? ` · managed ${managedId}` : managed ? " · managed" : " · unmanaged"}`);
		for (const kind of directResourceKinds) {
			const kindResources = group.filter((resource) => resource.kind === kind);
			if (kindResources.length === 0) continue;
			lines.push(`  ${resourcePlural(kind)}: ${kindResources.length}`);
			lines.push(...kindResources.map(packageResourceLine));
		}
	}
	return lines;
}

async function packageDeclarationLine(pkg: ProjectInventory["packageDeclarations"][number], settingsDir: string): Promise<string> {
	const details: string[] = [pkg.form];
	if (pkg.projectOverride) details.push("Pi project override, autoload false");
	if (pkg.disabledByFilters) details.push("disabled by filters");
	else if (pkg.filterState === "partially-filtered") details.push(pkg.filterDescription);
	else if (pkg.filterState === "invalid") details.push(pkg.filterDescription);
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
	const packageResourceLines = packageResourceGroupLines(data.packageResources);

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
		data.trusted ? undefined : "! Project is not trusted by Pi; raw project settings are shown for inspection only, not as runtime-active Pi state.",
		`Project settings: ${describeRead(inventory.reads.projectSettings)}`,
		`Package declarations: ${inventory.packageDeclarations.filter((pkg) => !pkg.projectOverride).length}`,
		`Pi project overrides: ${inventory.projectOverrides.length}`,
		...formatList(packageLines, "no project packages declared"),
		...packageResourceLines,
		...(data.packageResources?.warnings ?? []).map((warning) => `! ${warning}`),
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
	const data = await collectStatusData(pi, ctx, { packageResources: mode.verbose });
	return mode.verbose ? await buildVerboseStatus(data, mode.warnings) : buildCompactStatus(data, mode.warnings);
}
