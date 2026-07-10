import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CatalogItem, CatalogProfile, ConstructPaths } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, addSourcesToCatalog } from "../catalog.js";
import { describeJsonReadIssue, writeJson } from "../json.js";
import { runConstructOperationSteps, showOperationRunPanel, type ConstructOperationRunResult, type ConstructOperationStep, type ProgressUpdate } from "../operation-runner.js";
import { getPaths } from "../paths.js";
import { collectProjectInventory, type ProjectInventory } from "../project-inventory.js";
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
import { formatPackageSourceLabel, isLocalPathSource, packageSourceMatchValues } from "../sources.js";
import { pickCheckboxes, showSummary, showText, splitArgs, waitForIdleBeforeConstructWrite, type CheckboxPickerItem } from "../ui.js";
import { loadSourcesIntoConstruct } from "./load.js";

function usage(): string {
	return [
		"Saved Construct loadouts",
		"========================",
		"/construct list",
		"/construct save <loadout-name>",
		"/construct run <saved-name>",
		"/construct share <saved-name>",
		"/construct wipe <saved-name>",
		"/construct import [json]",
		"",
		"Saved loadouts are named groups of active Construct package sources. Direct project-local resources are not included yet.",
	].join("\n");
}

interface SavePackageSnapshot {
	activeManagedSources: string[];
	activeUnloadedPackages: Array<{ id: string; source: string }>;
	disabledPackageCount: number;
}

function savePackageSnapshotFromInventory(inventory: ProjectInventory): SavePackageSnapshot {
	if (inventory.reads.projectConstruct.state === "invalid") throw new Error(`Cannot save a loadout because ${describeJsonReadIssue(".pi/construct.json", inventory.reads.projectConstruct)}`);
	return {
		activeManagedSources: uniqueSorted(inventory.managedPackages.filter((item) => item.state === "active" && !item.projectOverride).map((item) => item.source)),
		activeUnloadedPackages: inventory.unloadedPackageDeclarations.filter((candidate) => !candidate.disabledByFilters).map((candidate) => ({ id: deriveId(candidate.source), source: candidate.source })),
		disabledPackageCount: inventory.packageDeclarations.filter((pkg) => pkg.form !== "invalid" && !pkg.projectOverride && pkg.enabled && pkg.disabledByFilters && pkg.source.trim()).length,
	};
}

async function collectSavePackageSnapshot(ctx: ExtensionCommandContext): Promise<SavePackageSnapshot> {
	return savePackageSnapshotFromInventory(await collectProjectInventory(ctx, { directResources: false }));
}

async function promptForUnloadedSources(
	ctx: ExtensionCommandContext,
	name: string,
	managedSources: string[],
	candidates: Array<{ id: string; source: string }>,
): Promise<string[] | undefined> {
	if (candidates.length === 0) return [];
	if (ctx.mode !== "tui") return candidates.map((candidate) => candidate.source);

	const managedItems: CheckboxPickerItem[] = managedSources.map((source) => ({
		id: `managed:${source}`,
		label: deriveId(source),
		value: source,
		description: "Already loaded into Construct and included automatically.",
		checked: false,
		disabled: true,
		marker: "[·]",
		stateText: "✓",
		stateTone: "accent",
		section: "Already included",
	}));
	const candidateItems: CheckboxPickerItem[] = candidates.map((candidate) => ({
		id: candidate.source,
		label: candidate.id,
		value: candidate.source,
		description: "Not loaded into Construct yet. Select to load it into Construct and include it in this saved loadout.",
		checked: false,
		stateText: "+",
		stateTone: "warning",
		section: "Optional: load and include",
	}));
	const selected = await pickCheckboxes(ctx, `Save loadout: ${name}`, [...managedItems, ...candidateItems], {
		initialSelection: "empty",
		subtitle: "Review the active package sources. Select optional packages to add to this loadout.",
		confirmHint: "Enter saves",
		filterLabel: "Filter",
		filterHint: "type to narrow",
		filterHintInline: true,
		footerHint: "  Space include/exclude · Enter save · Esc cancel\n  [·] already included",
	});
	if (!selected) return undefined;
	const candidateSources = new Set(candidates.map((candidate) => candidate.source));
	return selected.selectedIds.filter((source) => candidateSources.has(source));
}

