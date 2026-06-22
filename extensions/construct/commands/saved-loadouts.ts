import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CatalogProfile, ConstructPaths } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, addSourcesToCatalog } from "../catalog.js";
import { describeJsonReadIssue, isObject, readJson, writeJson } from "../json.js";
import { runConstructOperationSteps, showOperationRunPanel, type ConstructOperationRunResult, type ConstructOperationStep, type ProgressUpdate } from "../operation-runner.js";
import { getPaths } from "../paths.js";
import { collectPackageSourceSets, getPackages } from "../project-settings.js";
import { rememberKnownProject } from "../projects.js";
import {
	findSavedLoadout,
	generatedCacheSources,
	importPreviewLines,
	loadoutShareSnippetText,
	parseLoadoutSnippet,
	replacementLines,
	savedLoadoutId,
	savedLoadoutSources,
	secretLikeSources,
	uniqueSorted,
	type ParsedLoadoutSnippet,
} from "../saved-loadouts.js";
import { isLocalPathSource, managedPackageSourceIdentity } from "../sources.js";
import { pickCheckboxes, showSummary, showText, splitArgs, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";
import { loadSourcesIntoConstruct, projectLoadCandidates } from "./load.js";

function usage(): string {
	return [
		"Saved Construct loadouts",
		"========================",
		"/construct list",
		"/construct save <name>",
		"/construct run <saved-name>",
		"/construct share <saved-name>",
		"/construct remove <saved-name>",
		"/construct import [json]",
		"",
		"Saved loadouts are named groups of active Construct package sources. Direct project-local resources are not included yet.",
	].join("\n");
}

async function activeManagedPackageSources(paths: ConstructPaths): Promise<string[]> {
	const [settingsRead, constructRead] = await Promise.all([readJson(paths.projectSettingsPath), readJson(paths.projectConstructPath)]);
	if (constructRead.state === "invalid") throw new Error(`Cannot save a loadout because ${describeJsonReadIssue(".pi/construct.json", constructRead)}`);
	if (constructRead.state !== "ok" || !isObject(constructRead.data) || !isObject(constructRead.data.items)) return [];

	const packageSources = await collectPackageSourceSets(getPackages(settingsRead), dirname(paths.projectSettingsPath));

	const sources: string[] = [];
	const seen = new Set<string>();
	for (const value of Object.values(constructRead.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (!identity.displaySource) continue;
		const active = [...identity.matchSources].some((source) => packageSources.activeSources.has(source));
		if (!active) continue;
		const source = identity.normalizedInstallSource ?? identity.displaySource;
		if (seen.has(source)) continue;
		seen.add(source);
		sources.push(source);
	}
	return sources.sort();
}

async function disabledProjectPackageCount(paths: ConstructPaths): Promise<number> {
	const settingsRead = await readJson(paths.projectSettingsPath);
	return getPackages(settingsRead).filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.disabledByFilters && pkg.source.trim()).length;
}

async function activeUnloadedPackageSources(paths: ConstructPaths): Promise<Array<{ id: string; source: string }>> {
	const candidates = await projectLoadCandidates(paths);
	return candidates.adoptable.filter((candidate) => !candidate.disabledByFilters).map((candidate) => ({ id: candidate.id, source: candidate.source }));
}

async function promptForUnloadedSources(ctx: ExtensionCommandContext, name: string, candidates: Array<{ id: string; source: string }>): Promise<string[] | undefined> {
	if (candidates.length === 0) return [];
	if (ctx.mode !== "tui") return [];

	const pickerItems: CheckboxPickerItem[] = candidates.map((candidate) => ({
		id: candidate.source,
		label: candidate.id,
		value: candidate.source,
		description: "Active package declaration in this project, but not loaded into Construct. Select to load it into Construct and include it in the saved loadout.",
		checked: false,
		section: "ACTIVE PACKAGES — not loaded into Construct",
	}));
	const selected = await pickCheckboxes(ctx, `Save loadout: ${name}`, pickerItems, {
		initialSelection: "empty",
		confirmHint: "Enter continues",
		filterLabel: "Filter package declarations",
		filterHint: "Type to narrow active package declarations not loaded into Construct",
		footerHint: "  Space selects · Enter continues · Esc cancels",
	});
	if (!selected) return undefined;
	const candidateSources = new Set(candidates.map((candidate) => candidate.source));
	return selected.selectedIds.filter((source) => candidateSources.has(source));
}

async function confirmReplaceSavedLoadout(ctx: ExtensionCommandContext, id: string, existingSources: string[], nextSources: string[]): Promise<boolean> {
	if (ctx.mode !== "tui") return false;
	return ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
		const lines = replacementLines(existingSources, nextSources);
		let scroll = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}
		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const maxVisible = 16;
			const maxScroll = Math.max(0, lines.length - maxVisible);
			scroll = Math.min(scroll, maxScroll);
			const visible = lines.slice(scroll, scroll + maxVisible);
			const rendered = [theme.fg("warning", theme.bold(`Replace saved loadout: ${id}`)), ""];
			for (const line of visible) {
				if (line.startsWith("+")) rendered.push(theme.fg("success", line));
				else if (line.startsWith("-")) rendered.push(theme.fg("muted", line));
				else rendered.push(line);
			}
			if (lines.length > maxVisible) rendered.push("", theme.fg("muted", `  (${scroll + 1}-${Math.min(scroll + maxVisible, lines.length)}/${lines.length})`));
			rendered.push("", theme.fg("warning", "  Enter replaces · Esc cancels"));
			cachedWidth = width;
			cachedLines = rendered.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}
		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.up")) {
				scroll = Math.max(0, scroll - 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				scroll = Math.min(Math.max(0, lines.length - 16), scroll + 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm")) done(true);
			if (keybindings.matches(data, "tui.select.cancel")) done(false);
		}
		return { render, handleInput, invalidate };
	});
}

