import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

type JsonReadResult =
	| { state: "missing"; path: string }
	| { state: "invalid"; path: string; error: string }
	| { state: "ok"; path: string; data: unknown };

interface ConstructPaths {
	cwd: string;
	realCwd: string;
	constructDir: string;
	userSettingsPath: string;
	userCatalogPath: string;
	userSkipsPath: string;
	projectSettingsPath: string;
	projectConstructPath: string;
}

interface CatalogItem {
	id: string;
	name?: string;
	kind: "package";
	source: string;
	description?: string;
}

interface CatalogData {
	version: 1;
	items: CatalogItem[];
}

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

async function getPaths(ctx: ExtensionCommandContext): Promise<ConstructPaths> {
	const cwd = ctx.cwd;
	const realCwd = await realpath(cwd).catch(() => cwd);
	const agentDir = join(homedir(), ".pi", "agent");
	const constructDir = join(agentDir, "construct");
	return {
		cwd,
		realCwd,
		constructDir,
		userSettingsPath: join(constructDir, "settings.json"),
		userCatalogPath: join(constructDir, "catalog.json"),
		userSkipsPath: join(constructDir, "skips.json"),
		projectSettingsPath: join(cwd, ".pi", "settings.json"),
		projectConstructPath: join(cwd, ".pi", "construct.json"),
	};
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

async function writeJson(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function describeRead(result: JsonReadResult): string {
	if (result.state === "ok") return `present: ${result.path}`;
	if (result.state === "missing") return `missing: ${result.path}`;
	return `invalid: ${result.path} (${result.error})`;
}

function parseCatalog(catalog: JsonReadResult): { data: CatalogData; warnings: string[] } {
	const warnings: string[] = [];
	if (catalog.state === "missing") return { data: { version: 1, items: [] }, warnings };
	if (catalog.state === "invalid") {
		warnings.push(`Catalog is invalid JSON: ${catalog.error}`);
		return { data: { version: 1, items: [] }, warnings };
	}
	if (!isObject(catalog.data)) {
		warnings.push("Catalog JSON is not an object.");
		return { data: { version: 1, items: [] }, warnings };
	}
	if (catalog.data.version !== 1) warnings.push("Catalog version is missing or not 1; preserving only valid MVP package items.");
	if (!Array.isArray(catalog.data.items)) {
		warnings.push("Catalog items is missing or not an array.");
		return { data: { version: 1, items: [] }, warnings };
	}

	const items: CatalogItem[] = [];
	for (const [index, item] of catalog.data.items.entries()) {
		if (!isObject(item)) {
			warnings.push(`Catalog item ${index} is not an object; ignored.`);
			continue;
		}
		if (item.kind !== "package") {
			warnings.push(`Catalog item ${index} is not kind=package; ignored for MVP.`);
			continue;
		}
		if (typeof item.id !== "string" || !item.id.trim()) {
			warnings.push(`Catalog item ${index} has no id; ignored.`);
			continue;
		}
		if (typeof item.source !== "string" || !item.source.trim()) {
			warnings.push(`Catalog item ${item.id} has no source; ignored.`);
			continue;
		}
		items.push({
			id: item.id.trim(),
			name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined,
			kind: "package",
			source: item.source.trim(),
			description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined,
		});
	}
	return { data: { version: 1, items }, warnings };
}

function deriveId(source: string): string {
	const withoutProtocol = source
		.replace(/^npm:/, "")
		.replace(/^git:/, "")
		.replace(/^https?:\/\//, "")
		.replace(/^ssh:\/\//, "");
	const id = withoutProtocol
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return id || "package";
}

function uniqueId(baseId: string, items: CatalogItem[]): string {
	const existing = new Set(items.map((item) => item.id));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
}

function findCatalogItem(items: CatalogItem[], query: string): CatalogItem | undefined {
	return items.find((item) => item.id === query || item.source === query || item.name === query);
}

function looksLikePackageSource(value: string): boolean {
	return (
		value.startsWith("npm:") ||
		value.startsWith("git:") ||
		value.startsWith("https://") ||
		value.startsWith("http://") ||
		value.startsWith("ssh://") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith("/") ||
		value.startsWith("~")
	);
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

function formatCatalogItem(item: CatalogItem): string {
	const name = item.name ? ` (${item.name})` : "";
	const description = item.description ? ` — ${item.description}` : "";
	return `- ${item.id}${name}: ${item.source}${description}`;
}

async function buildStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const paths = await getPaths(ctx);
	const [userSettings, userCatalog, userSkips, projectSettings, projectConstruct] = await Promise.all([
		readJson(paths.userSettingsPath),
		readJson(paths.userCatalogPath),
		readJson(paths.userSkipsPath),
		readJson(paths.projectSettingsPath),
		readJson(paths.projectConstructPath),
	]);

	const autoload = getAutoload(userSettings);
	const catalog = parseCatalog(userCatalog);
	const catalogPreview = catalog.data.items.slice(0, 5).map(formatCatalogItem);
	const skippedHere = getSkippedHere(userSkips, paths.cwd, paths.realCwd);
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
		`Settings: ${describeRead(userSettings)}`,
		`Autoload: ${autoload.note}`,
		`Catalog: ${describeRead(userCatalog)}`,
		`Catalog items: ${catalog.data.items.length}`,
		...formatList(catalogPreview, "no catalog preview"),
		...catalog.warnings.map((warning) => `! ${warning}`),
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

async function loadCatalog(ctx: ExtensionCommandContext): Promise<{ paths: ConstructPaths; read: JsonReadResult; catalog: CatalogData; warnings: string[] }> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userCatalogPath);
	const { data, warnings } = parseCatalog(read);
	return { paths, read, catalog: data, warnings };
}

async function handleCatalog(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, read, catalog, warnings } = await loadCatalog(ctx);
	const { command, rest } = splitArgs(args);

	if (command === "status" || command === "list") {
		showText(
			ctx,
			[
				"Construct catalog",
				"=================",
				`Path: ${paths.userCatalogPath}`,
				`State: ${describeRead(read)}`,
				`Items: ${catalog.items.length}`,
				...formatList(catalog.items.map(formatCatalogItem), "catalog is empty"),
				...warnings.map((warning) => `! ${warning}`),
				"",
				"Commands:",
				"- /construct catalog add <source> [id]",
				"- /construct catalog remove <id-or-source>",
			].join("\n"),
		);
		return;
	}

	if (command === "add") {
		const [source, requestedId] = rest.split(/\s+/).filter(Boolean);
		if (!source) {
			showText(ctx, "Usage: /construct catalog add <source> [id]");
			return;
		}
		if (catalog.items.some((item) => item.source === source)) {
			showText(ctx, `Catalog already contains source: ${source}`);
			return;
		}
		const id = uniqueId(requestedId || deriveId(source), catalog.items);
		const next: CatalogData = {
			version: 1,
			items: [...catalog.items, { id, kind: "package", source }].sort((a, b) => a.id.localeCompare(b.id)),
		};
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Added catalog item:`, formatCatalogItem({ id, kind: "package", source }), `Path: ${paths.userCatalogPath}`].join("\n"));
		return;
	}

	if (command === "remove" || command === "rm") {
		const query = rest.trim();
		if (!query) {
			showText(ctx, "Usage: /construct catalog remove <id-or-source>");
			return;
		}
		const existing = findCatalogItem(catalog.items, query);
		if (!existing) {
			showText(ctx, `Catalog item not found: ${query}`);
			return;
		}
		const next: CatalogData = { version: 1, items: catalog.items.filter((item) => item !== existing) };
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Removed catalog item:`, formatCatalogItem(existing), `Path: ${paths.userCatalogPath}`].join("\n"));
		return;
	}

	showText(
		ctx,
		[
			`Unknown /construct catalog subcommand: ${command}`,
			"",
			"Try:",
			"- /construct catalog",
			"- /construct catalog add <source> [id]",
			"- /construct catalog remove <id-or-source>",
		].join("\n"),
	);
}

