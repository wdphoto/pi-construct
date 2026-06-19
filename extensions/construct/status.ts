import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatCatalogItem, normalizeSourceForLibrary, parseCatalog } from "./catalog.js";
import { describeRead, isObject, readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { formatList, getManagedItems, getPackages } from "./project-settings.js";

interface StatusData {
	paths: Awaited<ReturnType<typeof getPaths>>;
	userCatalog: Awaited<ReturnType<typeof readJson>>;
	userSettings: Awaited<ReturnType<typeof readJson>>;
	projectSettings: Awaited<ReturnType<typeof readJson>>;
	projectConstruct: Awaited<ReturnType<typeof readJson>>;
	catalog: ReturnType<typeof parseCatalog>;
	packages: ReturnType<typeof getPackages>;
	managed: Awaited<ReturnType<typeof getManagedItems>>;
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
	const [userCatalog, userSettings, projectSettings, projectConstruct] = await Promise.all([
		readJson(paths.userCatalogPath),
		readJson(paths.userSettingsPath),
		readJson(paths.projectSettingsPath),
		readJson(paths.projectConstructPath),
	]);

	const catalog = parseCatalog(userCatalog);
	const packages = getPackages(projectSettings);
	const packageSources = new Set<string>();
	const settingsDir = dirname(paths.projectSettingsPath);
	for (const pkg of packages) {
		packageSources.add(pkg.source);
		if (pkg.form !== "invalid") packageSources.add(await normalizeSourceForLibrary(pkg.source, settingsDir));
	}
	const managed = await getManagedItems(projectConstruct, packageSources, paths);
	return {
		paths,
		userCatalog,
		userSettings,
		projectSettings,
		projectConstruct,
		catalog,
		packages,
		managed,
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
	return "invalid JSON";
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
	const warnings = [
		...argumentWarnings,
		...data.catalog.warnings,
		...drift.map((item) => `${item.id} drift: ${item.drift}`),
		...(invalidPackages > 0 ? [`${invalidPackages} invalid package declaration${invalidPackages === 1 ? "" : "s"} in .pi/settings.json`] : []),
	];

	return [
		"Construct status",
		"================",
		`Project: ${data.paths.cwd}`,
		data.paths.realCwd === data.paths.cwd ? undefined : `Canonical: ${data.paths.realCwd}`,
		`Trust: ${data.trusted ? "trusted" : "not trusted"}`,
		"",
		"Loadout",
		"-------",
		`Library: ${compactCount(data.catalog.data.items.length, "package")} · ${compactCount(data.catalog.data.profiles.length, "profile")}`,
		`Project packages: ${data.packages.length}`,
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

function buildVerboseStatus(data: StatusData, argumentWarnings: string[]): string {
	const catalogPreview = data.catalog.data.items.slice(0, 5).map(formatCatalogItem);
	const profilePreview = data.catalog.data.profiles.slice(0, 5).map((profile) => `- ${profile.id}: ${profile.sources.length || profile.items.length} packages`);
	const commandCounts = data.commands.reduce<Record<string, number>>((acc, command) => {
		acc[command.source] = (acc[command.source] ?? 0) + 1;
		return acc;
	}, {});
	const packageLines = data.packages.map((pkg) => `- ${pkg.source} (${pkg.form})`);
	const managedLines = data.managed.map((item) => {
		const enabled = item.enabled === undefined ? "unknown" : item.enabled ? "enabled" : "disabled";
		const source = item.source ? ` — ${item.source}` : "";
		const drift = item.drift ? ` [drift: ${item.drift}]` : "";
		return `- ${item.id} (${item.kind}, ${enabled})${source}${drift}`;
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
		`Autoload: ${autoloadEnabled(data) ? "on" : "off"} (prompts on session exit)`,
		"Load writes: user library and selected .pi/construct.json metadata only",
		`Construct library: ${describeRead(data.userCatalog)}`,
		`Construct settings: ${describeRead(data.userSettings)}`,
		`Library items: ${data.catalog.data.items.length}`,
		...formatList(catalogPreview, "no library preview"),
		`Profiles: ${data.catalog.data.profiles.length}`,
		...formatList(profilePreview, "no profiles saved"),
		...data.catalog.warnings.map((warning) => `! ${warning}`),
		"",
		"Project Pi state",
		"----------------",
		`Project settings: ${describeRead(data.projectSettings)}`,
		`Package declarations: ${data.packages.length}`,
		...formatList(packageLines, "no project packages declared"),
		`Construct metadata: ${describeRead(data.projectConstruct)}`,
		`Construct-managed items: ${data.managed.length}`,
		...formatList(managedLines, "no Construct-managed items"),
		"",
		"Runtime inventory",
		"-----------------",
		`Slash commands: ${data.commands.length} (extension ${commandCounts.extension ?? 0}, prompt ${commandCounts.prompt ?? 0}, skill ${commandCounts.skill ?? 0})`,
		`Tools: ${data.activeTools.length}/${data.tools.length} active`,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function buildStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext, args = ""): Promise<string> {
	const mode = parseStatusMode(args);
	const data = await collectStatusData(pi, ctx);
	return mode.verbose ? buildVerboseStatus(data, mode.warnings) : buildCompactStatus(data, mode.warnings);
}