async function runSavedLoadoutOperations(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	loadoutId: string,
	query: string,
	update?: ProgressUpdate,
	signal?: AbortSignal,
): Promise<ConstructOperationRunResult> {
	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct run", update, signal);
	if (!ready) return { title: "Saved loadout run cancelled", lines: ["No files were changed."] };
	if (signal?.aborted) return { title: "Saved loadout run cancelled", lines: ["No files were changed."] };

	const fresh = await loadCatalog(ctx);
	if (fresh.warnings.length > 0) {
		return { title: "Saved loadout run failed", lines: fresh.warnings.map((warning) => `! ${warning}`) };
	}
	const currentProfile = findSavedLoadout(fresh.catalog, loadoutId) ?? findSavedLoadout(fresh.catalog, query);
	if (!currentProfile) {
		return { title: "Saved loadout run failed", lines: [`Saved loadout not found after waiting for Pi to become idle: ${loadoutId}`] };
	}
	const sources = savedLoadoutSources(fresh.catalog, currentProfile);
	if (sources.length === 0) {
		return { title: "Saved loadout run failed", lines: [`Saved loadout has no package sources: ${currentProfile.id}`] };
	}

	const steps: ConstructOperationStep[] = sources.map((source) => {
		const item = findCatalogItem(fresh.catalog.items, source);
		const label = item?.id ?? deriveId(source);
		return {
			action: "Install",
			item: { id: label, label, source, displaySource: source, catalogItem: item },
			state: "pending",
		};
	});
	const outcome = await runConstructOperationSteps({
		pi,
		ctx,
		paths,
		steps,
		update,
		signal,
		progressTitle: `Running saved loadout: ${currentProfile.id}`,
		completeLabel: "package sources",
		statusKind: "loading",
	});

	const loaded = outcome.completed.filter((step) => step.action === "Install");
	const hasErrors = outcome.failures.length > 0 || outcome.partialRuntimeChanges.length > 0;
	return {
		title: outcome.cancelled
			? outcome.appliedChanges > 0
				? `Saved loadout run cancelled after partial changes: ${currentProfile.id}`
				: `Saved loadout run cancelled: ${currentProfile.id}`
			: hasErrors
				? `Saved loadout ran with errors: ${currentProfile.id}`
				: `Ran saved loadout: ${currentProfile.id}`,
		confirmHint: outcome.needsReload ? "Press Enter to reload Pi · Esc cancels reload" : "Press Enter/Esc to return to session",
		confirmAction: outcome.needsReload ? "reload" : undefined,
		lines: [
			outcome.cancelled ? "Cancelled before remaining resources." : undefined,
			"Recipe mode: activate-only; no disable, remove, or exact-match actions are run.",
			`Turned on: ${outcome.appliedChanges}/${steps.length}`,
			...loaded.map((step) => `+ ${step.item.label}: ${step.item.source}`),
			outcome.partialRuntimeChanges.length > 0 ? `Package settings changed, but Construct metadata failed: ${outcome.partialRuntimeChanges.length}` : undefined,
			...outcome.partialRuntimeChanges.map((change) => `! ${change.item.label}: ${change.error}`),
			outcome.partialRuntimeChanges.length > 0 ? "Run /construct status to inspect drift." : undefined,
			outcome.failures.length > 0 ? `Failures: ${outcome.failures.length}` : undefined,
			...outcome.failures.map((failure) => `! ${failure}`),
		].filter((line): line is string => line !== undefined),
	};
}

