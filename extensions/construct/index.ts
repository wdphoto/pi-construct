import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

async function getPaths(ctx: Pick<ExtensionCommandContext, "cwd">): Promise<ConstructPaths> {
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
	let candidate = source.trim().replace(/\/+$/, "");
	if (candidate.startsWith("npm:")) {
		candidate = candidate.slice(4);
		const versionAt = candidate.lastIndexOf("@");
		if (versionAt > 0) candidate = candidate.slice(0, versionAt);
	} else if (
		candidate.startsWith("/") ||
		candidate.startsWith("./") ||
		candidate.startsWith("../") ||
		candidate.startsWith("~")
	) {
		candidate = candidate.split("/").filter(Boolean).at(-1) ?? candidate;
	} else {
		candidate = candidate
			.replace(/^git:/, "")
			.replace(/^https?:\/\//, "")
			.replace(/^ssh:\/\//, "")
			.replace(/\.git$/, "");
		const refAt = candidate.lastIndexOf("@");
		if (refAt > candidate.lastIndexOf("/")) candidate = candidate.slice(0, refAt);
		const parts = candidate.split(/[/:]/).filter(Boolean);
		candidate = parts.at(-1) ?? candidate;
	}
	const id = candidate
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

function timestampForFile(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

async function backupProjectSettingsIfPresent(paths: ConstructPaths): Promise<string | undefined> {
	if (!existsSync(paths.projectSettingsPath)) return undefined;
	const backupPath = `${paths.projectSettingsPath}.bak.${timestampForFile()}`;
	await copyFile(paths.projectSettingsPath, backupPath);
	return backupPath;
}

function parseProjectConstruct(construct: JsonReadResult): JsonObject {
	if (construct.state === "missing") {
		return { version: 1, managedBy: "the-construct", items: {} };
	}
	if (construct.state === "invalid") {
		throw new Error(`Cannot update invalid Construct metadata: ${construct.error}`);
	}
	if (!isObject(construct.data)) {
		throw new Error("Cannot update Construct metadata because .pi/construct.json is not an object.");
	}
	return { ...construct.data };
}

function upsertConstructItem(
	construct: JsonObject,
	itemId: string,
	declaredSource: string,
	requestedSource: string,
	paths: ConstructPaths,
): JsonObject {
	const existingItems = isObject(construct.items) ? construct.items : {};
	const now = new Date().toISOString();
	const existingItem = isObject(existingItems[itemId]) ? existingItems[itemId] : {};
	return {
		...construct,
		version: 1,
		managedBy: "the-construct",
		loadedAt: typeof construct.loadedAt === "string" ? construct.loadedAt : now,
		targetCwd: paths.realCwd,
		items: {
			...existingItems,
			[itemId]: {
				...existingItem,
				kind: "package",
				source: declaredSource,
				...(declaredSource === requestedSource ? {} : { requestedSource }),
				enabled: true,
				loadedAt: typeof existingItem.loadedAt === "string" ? existingItem.loadedAt : now,
				updatedAt: now,
			},
		},
	};
}

function uniqueManagedId(baseId: string, construct: JsonReadResult, source: string): string {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return baseId;
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (isObject(value) && (value.source === source || value.requestedSource === source)) return id;
	}
	const existing = new Set(Object.keys(construct.data.items));
	if (!existing.has(baseId)) return baseId;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseId}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseId}-${Date.now()}`;
}

function chooseDeclaredSource(before: PackageDeclarationSummary[], after: PackageDeclarationSummary[], requestedSource: string): string {
	if (after.some((pkg) => pkg.source === requestedSource)) return requestedSource;
	const beforeSources = new Set(before.map((pkg) => pkg.source));
	const added = after.filter((pkg) => !beforeSources.has(pkg.source));
	if (added.length > 0) return added.at(-1)?.source ?? requestedSource;
	return after.at(-1)?.source ?? requestedSource;
}

function parseLoadFlags(args: string): { dryRun: boolean; query: string } {
	const tokens = args.split(/\s+/).filter(Boolean);
	const remaining: string[] = [];
	let dryRun = false;
	for (const token of tokens) {
		if (token === "--dry-run" || token === "-n") dryRun = true;
		else remaining.push(token);
	}
	return { dryRun, query: remaining.join(" ") };
}

function buildLoadPreview(paths: ConstructPaths, source: string, item: CatalogItem | undefined, warnings: string[], dryRun: boolean): string {
	return [
		dryRun ? "Construct load dry-run" : "Construct load",
		dryRun ? "======================" : "==============",
		dryRun ? "No files were changed and no package was installed." : "This will install a Pi package project-locally.",
		"",
		`Target: ${paths.cwd}`,
		paths.realCwd === paths.cwd ? undefined : `Canonical target: ${paths.realCwd}`,
		"Target rule: ctx.cwd (MVP; no git-root guessing)",
		"",
		dryRun ? "Would update:" : "Will update:",
		`- ${paths.projectSettingsPath}`,
		`- ${paths.projectConstructPath}`,
		"",
		item ? `Library item: ${item.id}` : "Library item: <ad hoc source>",
		`Package source: ${source}`,
		"",
		"Equivalent Pi command:",
		`pi install ${source} -l --approve`,
		"",
		...warnings.map((warning) => `! ${warning}`),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
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
		`Construct library: ${describeRead(userCatalog)}`,
		`Library items: ${catalog.data.items.length}`,
		...formatList(catalogPreview, "no library preview"),
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

async function syncProjectPackagesToCatalog(ctx: ExtensionCommandContext): Promise<{ added: CatalogItem[]; warnings: string[] }> {
	const paths = await getPaths(ctx);
	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		return { added: [], warnings: [`Skipped Construct library sync because catalog JSON is invalid: ${catalogRead.error}`] };
	}

	const { data: catalog, warnings } = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && warnings.length > 0) {
		return { added: [], warnings: [`Skipped Construct library sync because catalog has warnings; fix ${paths.userCatalogPath} first.`, ...warnings] };
	}

	const projectSettings = await readJson(paths.projectSettingsPath);
	const sources = getPackages(projectSettings)
		.filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.source.trim())
		.map((pkg) => pkg.source.trim());
	const existingSources = new Set(catalog.items.map((item) => item.source));
	const nextItems = [...catalog.items];
	const added: CatalogItem[] = [];
	for (const source of sources) {
		if (existingSources.has(source)) continue;
		const item: CatalogItem = { id: uniqueId(deriveId(source), nextItems), kind: "package", source };
		nextItems.push(item);
		added.push(item);
		existingSources.add(source);
	}

	if (added.length > 0) {
		await writeJson(paths.userCatalogPath, { version: 1, items: nextItems.sort((a, b) => a.id.localeCompare(b.id)) });
	}
	return { added, warnings };
}

function readUserSettings(settings: JsonReadResult): JsonObject {
	if (settings.state === "missing") return { version: 1 };
	if (settings.state === "invalid") throw new Error(`Cannot update invalid Construct settings: ${settings.error}`);
	if (!isObject(settings.data)) throw new Error("Cannot update Construct settings because settings.json is not an object.");
	return { ...settings.data };
}

async function writeAutoload(paths: ConstructPaths, enabled: boolean): Promise<void> {
	const settings = readUserSettings(await readJson(paths.userSettingsPath));
	await writeJson(paths.userSettingsPath, { ...settings, version: 1, autoload: enabled });
}

async function addSkip(paths: ConstructPaths): Promise<void> {
	const read = await readJson(paths.userSkipsPath);
	let root: JsonObject;
	if (read.state === "missing") root = { version: 1, projects: {} };
	else if (read.state === "invalid") throw new Error(`Cannot update invalid Construct skips: ${read.error}`);
	else if (isObject(read.data)) root = { ...read.data };
	else throw new Error("Cannot update Construct skips because skips.json is not an object.");

	const projects = isObject(root.projects) ? root.projects : {};
	await writeJson(paths.userSkipsPath, {
		...root,
		version: 1,
		projects: {
			...projects,
			[paths.realCwd]: {
				skippedAt: new Date().toISOString(),
				reason: "dont-ask",
			},
		},
	});
}

async function handleAutoload(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const subcommand = args.trim();
	if (!subcommand || subcommand === "status") {
		const settings = await readJson(paths.userSettingsPath);
		const autoload = getAutoload(settings);
		showText(
			ctx,
			[
				"Construct autoload",
				"==================",
				`Autoload: ${autoload.note}`,
				`Settings: ${describeRead(settings)}`,
				"",
				"Autoload means auto-offer only. It never installs packages by itself.",
				"Use /construct autoload on or /construct autoload off.",
			].join("\n"),
		);
		return;
	}
	if (subcommand !== "on" && subcommand !== "off") {
		showText(ctx, "Usage: /construct autoload on|off");
		return;
	}
	try {
		await writeAutoload(paths, subcommand === "on");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not update autoload settings.\n${message}`);
		return;
	}
	showText(
		ctx,
		[
			`Construct autoload ${subcommand === "on" ? "enabled" : "disabled"}.`,
			`Settings: ${paths.userSettingsPath}`,
			"Autoload means auto-offer only. It will not install anything automatically.",
		].join("\n"),
	);
}

