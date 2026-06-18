import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatCatalogItem, loadCatalog, parseCatalog } from "./catalog.js";
import { describeRead, readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { formatList, getManagedItems, getPackages } from "./project-settings.js";

export async function buildStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const paths = await getPaths(ctx);
	const [userCatalog, projectSettings, projectConstruct] = await Promise.all([
		readJson(paths.userCatalogPath),
		readJson(paths.projectSettingsPath),
		readJson(paths.projectConstructPath),
	]);

	const catalog = parseCatalog(userCatalog);
	const catalogPreview = catalog.data.items.slice(0, 5).map(formatCatalogItem);
	const packages = getPackages(projectSettings);
	const packageSources = new Set(packages.map((pkg) => pkg.source));
	const managed = getManagedItems(projectConstruct, packageSources);
	const commands = pi.getCommands();
	const tools = pi.getAllTools();
	const activeTools = pi.getActiveTools();
	const commandCounts = commands.reduce<Record<string, number>>((acc, command) => {
		acc[command.source] = (acc[command.source] ?? 0) + 1;
		return acc;
	}, {});
	const trusted = ctx.isProjectTrusted();

	const packageLines = packages.map((pkg) => `- ${pkg.source} (${pkg.form})`);
	const managedLines = managed.map((item) => {
		const enabled = item.enabled === undefined ? "unknown" : item.enabled ? "enabled" : "disabled";
		const source = item.source ? ` — ${item.source}` : "";
		const drift = item.drift ? ` [drift: ${item.drift}]` : "";
		return `- ${item.id} (${item.kind}, ${enabled})${source}${drift}`;
	});

	return [
		"Construct status",
		"================",
		`Target cwd: ${paths.cwd}`,
		paths.realCwd === paths.cwd ? undefined : `Canonical cwd: ${paths.realCwd}`,
		`Target rule: ctx.cwd (MVP; no git-root guessing)`,
		`Mode: ${ctx.mode}`,
		`UI available: ${ctx.hasUI ? "yes" : "no"}`,
		`Project trusted: ${trusted ? "yes" : "no"}`,
		"",
		"User Construct state",
		"--------------------",
		"Automatic sync: off (manual; use /construct sync)",
		`Construct library: ${describeRead(userCatalog)}`,
		`Library items: ${catalog.data.items.length}`,
		...formatList(catalogPreview, "no library preview"),
		...catalog.warnings.map((warning) => `! ${warning}`),
		"",
		"Project Pi state",
		"----------------",
		`Project settings: ${describeRead(projectSettings)}`,
		`Package declarations: ${packages.length}`,
		...formatList(packageLines, "no project packages declared"),
		`Construct metadata: ${describeRead(projectConstruct)}`,
		`Construct-managed items: ${managed.length}`,
		...formatList(managedLines, "no Construct-managed items"),
		"",
		"Runtime inventory",
		"-----------------",
		`Slash commands: ${commands.length} (extension ${commandCounts.extension ?? 0}, prompt ${commandCounts.prompt ?? 0}, skill ${commandCounts.skill ?? 0})`,
		`Tools: ${activeTools.length}/${tools.length} active`,
		"",
		"Notes",
		"-----",
		"- Status is read-only; no files were changed.",
		"- .pi/settings.json is Pi's source of truth; Construct metadata is advisory.",
		"- Drift checks use exact source strings only in this MVP skeleton.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}