function directResourceSaveNotice(inventory: ProjectInventory): string[] {
	const active = inventory.directResources.resources.filter((resource) => resource.enabled);
	const filteredPackages = inventory.packageDeclarations.filter((pkg) => !pkg.projectOverride && pkg.filterState === "partially-filtered");
	if (active.length === 0 && filteredPackages.length === 0 && inventory.directResources.warnings.length === 0) return [];
	const unloaded = active.filter((resource) => !resource.managed).length;
	return [
		...inventory.directResources.warnings.map((warning) => `! ${warning}`),
		filteredPackages.length > 0 ? `! Package child-resource filters not included: ${filteredPackages.length}` : undefined,
		...filteredPackages.slice(0, 6).map((pkg) => `! package ${pkg.source}: ${pkg.filterDescription}`),
		filteredPackages.length > 6 ? `! ... ${filteredPackages.length - 6} more filtered packages not included` : undefined,
		active.length > 0 ? `! Direct project-local resources not included: ${active.length}${unloaded > 0 ? ` (${unloaded} not loaded into Construct)` : ""}` : undefined,
		active.length > 0 ? "! Saved loadouts are package-source-only for now; Pi-resolved direct project resources stay project-local." : undefined,
		...active.slice(0, 6).map((resource) => `! ${resource.kind} ${resource.name}: ${resource.displayPath}`),
		active.length > 6 ? `! ... ${active.length - 6} more direct project-local resources not included` : undefined,
	].filter((line): line is string => line !== undefined);
}

function saveNotCreatedText(lines: string[]): string {
	return ["Saved loadout not created.", ...lines].join("\n");
}