function runResultText(result: ConstructOperationRunResult): string {
	return [
		result.title,
		...result.lines,
		result.confirmAction === "reload" ? "Reload Pi resources with /reload when ready." : "No reload needed; no package settings changed.",
	].join("\n");
}

async function saveLoadout(ctx: ExtensionCommandContext, name: string): Promise<void> {
	const requestedName = name.trim();
	if (!requestedName) {
		showText(ctx, "Usage: /construct save <name>");
		return;
	}
	const paths = await getPaths(ctx);
	const id = savedLoadoutId(requestedName);

	let initialManaged: string[];
	let initialUnloaded: Array<{ id: string; source: string }>;
	try {
		[initialManaged, initialUnloaded] = await Promise.all([activeManagedPackageSources(paths), activeUnloadedPackageSources(paths)]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Saved loadout not created.\nCould not inspect active project package sources.\n${message}`);
		return;
	}

	const selectedBeforeWait = await promptForUnloadedSources(ctx, requestedName, initialUnloaded);
	if (!selectedBeforeWait) {
		showText(ctx, "Saved loadout cancelled. No files were changed.");
		return;
	}

	if (initialManaged.length === 0 && selectedBeforeWait.length === 0) {
		const skippedDisabled = await disabledProjectPackageCount(paths);
		showText(
			ctx,
			[
				"Saved loadout not created.",
				"No active Construct package sources were selected for this saved loadout.",
				initialUnloaded.length > 0 ? `Skipped active package declarations not loaded into Construct: ${initialUnloaded.length}` : undefined,
				skippedDisabled > 0 ? `Skipped disabled package declarations: ${skippedDisabled}` : undefined,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct save");
	if (!ready) {
		showText(ctx, "Saved loadout cancelled. No files were changed.");
		return;
	}

	let selectedToLoad: string[] = [];
	let currentSources: string[] = [];
	let skippedActiveUnloaded = 0;
	let skippedDisabled = 0;
	try {
		const freshUnloaded = await activeUnloadedPackageSources(paths);
		const selectedSet = new Set(selectedBeforeWait);
		selectedToLoad = uniqueSorted(freshUnloaded.filter((candidate) => selectedSet.has(candidate.source)).map((candidate) => candidate.source));
		const selectedAfterWait = new Set(selectedToLoad);
		skippedActiveUnloaded = freshUnloaded.filter((candidate) => !selectedAfterWait.has(candidate.source)).length;
		skippedDisabled = await disabledProjectPackageCount(paths);
		currentSources = uniqueSorted([...(await activeManagedPackageSources(paths)), ...selectedToLoad]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Saved loadout not created.\nCould not re-check project package sources after waiting.\n${message}`);
		return;
	}

	if (currentSources.length === 0) {
		showText(
			ctx,
			[
				"Saved loadout not created.",
				"No active Construct package sources were selected for this saved loadout.",
				skippedActiveUnloaded > 0 ? `Skipped active package declarations not loaded into Construct: ${skippedActiveUnloaded}` : undefined,
				skippedDisabled > 0 ? `Skipped disabled package declarations: ${skippedDisabled}` : undefined,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	const beforeCatalog = await loadCatalog(ctx);
	if (beforeCatalog.read.state === "ok" && beforeCatalog.warnings.length > 0) {
		showText(ctx, ["Saved loadout not created.", `Fix ${beforeCatalog.paths.userCatalogPath} first.`, ...beforeCatalog.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const existingBefore = findSavedLoadout(beforeCatalog.catalog, id);
	if (existingBefore) {
		if (ctx.mode !== "tui") {
			showText(ctx, [`Saved loadout already exists: ${id}`, "Run /construct save in TUI to replace it with confirmation."].join("\n"));
			return;
		}
		const replace = await confirmReplaceSavedLoadout(ctx, id, savedLoadoutSources(beforeCatalog.catalog, existingBefore), currentSources);
		if (!replace) {
			showText(ctx, "Saved loadout replacement cancelled. No files were changed.");
			return;
		}
	}

	if (selectedToLoad.length > 0) {
		const enabledBySource = new Map(selectedToLoad.map((source) => [source, true]));
		const loaded = await loadSourcesIntoConstruct(ctx, paths, selectedToLoad, { enabledBySource });
		if (loaded.warnings.length > 0) {
			showText(ctx, ["Saved loadout not created.", "Some selected package declarations could not be loaded into Construct.", ...loaded.warnings.map((warning) => `! ${warning}`)].join("\n"));
			return;
		}
	}

	currentSources = uniqueSorted(await activeManagedPackageSources(paths));
	if (currentSources.length === 0) {
		showText(ctx, "Saved loadout not created. No active Construct package sources found after loading selected package declarations.");
		return;
	}

	const load = await addSourcesToCatalog(ctx, currentSources);
	const remembered = await rememberKnownProject(ctx);
	if (remembered.warning) load.warnings.push(remembered.warning);
	if (load.warnings.length > 0) {
		showText(ctx, ["Saved loadout not created.", ...load.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const { paths: catalogPaths, read, catalog, warnings } = await loadCatalog(ctx);
	if (read.state === "ok" && warnings.length > 0) {
		showText(ctx, ["Saved loadout not created.", `Fix ${catalogPaths.userCatalogPath} first.`, ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const items = currentSources.map((source) => findCatalogItem(catalog.items, source)?.id ?? deriveId(source));
	const now = new Date().toISOString();
	const existing = findSavedLoadout(catalog, id);
	const nextProfile: CatalogProfile = {
		...(existing ?? {}),
		id,
		name: requestedName,
		kind: "profile",
		items,
		sources: currentSources,
		updatedAt: now,
		createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
	};
	const profiles = [...catalog.profiles.filter((profile) => profile.id !== id), nextProfile].sort((a, b) => a.id.localeCompare(b.id));
	await writeJson(catalogPaths.userCatalogPath, { ...catalog, version: 1, profiles });
	await showSummary(
		ctx,
		[
			`Saved loadout: ${id}`,
			`Included package sources: ${currentSources.length}`,
			selectedToLoad.length > 0 ? `Loaded into Construct and included package sources: ${selectedToLoad.length}` : undefined,
			`Skipped active package declarations not loaded into Construct: ${skippedActiveUnloaded}`,
			`Skipped disabled package declarations: ${skippedDisabled}`,
			...currentSources.map((source) => `- ${source}`),
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

async function runSavedLoadout(pi: ExtensionAPI, ctx: ExtensionCommandContext, query: string): Promise<void> {
	const requested = query.trim();
	if (!requested) {
		showText(ctx, "Usage: /construct run <saved-name>");
		return;
	}
	const paths = await getPaths(ctx);
	const { catalog, warnings } = await loadCatalog(ctx);
	if (warnings.length > 0) {
		showText(ctx, ["Saved loadout run failed.", ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const profile = findSavedLoadout(catalog, requested);
	if (!profile) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const sources = savedLoadoutSources(catalog, profile);
	if (sources.length === 0) {
		showText(ctx, `Saved loadout has no package sources: ${profile.id}`);
		return;
	}

	if (ctx.mode === "tui") {
		const result = await showOperationRunPanel(ctx, {
			initialTitle: `Running saved loadout: ${profile.id}`,
			preparingLine: "Preparing saved loadout run…",
			applyingHint: "Applying package changes…",
			failureTitle: "Saved loadout run failed",
			run: (update, signal) => runSavedLoadoutOperations(pi, ctx, paths, profile.id, requested, update, signal),
		});
		if (result.closeAction === "confirm" && result.confirmAction === "reload") {
			await ctx.reload();
		}
		return;
	}

	const result = await runSavedLoadoutOperations(pi, ctx, paths, profile.id, requested);
	await showSummary(ctx, runResultText(result));
}

async function confirmRemoveSavedLoadout(ctx: ExtensionCommandContext, profile: CatalogProfile, sources: string[]): Promise<boolean> {
	if (ctx.mode !== "tui") return true;
	return ctx.ui.custom<boolean>((_tui, theme, keybindings, done) => {
		const lines = [
			`Saved loadout: ${profile.id}`,
			`Package sources: ${sources.length}`,
			"",
			"This removes only the saved recipe.",
			"It will not uninstall packages, disable resources, edit this project, or remove sources from the Construct library.",
		];
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}
		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const rendered = [theme.fg("warning", theme.bold(`Remove saved loadout: ${profile.id}`)), "", ...lines, "", theme.fg("warning", "  Enter removes · Esc cancels")];
			cachedWidth = width;
			cachedLines = rendered.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}
		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.confirm")) done(true);
			if (keybindings.matches(data, "tui.select.cancel")) done(false);
		}
		return { render, handleInput, invalidate };
	});
}

async function removeSavedLoadout(ctx: ExtensionCommandContext, query: string): Promise<void> {
	const requested = query.trim();
	if (!requested) {
		showText(ctx, "Usage: /construct remove <saved-name>");
		return;
	}
	const before = await loadCatalog(ctx);
	if (before.read.state === "ok" && before.warnings.length > 0) {
		showText(ctx, ["Saved loadout not removed.", `Fix ${before.paths.userCatalogPath} first.`, ...before.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const profile = findSavedLoadout(before.catalog, requested);
	if (!profile) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const sources = savedLoadoutSources(before.catalog, profile);
	const confirmed = await confirmRemoveSavedLoadout(ctx, profile, sources);
	if (!confirmed) {
		showText(ctx, "Saved loadout removal cancelled. No files were changed.");
		return;
	}
	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct remove saved loadout");
	if (!ready) {
		showText(ctx, "Saved loadout removal cancelled. No files were changed.");
		return;
	}
	const fresh = await loadCatalog(ctx);
	if (fresh.read.state === "ok" && fresh.warnings.length > 0) {
		showText(ctx, ["Saved loadout not removed.", `Fix ${fresh.paths.userCatalogPath} first.`, ...fresh.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const current = findSavedLoadout(fresh.catalog, profile.id) ?? findSavedLoadout(fresh.catalog, requested);
	if (!current) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const profiles = fresh.catalog.profiles.filter((entry) => entry.id !== current.id);
	await writeJson(fresh.paths.userCatalogPath, { ...fresh.catalog, version: 1, profiles });
	await showSummary(ctx, [`Removed saved loadout: ${current.id}`, "No project files were changed."].join("\n"));
}

async function shareLoadout(ctx: ExtensionCommandContext, query: string): Promise<void> {
	const requested = query.trim();
	if (!requested) {
		showText(ctx, "Usage: /construct share <saved-name>");
		return;
	}
	const warnings: string[] = [];
	const { catalog, warnings: catalogWarnings } = await loadCatalog(ctx);
	if (catalogWarnings.length > 0) {
		showText(ctx, ["Construct loadout share snippet not created.", ...catalogWarnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const profile = findSavedLoadout(catalog, requested);
	if (!profile) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const name = profile.name ?? profile.id;
	const sources = uniqueSorted(savedLoadoutSources(catalog, profile));

	if (sources.length === 0) {
		showText(ctx, `Saved loadout has no package sources: ${requested}`);
		return;
	}

	const secretLike = secretLikeSources(sources);
	if (secretLike.length > 0) {
		showText(ctx, ["Construct loadout share snippet not created.", "Refusing to print source strings that look like they contain secrets.", ...secretLike.map((source) => `! ${source}`)].join("\n"));
		return;
	}

	const generatedCache = generatedCacheSources(sources);
	if (generatedCache.length > 0) {
		showText(ctx, ["Construct loadout share snippet not created.", "Refusing to print generated Pi package cache paths.", ...generatedCache.map((source) => `! ${source}`)].join("\n"));
		return;
	}

	const localPaths = sources.filter(isLocalPathSource);
	if (localPaths.length > 0) warnings.push(`Local path sources may not work on another machine: ${localPaths.join(", ")}`);

	await showSummary(ctx, loadoutShareSnippetText({ name, sources, warnings }));
}

async function confirmImportLoadout(ctx: ExtensionCommandContext, snippet: ParsedLoadoutSnippet, warnings: string[], existingSources?: string[]): Promise<boolean> {
	if (ctx.mode !== "tui") return false;
	return ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
		const lines = importPreviewLines(snippet, warnings, existingSources);
		let scroll = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}
		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const maxVisible = 16;
			const maxScroll = Math.max(0, lines.length - maxVisible);
			scroll = Math.min(scroll, maxScroll);
			const visible = lines.slice(scroll, scroll + maxVisible);
			const heading = existingSources ? "Replace imported saved loadout?" : "Import saved loadout?";
			const rendered = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of visible) {
				if (line.startsWith("!")) rendered.push(theme.fg("warning", line));
				else if (line.startsWith("+")) rendered.push(theme.fg("success", line));
				else if (line.startsWith("-")) rendered.push(theme.fg("muted", line));
				else rendered.push(line);
			}
			if (lines.length > maxVisible) rendered.push("", theme.fg("muted", `  (${scroll + 1}-${Math.min(scroll + maxVisible, lines.length)}/${lines.length})`));
			rendered.push("", theme.fg("accent", "  Enter imports · Esc cancels"));
			cachedWidth = width;
			cachedLines = rendered.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}
		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.up")) {
				scroll = Math.max(0, scroll - 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				scroll = Math.min(Math.max(0, lines.length - 16), scroll + 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm")) done(true);
			if (keybindings.matches(data, "tui.select.cancel")) done(false);
		}
		return { render, handleInput, invalidate };
	});
}

async function promptForImportText(ctx: ExtensionCommandContext): Promise<string | undefined> {
	if (ctx.mode !== "tui") return undefined;
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		let text = "";
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}
		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const body = text ? text.split("\n") : [theme.fg("muted", "Paste Construct loadout JSON here.")];
			const maxVisible = 14;
			const visible = body.slice(Math.max(0, body.length - maxVisible));
			const rendered = [theme.fg("accent", theme.bold("Import saved loadout")), "", ...visible, "", theme.fg("muted", "  Paste JSON · Backspace edits · Enter previews · Esc cancels")];
			cachedWidth = width;
			cachedLines = rendered.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}
		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.cancel")) {
				done(undefined);
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm")) {
				done(text);
				return;
			}
			if (data === "\u007f" || data === "\b") {
				text = text.slice(0, -1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (data && !data.startsWith("\u001b")) {
				text += data;
				invalidate();
				tui.requestRender();
			}
		}
		return { render, handleInput, invalidate };
	});
}

async function importLoadout(ctx: ExtensionCommandContext, raw: string): Promise<void> {
	let importText = raw;
	if (!importText.trim()) {
		if (ctx.mode !== "tui") {
			showText(ctx, "Usage: /construct import <construct-loadout-json>");
			return;
		}
		const pasted = await promptForImportText(ctx);
		if (pasted === undefined) {
			showText(ctx, "Construct loadout import cancelled. No files were changed.");
			return;
		}
		importText = pasted;
	}
	const parsed = parseLoadoutSnippet(importText);
	if (!parsed.snippet) {
		showText(ctx, ["Construct loadout import failed.", ...parsed.errors.map((error) => `! ${error}`), ...parsed.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const before = await loadCatalog(ctx);
	if (before.read.state === "ok" && before.warnings.length > 0) {
		showText(ctx, ["Construct loadout import failed.", `Fix ${before.paths.userCatalogPath} first.`, ...before.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const id = savedLoadoutId(parsed.snippet.name);
	const existing = findSavedLoadout(before.catalog, id);
	const existingSources = existing ? savedLoadoutSources(before.catalog, existing) : undefined;

	if (ctx.mode !== "tui") {
		showText(ctx, ["Construct loadout import preview", "===============================", ...importPreviewLines(parsed.snippet, parsed.warnings, existingSources), "", "No files were changed. Run /construct import in TUI to confirm."].join("\n"));
		return;
	}

	const confirmed = await confirmImportLoadout(ctx, parsed.snippet, parsed.warnings, existingSources);
	if (!confirmed) {
		showText(ctx, "Construct loadout import cancelled. No files were changed.");
		return;
	}

	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct import");
	if (!ready) {
		showText(ctx, "Construct loadout import cancelled. No files were changed.");
		return;
	}

	const load = await addSourcesToCatalog(ctx, parsed.snippet.sources);
	if (load.warnings.length > 0) {
		showText(ctx, ["Construct loadout import failed.", ...load.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const { paths: catalogPaths, read, catalog, warnings } = await loadCatalog(ctx);
	if (read.state === "ok" && warnings.length > 0) {
		showText(ctx, ["Construct loadout import failed.", `Fix ${catalogPaths.userCatalogPath} first.`, ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const freshExisting = findSavedLoadout(catalog, id);
	const items = parsed.snippet.sources.map((source) => findCatalogItem(catalog.items, source)?.id ?? deriveId(source));
	const now = new Date().toISOString();
	const nextProfile: CatalogProfile = {
		...(freshExisting ?? {}),
		id,
		name: parsed.snippet.name,
		kind: "profile",
		items,
		sources: parsed.snippet.sources,
		createdAt: typeof freshExisting?.createdAt === "string" ? freshExisting.createdAt : now,
		updatedAt: now,
	};
	const profiles = [...catalog.profiles.filter((profile) => profile.id !== id), nextProfile].sort((a, b) => a.id.localeCompare(b.id));
	await writeJson(catalogPaths.userCatalogPath, { ...catalog, version: 1, profiles });
	await showSummary(
		ctx,
		[
			`Imported saved loadout: ${id}`,
			`Package sources: ${parsed.snippet.sources.length}`,
			load.added.length > 0 ? `Added to Construct library: ${load.added.length}` : undefined,
			load.alreadyKnown > 0 ? `Already in Construct library: ${load.alreadyKnown}` : undefined,
			...parsed.warnings.map((warning) => `! ${warning}`),
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

async function listSavedLoadouts(ctx: ExtensionCommandContext): Promise<void> {
	const { catalog, warnings } = await loadCatalog(ctx);
	const lines = ["Saved Construct loadouts", "========================"];
	if (catalog.profiles.length === 0) lines.push("- none");
	else {
		for (const profile of catalog.profiles) {
			lines.push(`- ${profile.id}${profile.name && profile.name !== profile.id ? ` (${profile.name})` : ""}: ${profile.sources.length || profile.items.length} package sources`);
		}
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	showText(ctx, lines.join("\n"));
}

export async function handleSavedLoadoutCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { command, rest } = splitArgs(args);
	if (command === "list") {
		await listSavedLoadouts(ctx);
		return;
	}
	if (command === "save") {
		await saveLoadout(ctx, rest);
		return;
	}
	if (command === "run") {
		await runSavedLoadout(pi, ctx, rest);
		return;
	}
	if (command === "share") {
		await shareLoadout(ctx, rest);
		return;
	}
	if (command === "remove") {
		await removeSavedLoadout(ctx, rest);
		return;
	}
	if (command === "import") {
		await importLoadout(ctx, rest);
		return;
	}
	showText(ctx, usage());
}