async function resolveLoadSource(args: string, ctx: ExtensionCommandContext): Promise<{ source?: string; item?: CatalogItem; warnings: string[] }> {
	const { catalog, warnings } = await loadCatalog(ctx);
	const query = args.trim();
	if (query) {
		const item = findCatalogItem(catalog.items, query);
		return item ? { source: item.source, item, warnings } : { source: query, warnings };
	}

	if (catalog.items.length === 0) return { warnings };
	if (!ctx.hasUI) return { warnings };

	const choices = [...catalog.items.map((item) => `${item.id}: ${item.source}`), "Enter source manually", "Cancel"];
	const selected = await ctx.ui.select("Load into this project", choices);
	if (!selected || selected === "Cancel") return { warnings };
	if (selected === "Enter source manually") {
		const source = await ctx.ui.input("Pi package source", "npm:@scope/package");
		return source?.trim() ? { source: source.trim(), warnings } : { warnings };
	}
	const id = selected.split(":", 1)[0];
	const item = catalog.items.find((candidate) => candidate.id === id);
	return item ? { source: item.source, item, warnings } : { warnings };
}

async function handleLoad(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const resolved = await resolveLoadSource(args, ctx);

	if (!resolved.source) {
		showText(
			ctx,
			[
				"No package source selected.",
				"",
				"Try:",
				"- /construct load npm:@scope/package",
				"- /construct catalog add npm:@scope/package",
				"- /construct load <catalog-id>",
			].join("\n"),
		);
		return;
	}

	const warnings = [...resolved.warnings];
	if (!looksLikePackageSource(resolved.source)) {
		warnings.push("Source does not look like an npm:, git:, URL, or local path package source. Pi may still reject or accept it.");
	}

	showText(
		ctx,
		[
			"Construct load dry-run",
			"======================",
			"No files were changed and no package was installed.",
			"",
			`Target: ${paths.cwd}`,
			paths.realCwd === paths.cwd ? undefined : `Canonical target: ${paths.realCwd}`,
			"Target rule: ctx.cwd (MVP; no git-root guessing)",
			"",
			"Would update:",
			`- ${paths.projectSettingsPath}`,
			`- ${paths.projectConstructPath}`,
			"",
			resolved.item ? `Catalog item: ${resolved.item.id}` : "Catalog item: <ad hoc source>",
			`Package source: ${resolved.source}`,
			"",
			"Equivalent Pi command:",
			`pi install ${resolved.source} -l --approve`,
			"",
			"Next phase will run the Pi command, write Construct metadata, and offer reload.",
			...warnings.map((warning) => `! ${warning}`),
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
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
			`/construct ${subcommand} is planned but not implemented yet.`,
			"",
			"Implemented now:",
			"- /construct",
			"- /construct status",
			"- /construct catalog",
			"- /construct catalog add <source> [id]",
			"- /construct catalog remove <id-or-source>",
			"- /construct load [source-or-catalog-id] (dry-run)",
			"",
			"Next phases add actual package load, enable/disable/remove, and autoload auto-offer.",
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

			if (command === "status") {
				showText(ctx, await buildStatus(pi, ctx));
				return;
			}

			if (command === "catalog") {
				await handleCatalog(rest, ctx);
				return;
			}

			if (command === "load") {
				await handleLoad(rest, ctx);
				return;
			}

			if (["enable", "disable", "remove", "autoload", "reload"].includes(command)) {
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
					"- /construct catalog",
					"- /construct load <source-or-catalog-id>",
				].join("\n"),
			);
		},
	});
}