async function handleCatalog(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, read, catalog, warnings } = await loadCatalog(ctx);
	const { command, rest } = splitArgs(args);

	if (command === "status" || command === "list") {
		showText(
			ctx,
			[
				"Construct library",
				"=================",
				`Path: ${paths.userCatalogPath}`,
				`State: ${describeRead(read)}`,
				`Items: ${catalog.items.length}`,
				...formatList(catalog.items.map(formatCatalogItem), "library is empty"),
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
			showText(ctx, `Construct library already contains source: ${source}`);
			return;
		}
		const id = uniqueId(requestedId || deriveId(source), catalog.items);
		const item: CatalogItem = { id, kind: "package", source };
		const next: CatalogData = {
			version: 1,
			items: [...catalog.items, item].sort((a, b) => a.id.localeCompare(b.id)),
		};
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Added library item:`, formatCatalogItem(item), `Path: ${paths.userCatalogPath}`].join("\n"));
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
			showText(ctx, `Library item not found: ${query}`);
			return;
		}
		const next: CatalogData = { version: 1, items: catalog.items.filter((item) => item !== existing) };
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Removed library item:`, formatCatalogItem(existing), `Path: ${paths.userCatalogPath}`].join("\n"));
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

	if (!ctx.hasUI) return { warnings };
	if (catalog.items.length === 0) {
		const choices = ["Enter source manually", "Cancel"];
		const selected = await ctx.ui.select("Your Construct library is empty", choices);
		if (!selected || selected === "Cancel") return { warnings };
		const source = await ctx.ui.input("Pi package source", "npm:@scope/package");
		return source?.trim() ? { source: source.trim(), warnings } : { warnings };
	}

	const choiceToItem = new Map(catalog.items.map((item) => [`${item.id}: ${item.source}`, item]));
	const choices = [...choiceToItem.keys(), "Enter source manually", "Cancel"];
	const selected = await ctx.ui.select("Load into this project", choices);
	if (!selected || selected === "Cancel") return { warnings };
	if (selected === "Enter source manually") {
		const source = await ctx.ui.input("Pi package source", "npm:@scope/package");
		return source?.trim() ? { source: source.trim(), warnings } : { warnings };
	}
	const item = choiceToItem.get(selected);
	return item
		? { source: item.source, item, warnings }
		: { warnings: [...warnings, `Could not resolve selected library item: ${selected}`] };
}

