import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { ExtensionCommandContext, ExtensionContext, SessionShutdownEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { formatLoadResult, loadSourcesIntoConstruct, projectLoadCandidates } from "./load.js";
import { showText, waitForIdleBeforeConstructWrite } from "../ui.js";

interface AutoloadSettings {
	enabled: boolean;
	warning?: string;
}

interface AutoloadWatcherState {
	watcher?: FSWatcher;
	debounce?: NodeJS.Timeout;
	disposed: boolean;
	promptInFlight: boolean;
	seenSources: Set<string>;
}

let activeWatcher: AutoloadWatcherState | undefined;

function parseAutoloadSetting(data: unknown): boolean {
	return isObject(data) && data.autoload === true;
}

async function readAutoloadSettings(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<AutoloadSettings> {
	const paths = await getPaths(ctx);
	const read = await readJson(paths.userSettingsPath);
	if (read.state === "missing") return { enabled: false };
	if (read.state === "invalid") return { enabled: false, warning: `Construct settings are invalid JSON: ${read.error}` };
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
		"When Pi is running, it can notice new .pi/settings.json package declarations and ask one by one.",
		"On session exit, it also checks for unloaded project resources.",
		"It never installs packages or edits .pi/settings.json.",
		settings.warning ? `! ${settings.warning}` : undefined,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

function canUseAutoloadUI(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.mode === "tui" && ctx.isProjectTrusted();
}

function clearAutoloadWatcher(): void {
	if (!activeWatcher) return;
	activeWatcher.disposed = true;
	if (activeWatcher.debounce) clearTimeout(activeWatcher.debounce);
	activeWatcher.watcher?.close();
	activeWatcher = undefined;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAutoloadIdle(ctx: ExtensionContext, state: AutoloadWatcherState): Promise<boolean> {
	while (!state.disposed) {
		if (ctx.isIdle() && !ctx.hasPendingMessages()) return true;
		ctx.ui.setStatus("construct", "Construct autoload: waiting for agent to finish");
		await sleep(500);
	}
	return false;
}

async function promptForNewAutoloadCandidates(ctx: ExtensionContext, state: AutoloadWatcherState): Promise<void> {
	if (state.disposed || state.promptInFlight) return;
	state.promptInFlight = true;
	try {
		const settings = await readAutoloadSettings(ctx);
		if (!settings.enabled || !canUseAutoloadUI(ctx)) return;
		if (!(await waitForAutoloadIdle(ctx, state))) return;

		const paths = await getPaths(ctx);
		const candidates = await projectLoadCandidates(paths);
		const fresh = candidates.adoptable.filter((candidate) => !state.seenSources.has(candidate.source));
		for (const candidate of candidates.adoptable) state.seenSources.add(candidate.source);
		if (fresh.length === 0) return;

		for (const candidate of fresh) {
			if (state.disposed) return;
			const confirmed = await ctx.ui.confirm(
				"Load new Pi package into Construct?",
				[
					"Construct autoload noticed a new project package declaration.",
					"",
					`Package: ${candidate.id}`,
					`Source: ${candidate.source}`,
					"",
					"Load this source into the Construct library?",
					"This only records the source and project metadata.",
					"It does not install packages, enable resources, edit .pi/settings.json, or reload Pi.",
				].join("\n"),
				{ timeout: 60000 },
			);
			if (!confirmed) continue;

			const constructRead = await readJson(paths.projectConstructPath);
			if (constructRead.state === "invalid") {
				ctx.ui.notify("Construct autoload skipped: .pi/construct.json is invalid JSON.", "warning");
				continue;
			}
			const enabledBySource = new Map([[candidate.source, !candidate.disabledByFilters]]);
			const result = await loadSourcesIntoConstruct(ctx, paths, [candidate.source], { enabledBySource });
			ctx.ui.notify(`Construct loaded ${candidate.id} into the library.`, result.warnings.length > 0 ? "warning" : "info");
			if (result.warnings.length > 0) ctx.ui.notify(formatLoadResult(result), "warning");
		}
	} catch (error) {
		ctx.ui.notify(`Construct autoload check failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
	} finally {
		state.promptInFlight = false;
		ctx.ui.setStatus("construct", undefined);
	}
}

function scheduleAutoloadCheck(ctx: ExtensionContext, state: AutoloadWatcherState): void {
	if (state.disposed) return;
	if (state.debounce) clearTimeout(state.debounce);
	state.debounce = setTimeout(() => {
		state.debounce = undefined;
		void promptForNewAutoloadCandidates(ctx, state);
	}, 2000);
}

function startSettingsWatcher(ctx: ExtensionContext, state: AutoloadWatcherState, settingsPath: string): void {
	const settingsDir = dirname(settingsPath);
	const watchPath = existsSync(settingsPath) ? settingsPath : existsSync(settingsDir) ? settingsDir : ctx.cwd;
	try {
		state.watcher = watch(watchPath, { persistent: false }, (_eventType, filename) => {
			const name = filename?.toString();
			if (watchPath === settingsPath || !name || name === basename(settingsPath) || name === basename(settingsDir)) {
				scheduleAutoloadCheck(ctx, state);
			}
		});
	} catch {
		// Exit-time autoload remains the reliable fallback when file watching is unavailable.
	}
}

export async function maybeStartAutoloadWatcher(_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
	clearAutoloadWatcher();
	const settings = await readAutoloadSettings(ctx);
	if (!settings.enabled || !canUseAutoloadUI(ctx)) return;

	const paths = await getPaths(ctx);
	const state: AutoloadWatcherState = { disposed: false, promptInFlight: false, seenSources: new Set() };
	activeWatcher = state;
	try {
		const candidates = await projectLoadCandidates(paths);
		for (const candidate of candidates.adoptable) state.seenSources.add(candidate.source);
	} catch {
		// If startup inspection fails, still keep the exit-time check as the safe fallback.
	}
	startSettingsWatcher(ctx, state, paths.projectSettingsPath);
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
	if (next) await maybeStartAutoloadWatcher({ type: "session_start", reason: "startup" }, ctx);
	else clearAutoloadWatcher();
	showText(
		ctx,
		[
			`Construct autoload is now ${next ? "on" : "off"}.`,
			next ? "Construct will ask before loading new project resources." : "No autoload prompts will run.",
			next ? "During this session, new .pi/settings.json package declarations can be offered one by one." : undefined,
			next ? "On session exit, Construct will also check for unloaded project resources." : undefined,
			"Autoload always requires confirmation before writing anything.",
			"It never installs packages or edits .pi/settings.json.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function maybePromptAutoloadOnShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
	clearAutoloadWatcher();
	if (event.reason !== "quit") return;
	const settings = await readAutoloadSettings(ctx);
	if (!settings.enabled) return;
	if (!ctx.hasUI || ctx.mode !== "tui") return;
	if (!ctx.isProjectTrusted()) return;

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
		ctx.ui.notify("Construct autoload skipped: .pi/construct.json is invalid JSON.", "warning");
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
