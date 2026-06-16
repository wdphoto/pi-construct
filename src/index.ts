import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

type JsonReadResult =
	| { state: "missing"; path: string }
	| { state: "invalid"; path: string; error: string }
	| { state: "ok"; path: string; data: unknown };

interface PackageDeclarationSummary {
	source: string;
	form: "string" | "object" | "invalid";
	enabled: boolean;
}

interface ManagedItemSummary {
	id: string;
	kind: string;
	source?: string;
	enabled?: boolean;
	drift?: string;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<JsonReadResult> {
	if (!existsSync(path)) return { state: "missing", path };
	try {
		const text = await readFile(path, "utf8");
		return { state: "ok", path, data: JSON.parse(text) as unknown };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { state: "invalid", path, error: message };
	}
}

function describeRead(result: JsonReadResult): string {
	if (result.state === "ok") return `present: ${result.path}`;
	if (result.state === "missing") return `missing: ${result.path}`;
	return `invalid: ${result.path} (${result.error})`;
}

function getPackages(settings: JsonReadResult): PackageDeclarationSummary[] {
	if (settings.state !== "ok" || !isObject(settings.data)) return [];
	const packages = settings.data.packages;
	if (!Array.isArray(packages)) return [];

	return packages.map((entry): PackageDeclarationSummary => {
		if (typeof entry === "string") {
			return { source: entry, form: "string", enabled: true };
		}
		if (isObject(entry) && typeof entry.source === "string") {
			return { source: entry.source, form: "object", enabled: true };
		}
		return { source: "<invalid package declaration>", form: "invalid", enabled: false };
	});
}

function getAutoload(settings: JsonReadResult): { enabled: boolean; note: string } {
	if (settings.state === "missing") return { enabled: false, note: "off (default; settings file missing)" };
	if (settings.state === "invalid") return { enabled: false, note: "off (settings file invalid)" };
	if (!isObject(settings.data)) return { enabled: false, note: "off (settings file is not an object)" };
	return settings.data.autoload === true ? { enabled: true, note: "on" } : { enabled: false, note: "off" };
}

function getCatalogCount(catalog: JsonReadResult): number {
	if (catalog.state !== "ok" || !isObject(catalog.data)) return 0;
	return Array.isArray(catalog.data.items) ? catalog.data.items.length : 0;
}

function getCatalogPreview(catalog: JsonReadResult): string[] {
	if (catalog.state !== "ok" || !isObject(catalog.data) || !Array.isArray(catalog.data.items)) return [];
	return catalog.data.items.slice(0, 5).map((item) => {
		if (!isObject(item)) return "- <invalid catalog item>";
		const id = typeof item.id === "string" ? item.id : "<no id>";
		const source = typeof item.source === "string" ? item.source : "<no source>";
		const name = typeof item.name === "string" ? ` (${item.name})` : "";
		return `- ${id}${name}: ${source}`;
	});
}

function getSkippedHere(skips: JsonReadResult, cwd: string, realCwd: string): boolean {
	if (skips.state !== "ok" || !isObject(skips.data) || !isObject(skips.data.projects)) return false;
	return isObject(skips.data.projects[cwd]) || isObject(skips.data.projects[realCwd]);
}

function getManagedItems(construct: JsonReadResult, packageSources: Set<string>): ManagedItemSummary[] {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	return Object.entries(construct.data.items).map(([id, value]) => {
		if (!isObject(value)) {
			return { id, kind: "unknown", drift: "invalid metadata" };
		}
		const kind = typeof value.kind === "string" ? value.kind : "unknown";
		const source = typeof value.source === "string" ? value.source : undefined;
		const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
		let drift: string | undefined;
		if (source) {
			const declared = packageSources.has(source);
			if (enabled === true && !declared) drift = "enabled in Construct metadata, missing from .pi/settings.json";
			if (enabled === false && declared) drift = "disabled in Construct metadata, still present in .pi/settings.json";
		}
		return { id, kind, source, enabled, drift };
	});
}

function formatList(lines: string[], empty: string): string[] {
	return lines.length > 0 ? lines : [`- ${empty}`];
}

async function buildStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const cwd = ctx.cwd;
	const realCwd = await realpath(cwd).catch(() => cwd);
	const agentDir = join(homedir(), ".pi", "agent");
	const constructDir = join(agentDir, "construct");
	const userSettingsPath = join(constructDir, "settings.json");
	const userCatalogPath = join(constructDir, "catalog.json");
	const userSkipsPath = join(constructDir, "skips.json");
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const projectConstructPath = join(cwd, ".pi", "construct.json");

	const [userSettings, userCatalog, userSkips, projectSettings, projectConstruct] = await Promise.all([
		readJson(userSettingsPath),
		readJson(userCatalogPath),
		readJson(userSkipsPath),
		readJson(projectSettingsPath),
		readJson(projectConstructPath),
	]);

	const autoload = getAutoload(userSettings);
	const catalogCount = getCatalogCount(userCatalog);
	const catalogPreview = getCatalogPreview(userCatalog);
	const skippedHere = getSkippedHere(userSkips, cwd, realCwd);
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
		`Target cwd: ${cwd}`,
		realCwd === cwd ? undefined : `Canonical cwd: ${realCwd}`,
		`Target rule: ctx.cwd (MVP; no git-root guessing)`,
		`Mode: ${ctx.mode}`,
		`UI available: ${ctx.hasUI ? "yes" : "no"}`,
		`Project trusted: ${trusted ? "yes" : "no"}`,
		"",
		"User Construct state",
		"--------------------",
		`Settings: ${describeRead(userSettings)}`,
		`Autoload: ${autoload.note}`,
		`Catalog: ${describeRead(userCatalog)}`,
		`Catalog items: ${catalogCount}`,
		...formatList(catalogPreview, "no catalog preview"),
		`Skips: ${describeRead(userSkips)}`,
		`Skipped here: ${skippedHere ? "yes" : "no"}`,
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

function splitArgs(args: string): { command: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { command: "status", rest: "" };
	const firstSpace = trimmed.search(/\s/);
	if (firstSpace === -1) return { command: trimmed, rest: "" };
	return { command: trimmed.slice(0, firstSpace), rest: trimmed.slice(firstSpace).trim() };
}

function showText(ctx: ExtensionCommandContext, text: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, "info");
		return;
	}
	if (ctx.mode === "print") {
		console.log(text);
		return;
	}
	console.error(text);
}

function planned(ctx: ExtensionCommandContext, subcommand: string): void {
	showText(
		ctx,
		[
			`/construct ${subcommand} is planned but not implemented in Phase 1.`,
			"",
			"Implemented now:",
			"- /construct",
			"- /construct status",
			"",
			"Next phases add catalog, dry-run load, package load, enable/disable/remove, and autoload auto-offer.",
		].join("\n"),
	);
}

export default function constructExtension(pi: ExtensionAPI) {
	pi.registerCommand("construct", {
		description: "Inspect and manage project-local Pi loadouts",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "load", "catalog", "enable", "disable", "remove", "autoload", "reload"];
			const matches = commands.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitArgs(args);
			void rest;

			if (command === "status") {
				showText(ctx, await buildStatus(pi, ctx));
				return;
			}

			if (["load", "catalog", "enable", "disable", "remove", "autoload", "reload"].includes(command)) {
				planned(ctx, command);
				return;
			}

			showText(
				ctx,
				[
					`Unknown /construct subcommand: ${command}`,
					"",
					"Try:",
					"- /construct status",
				].join("\n"),
			);
		},
	});
}