async function handleLoad(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const flags = parseLoadFlags(args);
	const sync = flags.dryRun ? { added: [], warnings: [] } : await syncProjectPackagesToCatalog(ctx);
	const resolved = await resolveLoadSource(flags.query, ctx);

	if (!resolved.source) {
		showText(
			ctx,
			[
				"No package source selected.",
				"",
				"Try:",
				"- /construct load npm:@scope/package",
				"- /construct load --dry-run npm:@scope/package",
				"- /construct catalog add npm:@scope/package",
				"- /construct load <library-id>",
			].join("\n"),
		);
		return;
	}

	const warnings = [...sync.warnings, ...resolved.warnings];
	if (!looksLikePackageSource(resolved.source)) {
		warnings.push("Source does not look like an npm:, git:, URL, or local path package source. Pi may still reject or accept it.");
	}

	const preview = buildLoadPreview(paths, resolved.source, resolved.item, warnings, flags.dryRun);
	if (flags.dryRun) {
		showText(ctx, preview);
		return;
	}

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Load into this project?", preview);
		if (!ok) {
			showText(ctx, "Construct load cancelled. No files were changed by Construct.");
			return;
		}
	}

	const constructRead = await readJson(paths.projectConstructPath);
	try {
		parseProjectConstruct(constructRead);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Cannot load package until Construct metadata is fixed.\n${message}`);
		return;
	}

	const beforePackages = getPackages(await readJson(paths.projectSettingsPath));

	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not back up .pi/settings.json; aborting load.\n${message}`);
		return;
	}

	showText(ctx, [`Loading package project-locally...`, `Source: ${resolved.source}`, backupPath ? `Backup: ${backupPath}` : "Backup: none (.pi/settings.json did not exist)"].join("\n"));

	const install = await pi.exec("pi", ["install", resolved.source, "-l", "--approve"], { timeout: 120_000 });
	if (install.code !== 0) {
		showText(
			ctx,
			[
				"Construct load failed during Pi package install.",
				`Command: pi install ${resolved.source} -l --approve`,
				`Exit code: ${install.code}`,
				backupPath ? `Settings backup: ${backupPath}` : undefined,
				install.stdout ? `\nstdout:\n${install.stdout}` : undefined,
				install.stderr ? `\nstderr:\n${install.stderr}` : undefined,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	const afterPackages = getPackages(await readJson(paths.projectSettingsPath));
	const declaredSource = chooseDeclaredSource(beforePackages, afterPackages, resolved.source);
	const itemId = uniqueManagedId(resolved.item?.id ?? deriveId(resolved.source), constructRead, declaredSource);
	try {
		const construct = upsertConstructItem(parseProjectConstruct(constructRead), itemId, declaredSource, resolved.source, paths);
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(
			ctx,
			[
				"Package installed, but Construct metadata update failed.",
				`Source: ${resolved.source}`,
				`Metadata path: ${paths.projectConstructPath}`,
				backupPath ? `Settings backup: ${backupPath}` : undefined,
				message,
			].filter((line): line is string => line !== undefined).join("\n"),
		);
		return;
	}

	let catalogMessage = sync.added.length > 0 ? `\nRemembered ${sync.added.length} existing project package(s) in the Construct library.` : "";
	if (!resolved.item && ctx.hasUI) {
		const add = await ctx.ui.confirm("Add to Construct library?", `Add ${resolved.source} to your Construct library for future projects?`);
		if (add) {
			const { paths: catalogPaths, catalog } = await loadCatalog(ctx);
			if (!catalog.items.some((item) => item.source === resolved.source)) {
				const item: CatalogItem = { id: uniqueId(deriveId(resolved.source), catalog.items), kind: "package", source: resolved.source };
				await writeJson(catalogPaths.userCatalogPath, {
					version: 1,
					items: [...catalog.items, item].sort((a, b) => a.id.localeCompare(b.id)),
				});
				catalogMessage = `${catalogMessage}\nAdded to Construct library as: ${item.id}`;
			}
		}
	} else if (!resolved.item) {
		catalogMessage = `${catalogMessage}\nTip: run /construct catalog add ${resolved.source} to reuse this source in future projects.`;
	}

	const summary = [
		"Construct load complete.",
		`Source: ${resolved.source}`,
		declaredSource === resolved.source ? undefined : `Declared package source: ${declaredSource}`,
		`Managed item: ${itemId}`,
		`Project settings: ${paths.projectSettingsPath}`,
		`Construct metadata: ${paths.projectConstructPath}`,
		backupPath ? `Settings backup: ${backupPath}` : "Settings backup: none (.pi/settings.json did not exist)",
		catalogMessage || undefined,
		install.stdout ? `\npi install stdout:\n${install.stdout}` : undefined,
		install.stderr ? `\npi install stderr:\n${install.stderr}` : undefined,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");

	if (ctx.hasUI) {
		const reload = await ctx.ui.confirm("Reload Pi resources now?", `${summary}\n\nReload so newly loaded resources are available?`);
		if (reload) {
			await ctx.reload();
			return;
		}
	}

	showText(ctx, `${summary}\n\nReload Pi resources with /construct reload or /reload.`);
}
function packageSource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry;
	if (isObject(entry) && typeof entry.source === "string") return entry.source;
	return undefined;
}

function readSettingsObject(settings: JsonReadResult): JsonObject {
	if (settings.state === "missing") return {};
	if (settings.state === "invalid") throw new Error(`Cannot edit invalid .pi/settings.json: ${settings.error}`);
	if (!isObject(settings.data)) throw new Error("Cannot edit .pi/settings.json because it is not a JSON object.");
	return { ...settings.data };
}

async function removePackageDeclaration(paths: ConstructPaths, source: string): Promise<{ removed: boolean; backupPath?: string; settingsMissing: boolean }> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "missing") return { removed: false, settingsMissing: true };

	const settings = readSettingsObject(settingsRead);
	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const nextPackages = packages.filter((entry) => packageSource(entry) !== source);
	const removed = nextPackages.length !== packages.length;
	if (!removed) return { removed: false, settingsMissing: false };

	const backupPath = await backupProjectSettingsIfPresent(paths);
	settings.packages = nextPackages;
	await writeJson(paths.projectSettingsPath, settings);
	return { removed: true, backupPath, settingsMissing: false };
}

