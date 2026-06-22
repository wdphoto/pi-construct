import type { ExtensionCommandContext, ExtensionContext, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { formatLoadResult, loadSourcesIntoConstruct, projectLoadCandidates } from "./load.js";
import { showText, waitForIdleBeforeConstructWrite } from "../ui.js";

interface AutoloadSettings {
	enabled: boolean;
	warning?: string;
}

function parseAutoloadSetting(data: unknown): boolean {
	return isObject(data) && data.autoload === true;
}

async function readAutoloadSettings(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<AutoloadSettings> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userSettingsPath);
	if (read.state === "missing") return { enabled: false };
	if (read.state === "invalid") return { enabled: false, warning: describeJsonReadIssue("Construct settings", read) };
	if (!isObject(read.data)) return { enabled: false, warning: "Construct settings are not a JSON object." };
	return { enabled: parseAutoloadSetting(read.data) };
}

async function writeAutoloadSettings(ctx: ExtensionCommandContext, enabled: boolean): Promise<void> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userSettingsPath);
	const base = read.state === "ok" && isObject(read.data) ? read.data : {};
	await writeJson(paths.userSettingsPath, { ...base, version: 1, autoload: enabled });
}

function autoloadStatusText(settings: AutoloadSettings): string {
	return [
		`Construct autoload: ${settings.enabled ? "on" : "off"}`,
		"Autoload prompts before loading anything into Construct.",
		"On session exit, Construct checks for unloaded project resources and asks before loading them.",
		"It never installs packages, enables resources, reloads Pi, or edits .pi/settings.json.",
		settings.warning ? `! ${settings.warning}` : undefined,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

function canUseAutoloadUI(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.mode === "tui" && ctx.isProjectTrusted();
}

export async function handleAutoload(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const tokens = args.split(/\s+/).filter(Boolean);
	if (tokens.length > 1 || (tokens[0] && !["on", "off", "status"].includes(tokens[0]))) {
		showText(ctx, ["Usage: /construct autoload [on|off|status]", "", "Without an argument, autoload toggles on/off."].join("\n"));
		return;
	}

	const current = await readAutoloadSettings(ctx);
	if (tokens[0] === "status") {
		showText(ctx, autoloadStatusText(current));
		return;
	}

	const next = tokens[0] === "on" ? true : tokens[0] === "off" ? false : !current.enabled;
	await waitForIdleBeforeConstructWrite(ctx, "Construct autoload");
	await writeAutoloadSettings(ctx, next);
	showText(
		ctx,
		[
			`Construct autoload is now ${next ? "on" : "off"}.`,
			next ? "On session exit, Construct will check for unloaded project resources and ask before loading them." : "No autoload prompts will run.",
			"Autoload always requires confirmation before writing anything.",
			"It never installs packages, enables resources, reloads Pi, or edits .pi/settings.json.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function maybePromptAutoloadOnShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
	if (event.reason !== "quit") return;
	const settings = await readAutoloadSettings(ctx);
	if (!settings.enabled) return;
	if (!canUseAutoloadUI(ctx)) return;

	const paths = await getPaths(ctx);
	let candidates: Awaited<ReturnType<typeof projectLoadCandidates>>;
	try {
		candidates = await projectLoadCandidates(paths);
	} catch {
		return;
	}
	if (candidates.adoptable.length === 0) return;

	const lines = candidates.adoptable.map((candidate) => `- ${candidate.id}: ${candidate.source}${candidate.disabledByFilters ? " (currently disabled by Pi filters)" : ""}`);
	const confirmed = await ctx.ui.confirm(
		"Load project resources into Construct?",
		[
			"Construct autoload found project resources that are not in the Construct yet.",
			"",
			...lines,
			"",
			"Load these before exit?",
			"This will not install packages or edit .pi/settings.json.",
		].join("\n"),
		{ timeout: 30000 },
	);
	if (!confirmed) return;

	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "invalid") {
		ctx.ui.notify(`Construct autoload skipped: ${describeJsonReadIssue(".pi/construct.json", constructRead)}`, "warning");
		return;
	}
	const sources = candidates.adoptable.map((candidate) => candidate.source);
	const enabledBySource = new Map(candidates.adoptable.map((candidate) => [candidate.source, !candidate.disabledByFilters]));
	try {
		const result = await loadSourcesIntoConstruct(ctx, paths, sources, { enabledBySource });
		ctx.ui.notify(`Construct autoload loaded ${result.added.length} resource${result.added.length === 1 ? "" : "s"}.`, result.warnings.length > 0 ? "warning" : "info");
		if (result.warnings.length > 0) ctx.ui.notify(formatLoadResult(result), "warning");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Construct autoload failed: ${message}`, "warning");
	}
}