function saveSummaryText(options: {
	id: string;
	currentSources: string[];
	loadedSources: string[];
	skippedActiveUnloaded: number;
	skippedDisabled: number;
	directNotice: string[];
}): string {
	const notIncluded = [
		options.skippedActiveUnloaded > 0 ? `! Active package declarations not loaded into Construct: ${options.skippedActiveUnloaded}` : undefined,
		options.skippedDisabled > 0 ? `! Disabled package declarations: ${options.skippedDisabled}` : undefined,
		...options.directNotice,
	].filter((line): line is string => line !== undefined);
	return [
		`Saved loadout: ${options.id}`,
		"",
		`Included packages: ${options.currentSources.length}`,
		...options.currentSources.map((source) => `- ${source}`),
		options.loadedSources.length > 0 ? "" : undefined,
		options.loadedSources.length > 0 ? `Loaded into Construct: ${options.loadedSources.length}` : undefined,
		...options.loadedSources.map((source) => `+ ${source}`),
		notIncluded.length > 0 ? "" : undefined,
		notIncluded.length > 0 ? "Not included" : undefined,
		...notIncluded,
	].filter((line): line is string => line !== undefined).join("\n");
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

function packageStateRank(state: "active" | "disabled" | "available" | "unloaded"): number {
	if (state === "active") return 0;
	if (state === "disabled") return 1;
	if (state === "unloaded") return 2;
	return 3;
}

async function sourceMatchesForRun(source: string, paths: ConstructPaths): Promise<Set<string>> {
	const settingsDir = dirname(paths.projectSettingsPath);
	return new Set([source, ...(await packageSourceMatchValues(source, settingsDir)), ...(await packageSourceMatchValues(source, paths.cwd))]);
}

function overlaps(a: Iterable<string>, b: Set<string>): boolean {
	for (const value of a) if (b.has(value)) return true;
	return false;
}

async function stepsForSavedLoadoutSources(
	inventory: ProjectInventory,
	sources: string[],
	catalogItems: CatalogItem[],
): Promise<{ steps: ConstructOperationStep[]; alreadyActive: string[]; projectOverrides: string[] }> {
	const steps: ConstructOperationStep[] = [];
	const alreadyActive: string[] = [];
	const projectOverrides: string[] = [];
	const scheduled = new Set<string>();

	function addStep(action: "Install" | "Enable", source: string, label: string, catalogItem = findCatalogItem(catalogItems, source)): void {
		const key = `${action}:${source}`;
		if (scheduled.has(key)) return;
		scheduled.add(key);
		steps.push({
			action,
			item: { id: label, label, source, displaySource: formatPackageSourceLabel(source), catalogItem },
			state: "pending",
		});
	}

	for (const source of sources) {
		const matches = await sourceMatchesForRun(source, inventory.paths);
		let hasProjectOverride = false;
		for (const candidate of inventory.projectOverrides) {
			if (!overlaps(await sourceMatchesForRun(candidate.source, inventory.paths), matches)) continue;
			hasProjectOverride = true;
			break;
		}
		if (hasProjectOverride) {
			projectOverrides.push(source);
			continue;
		}
		const managed = inventory.managedPackages.filter((item) => overlaps(item.matchSources, matches)).sort((a, b) => packageStateRank(a.state) - packageStateRank(b.state))[0];
		if (managed) {
			if (managed.state === "active") alreadyActive.push(source);
			else if (managed.state === "disabled") addStep("Enable", managed.source, managed.metadata.id);
			else addStep("Install", source, findCatalogItem(catalogItems, source)?.id ?? deriveId(source));
			continue;
		}

		const unloaded = inventory.unloadedPackageDeclarations.find((candidate) => overlaps(candidate.matchSources, matches));
		if (unloaded) {
			if (unloaded.disabledByFilters) addStep("Enable", unloaded.rawSource, deriveId(unloaded.source));
			else alreadyActive.push(source);
			continue;
		}

		const item = findCatalogItem(catalogItems, source);
		addStep("Install", source, item?.id ?? deriveId(source), item);
	}

	return { steps, alreadyActive, projectOverrides };
}

async function runSavedLoadoutOperations(
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

	let operationPlan: Awaited<ReturnType<typeof stepsForSavedLoadoutSources>>;
	try {
		operationPlan = await stepsForSavedLoadoutSources(await collectProjectInventory(ctx, { directResources: false }), sources, fresh.catalog.items);
	} catch (error) {
		return { title: "Saved loadout run failed", lines: [`Could not inspect current project package state: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const { steps, alreadyActive, projectOverrides } = operationPlan;
	if (steps.length === 0) {
		return {
			title: projectOverrides.length > 0 ? `Saved loadout made no changes: ${currentProfile.id}` : `Saved loadout already active: ${currentProfile.id}`,
			confirmHint: "Press Enter/Esc to return to session",
			lines: [
				"Recipe mode: activate-only; no disable, remove, or exact-match actions are run.",
				`Already active: ${alreadyActive.length}/${sources.length}`,
				...alreadyActive.map((source) => `✓ ${source}`),
				...(projectOverrides.length > 0 ? [`Pi project overrides skipped: ${projectOverrides.length}`, ...projectOverrides.map((source) => `↔ ${source} — manage with pi config -l`)] : []),
				"No package settings changed.",
			],
		};
	}
	const outcome = await runConstructOperationSteps({
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
	const enabled = outcome.completed.filter((step) => step.action === "Enable");
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
			alreadyActive.length > 0 ? `Already active and skipped: ${alreadyActive.length}` : undefined,
			`Turned on: ${outcome.appliedChanges}/${steps.length}`,
			loaded.length > 0 ? `Installed: ${loaded.length}` : undefined,
			...loaded.map((step) => `+ ${step.item.label}: ${step.item.source}`),
			enabled.length > 0 ? `Enabled: ${enabled.length}` : undefined,
			...enabled.map((step) => `+ ${step.item.label}: ${step.item.source}`),
			...(projectOverrides.length > 0 ? [`Pi project overrides skipped: ${projectOverrides.length}`, ...projectOverrides.map((source) => `↔ ${source} — manage with pi config -l`)] : []),
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
		showText(ctx, "Usage: /construct save <loadout-name>");
		return;
	}
	if (!ctx.isProjectTrusted()) {
		showText(ctx, ["Saved loadout not created.", "Project is not trusted by Pi, so Construct will not treat project declarations as active.", "Trust this project in Pi, then run /construct save again."].join("\n"));
		return;
	}
	const paths = await getPaths(ctx);
	const id = savedLoadoutId(requestedName);

	let initialSnapshot: SavePackageSnapshot;
	let directNotice: string[];
	try {
		const initialInventory = await collectProjectInventory(ctx);
		initialSnapshot = savePackageSnapshotFromInventory(initialInventory);
		directNotice = directResourceSaveNotice(initialInventory);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Saved loadout not created.\nCould not inspect active project package sources.\n${message}`);
		return;
	}
	const initialManaged = initialSnapshot.activeManagedSources;
	const initialUnloaded = initialSnapshot.activeUnloadedPackages;

	const selectedBeforeWait = await promptForUnloadedSources(ctx, requestedName, initialManaged, initialUnloaded);
	if (!selectedBeforeWait) {
		showText(ctx, "Saved loadout cancelled. No files were changed.");
		return;
	}

	if (initialManaged.length === 0 && selectedBeforeWait.length === 0) {
		const skippedDisabled = initialSnapshot.disabledPackageCount;
		showText(
			ctx,
			saveNotCreatedText(
				[
					"No active package sources were selected for this saved loadout.",
					initialUnloaded.length > 0 ? `! Active package declarations not loaded into Construct: ${initialUnloaded.length}` : undefined,
					skippedDisabled > 0 ? `! Disabled package declarations: ${skippedDisabled}` : undefined,
					...directNotice,
				].filter((line): line is string => line !== undefined),
			),
		);
		return;
	}

	if (ctx.mode === "tui" && directNotice.length > 0) {
		const confirmed = await ctx.ui.confirm(
			"Save package-source-only loadout?",
			[...directNotice, "", "Direct resources and package child-resource filters will not be included. Continue?"].join("\n"),
		);
		if (!confirmed) {
			showText(ctx, "Saved loadout cancelled. No files were changed.");
			return;
		}
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
		const freshSnapshot = await collectSavePackageSnapshot(ctx);
		const selectedSet = new Set(selectedBeforeWait);
		selectedToLoad = uniqueSorted(freshSnapshot.activeUnloadedPackages.filter((candidate) => selectedSet.has(candidate.source)).map((candidate) => candidate.source));
		const selectedAfterWait = new Set(selectedToLoad);
		skippedActiveUnloaded = freshSnapshot.activeUnloadedPackages.filter((candidate) => !selectedAfterWait.has(candidate.source)).length;
		skippedDisabled = freshSnapshot.disabledPackageCount;
		currentSources = uniqueSorted([...freshSnapshot.activeManagedSources, ...selectedToLoad]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Saved loadout not created.\nCould not re-check project package sources after waiting.\n${message}`);
		return;
	}

	if (currentSources.length === 0) {
		showText(
			ctx,
			saveNotCreatedText(
				[
					"No active package sources were selected for this saved loadout.",
					skippedActiveUnloaded > 0 ? `! Active package declarations not loaded into Construct: ${skippedActiveUnloaded}` : undefined,
					skippedDisabled > 0 ? `! Disabled package declarations: ${skippedDisabled}` : undefined,
					...directNotice,
				].filter((line): line is string => line !== undefined),
			),
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

	currentSources = uniqueSorted((await collectSavePackageSnapshot(ctx)).activeManagedSources);
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
		saveSummaryText({
			id,
			currentSources,
			loadedSources: selectedToLoad,
			skippedActiveUnloaded,
			skippedDisabled,
			directNotice,
		}),
	);
}

async function runSavedLoadout(_pi: ExtensionAPI, ctx: ExtensionCommandContext, query: string): Promise<void> {
	const requested = query.trim();
	if (!requested) {
		showText(ctx, "Usage: /construct run <saved-name>");
		return;
	}
	if (!ctx.isProjectTrusted()) {
		showText(ctx, ["Saved loadout run failed.", "Project is not trusted by Pi, so Construct will not edit project package settings here.", "Trust this project in Pi, then run /construct run again."].join("\n"));
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
			run: (update, signal) => runSavedLoadoutOperations(ctx, paths, profile.id, requested, update, signal),
		});
		if (result.closeAction === "confirm" && result.confirmAction === "reload") {
			await ctx.reload();
		}
		return;
	}

	const result = await runSavedLoadoutOperations(ctx, paths, profile.id, requested);
	await showSummary(ctx, runResultText(result));
}

async function confirmWipeSavedLoadout(ctx: ExtensionCommandContext, profile: CatalogProfile, sources: string[]): Promise<boolean> {
	if (ctx.mode !== "tui") return true;
	return ctx.ui.custom<boolean>((_tui, theme, keybindings, done) => {
		const lines = [
			`Saved loadout: ${profile.id}`,
			`Package sources: ${sources.length}`,
			"",
			"This deletes only the saved recipe.",
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
			const rendered = [theme.fg("warning", theme.bold(`Wipe saved loadout: ${profile.id}`)), "", ...lines, "", theme.fg("warning", "  Enter wipes · Esc cancels")];
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

async function wipeSavedLoadout(ctx: ExtensionCommandContext, query: string): Promise<void> {
	const requested = query.trim();
	if (!requested) {
		showText(ctx, "Usage: /construct wipe <saved-name>");
		return;
	}
	const before = await loadCatalog(ctx);
	if (before.read.state === "ok" && before.warnings.length > 0) {
		showText(ctx, ["Saved loadout not wiped.", `Fix ${before.paths.userCatalogPath} first.`, ...before.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const profile = findSavedLoadout(before.catalog, requested);
	if (!profile) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const sources = savedLoadoutSources(before.catalog, profile);
	const confirmed = await confirmWipeSavedLoadout(ctx, profile, sources);
	if (!confirmed) {
		showText(ctx, "Saved loadout wipe cancelled. No files were changed.");
		return;
	}
	const ready = await waitForIdleBeforeConstructWrite(ctx, "Construct wipe saved loadout");
	if (!ready) {
		showText(ctx, "Saved loadout wipe cancelled. No files were changed.");
		return;
	}
	const fresh = await loadCatalog(ctx);
	if (fresh.read.state === "ok" && fresh.warnings.length > 0) {
		showText(ctx, ["Saved loadout not wiped.", `Fix ${fresh.paths.userCatalogPath} first.`, ...fresh.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const current = findSavedLoadout(fresh.catalog, profile.id) ?? findSavedLoadout(fresh.catalog, requested);
	if (!current) {
		showText(ctx, `Saved loadout not found: ${requested}`);
		return;
	}
	const profiles = fresh.catalog.profiles.filter((entry) => entry.id !== current.id);
	await writeJson(fresh.paths.userCatalogPath, { ...fresh.catalog, version: 1, profiles });
	await showSummary(ctx, [`Wiped saved loadout: ${current.id}`, "No project files were changed."].join("\n"));
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
	if (command === "wipe") {
		await wipeSavedLoadout(ctx, rest);
		return;
	}
	if (command === "import") {
		await importLoadout(ctx, rest);
		return;
	}
	showText(ctx, usage());
}