function getManagedEntry(construct: JsonReadResult, query: string): { id: string; item: JsonObject } | undefined {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return undefined;
	for (const [id, item] of Object.entries(construct.data.items)) {
		if (!isObject(item)) continue;
		if (id === query || item.source === query || item.requestedSource === query) return { id, item };
	}
	return undefined;
}

function managedItemChoices(construct: JsonReadResult): string[] {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	return Object.entries(construct.data.items)
		.filter(([, item]) => isObject(item))
		.map(([id, item]) => {
			const source = isObject(item) && typeof item.source === "string" ? item.source : "<no source>";
			const enabled = isObject(item) && item.enabled === false ? "disabled" : "enabled";
			return `${id}: ${source} (${enabled})`;
		});
}

async function resolveManagedEntry(
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	query: string,
	action: string,
): Promise<{ construct: JsonReadResult; id?: string; item?: JsonObject }> {
	const construct = await readJson(paths.projectConstructPath);
	let resolvedQuery = query.trim();
	if (!resolvedQuery && ctx.hasUI) {
		const choices = [...managedItemChoices(construct), "Cancel"];
		if (choices.length === 1) return { construct };
		const selected = await ctx.ui.select(`Construct ${action}: choose item`, choices);
		if (!selected || selected === "Cancel") return { construct };
		resolvedQuery = selected.split(":", 1)[0];
	}
	if (!resolvedQuery) return { construct };
	const entry = getManagedEntry(construct, resolvedQuery);
	return entry ? { construct, id: entry.id, item: entry.item } : { construct };
}

function updateConstructItemEnabled(construct: JsonReadResult, id: string, enabled: boolean): JsonObject {
	const root = parseProjectConstruct(construct);
	const items = isObject(root.items) ? root.items : {};
	const item = isObject(items[id]) ? items[id] : {};
	return {
		...root,
		version: 1,
		managedBy: "the-construct",
		items: {
			...items,
			[id]: {
				...item,
				enabled,
				updatedAt: new Date().toISOString(),
			},
		},
	};
}

function removeConstructItem(construct: JsonReadResult, id: string): JsonObject {
	const root = parseProjectConstruct(construct);
	const items = isObject(root.items) ? { ...root.items } : {};
	delete items[id];
	return {
		...root,
		version: 1,
		managedBy: "the-construct",
		items,
	};
}

async function handleDisable(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "disable");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to disable.");
		return;
	}
	if (typeof item.source !== "string") {
		showText(ctx, `Cannot disable ${id}: metadata has no package source.`);
		return;
	}

	let removal: { removed: boolean; backupPath?: string; settingsMissing: boolean };
	try {
		removal = await removePackageDeclaration(paths, item.source);
		await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, id, false));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Disable failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Disabled Construct item: ${id}`,
			`Source: ${item.source}`,
			removal.removed ? `Removed package declaration from: ${paths.projectSettingsPath}` : "Package declaration was not present in .pi/settings.json.",
			removal.backupPath ? `Settings backup: ${removal.backupPath}` : undefined,
			removal.settingsMissing ? ".pi/settings.json was missing; only Construct metadata was updated." : undefined,
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

async function handleRemove(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "remove");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to remove.");
		return;
	}
	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Remove Construct item?", `Remove ${id} from this project?\n\nThis removes the package declaration and Construct metadata only. It does not delete caches or files.`);
		if (!ok) {
			showText(ctx, "Construct remove cancelled.");
			return;
		}
	}

	let removal: { removed: boolean; backupPath?: string; settingsMissing: boolean } = { removed: false, settingsMissing: false };
	try {
		if (typeof item.source === "string") removal = await removePackageDeclaration(paths, item.source);
		await writeJson(paths.projectConstructPath, removeConstructItem(construct, id));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Remove failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Removed Construct item: ${id}`,
			typeof item.source === "string" ? `Source: ${item.source}` : undefined,
			removal.removed ? `Removed package declaration from: ${paths.projectSettingsPath}` : "Package declaration was not present in .pi/settings.json.",
			removal.backupPath ? `Settings backup: ${removal.backupPath}` : undefined,
			"No package caches or files were deleted.",
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

async function handleEnable(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "enable");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to enable.");
		return;
	}
	const source = typeof item.requestedSource === "string" ? item.requestedSource : typeof item.source === "string" ? item.source : undefined;
	if (!source) {
		showText(ctx, `Cannot enable ${id}: metadata has no package source.`);
		return;
	}

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Enable Construct item?", `Enable ${id} in this project?\n\nEquivalent Pi command:\npi install ${source} -l --approve`);
		if (!ok) {
			showText(ctx, "Construct enable cancelled.");
			return;
		}
	}

	const beforePackages = getPackages(await readJson(paths.projectSettingsPath));
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not back up .pi/settings.json; aborting enable.\n${message}`);
		return;
	}

	const install = await pi.exec("pi", ["install", source, "-l", "--approve"], { timeout: 120_000 });
	if (install.code !== 0) {
		showText(
			ctx,
			[
				`Enable failed during Pi package install for ${id}.`,
				`Command: pi install ${source} -l --approve`,
				`Exit code: ${install.code}`,
				backupPath ? `Settings backup: ${backupPath}` : undefined,
				install.stdout ? `\nstdout:\n${install.stdout}` : undefined,
				install.stderr ? `\nstderr:\n${install.stderr}` : undefined,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	const afterPackages = getPackages(await readJson(paths.projectSettingsPath));
	const declaredSource = chooseDeclaredSource(beforePackages, afterPackages, source);
	try {
		const constructRoot = upsertConstructItem(parseProjectConstruct(construct), id, declaredSource, source, paths);
		await writeJson(paths.projectConstructPath, constructRoot);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Package enabled, but Construct metadata update failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Enabled Construct item: ${id}`,
			`Source: ${source}`,
			declaredSource === source ? undefined : `Declared package source: ${declaredSource}`,
			backupPath ? `Settings backup: ${backupPath}` : "Settings backup: none (.pi/settings.json did not exist)",
			install.stdout ? `\npi install stdout:\n${install.stdout}` : undefined,
			install.stderr ? `\npi install stderr:\n${install.stderr}` : undefined,
			"Reload Pi resources with /construct reload or /reload.",
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
			"- /construct load [source-or-library-id]",
			"",
			"Next phase adds autoload auto-offer.",
		].join("\n"),
	);
}

async function maybeOfferAutoload(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	if (!ctx.isProjectTrusted()) return;

	const paths = await getPaths(ctx);
	if (existsSync(paths.projectConstructPath)) return;

	const [settingsRead, catalogRead, skipsRead] = await Promise.all([
		readJson(paths.userSettingsPath),
		readJson(paths.userCatalogPath),
		readJson(paths.userSkipsPath),
	]);
	const autoload = getAutoload(settingsRead);
	if (!autoload.enabled) return;
	if (getSkippedHere(skipsRead, paths.cwd, paths.realCwd)) return;

	const catalog = parseCatalog(catalogRead);
	if (catalog.data.items.length === 0) return;

	const choice = await ctx.ui.select("Load it into the Construct?", ["yes", "not now", "don't ask for this project"]);
	if (choice === "yes") {
		pi.sendUserMessage("/construct load");
		return;
	}
	if (choice === "don't ask for this project") {
		try {
			await addSkip(paths);
			ctx.ui.notify("Construct will not auto-offer in this project again.", "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Could not save Construct skip: ${message}`, "error");
		}
	}
}

export default function constructExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await maybeOfferAutoload(pi, ctx);
	});

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
				await handleLoad(rest, pi, ctx);
				return;
			}

			if (command === "enable") {
				await handleEnable(rest, pi, ctx);
				return;
			}

			if (command === "disable") {
				await handleDisable(rest, ctx);
				return;
			}

			if (command === "remove") {
				await handleRemove(rest, ctx);
				return;
			}

			if (command === "reload") {
				await ctx.reload();
				return;
			}

			if (command === "autoload") {
				await handleAutoload(rest, ctx);
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
					"- /construct load <source-or-library-id>",
				].join("\n"),
			);
		},
	});
}
