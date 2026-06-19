import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { dirname } from "node:path";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, parseCatalog, syncSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages, parseProjectConstruct, uniqueManagedIdInConstruct, upsertConstructItem } from "../project-settings.js";
import { managedPackageSourceIdentity } from "../sources.js";
import { pickCheckboxes, showSummary, showText, type CheckboxPickerItem } from "../ui.js";

interface SyncCandidate {
	id: string;
	source: string;
	alreadyKnown?: boolean;
}

interface SyncArgs {
	mode: "menu" | "auto" | "off";
	warnings: string[];
}

async function constructManagedSources(paths: Awaited<ReturnType<typeof getPaths>>): Promise<Set<string>> {
	const construct = await readJson(paths.projectConstructPath);
	const sources = new Set<string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return sources;
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		for (const source of identity.matchSources) sources.add(source);
	}
	return sources;
}

async function projectSyncCandidates(paths: Awaited<ReturnType<typeof getPaths>>): Promise<{ adoptable: SyncCandidate[]; alreadyManaged: SyncCandidate[] }> {
	const settings = await readJson(paths.projectSettingsPath);
	const managedSources = await constructManagedSources(paths);
	const { catalog } = await loadCatalog({ cwd: paths.cwd });
	const catalogItemsBySource = new Map<string, string>();
	for (const item of catalog.items) {
		catalogItemsBySource.set(item.source, item.id);
		catalogItemsBySource.set(await normalizeSourceForLibrary(item.source, dirname(paths.projectSettingsPath)), item.id);
	}

	const seen = new Set<string>();
	const adoptable: SyncCandidate[] = [];
	const alreadyManaged: SyncCandidate[] = [];
	for (const pkg of getPackages(settings)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		const source = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (seen.has(source)) continue;
		seen.add(source);
		const catalogId = catalogItemsBySource.get(pkg.source) ?? catalogItemsBySource.get(source);
		const candidate = { id: catalogId ?? deriveId(source), source, alreadyKnown: catalogId !== undefined };
		if (managedSources.has(pkg.source) || managedSources.has(source)) alreadyManaged.push(candidate);
		else adoptable.push(candidate);
	}
	return {
		adoptable: adoptable.sort((a, b) => a.id.localeCompare(b.id)),
		alreadyManaged: alreadyManaged.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function parseSyncArgs(args: string): SyncArgs {
	const tokens = args.split(/\s+/).filter(Boolean);
	const warnings: string[] = [];
	let mode: SyncArgs["mode"] = "menu";
	for (const token of tokens) {
		if (token === "auto" || token === "-a" || token === "--all") mode = "auto";
		else if (token === "on" || token === "current" || token === "project") mode = "menu";
		else if (token === "off") mode = "off";
		else if (token === "status") warnings.push("/construct sync status moved into /construct status.");
		else warnings.push(`Unknown sync argument ignored: ${token}`);
	}
	return { mode, warnings };
}

export async function handleSync(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const syncArgs = parseSyncArgs(args);
	const paths = await getPaths(ctx);

	if (syncArgs.mode === "off") {
		showText(ctx, "Construct automatic sync is already off. Sync only runs when you explicitly use /construct sync or /construct sync auto.");
		return;
	}

	if (syncArgs.warnings.length > 0) {
		showText(ctx, ["Usage: /construct sync [auto|on|off]", "", "Construct sync only reads this project's local package declarations from .pi/settings.json.", ...syncArgs.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const settingsRead = await readJson(paths.projectSettingsPath);
	if (settingsRead.state === "invalid") {
		showText(ctx, `Construct sync failed.\nCannot sync because .pi/settings.json is invalid JSON.\n${settingsRead.error}`);
		return;
	}
	if (settingsRead.state === "ok" && !isObject(settingsRead.data)) {
		showText(ctx, "Construct sync failed.\nCannot sync because .pi/settings.json is not a JSON object.");
		return;
	}

	const constructRead = await readJson(paths.projectConstructPath);
	if (constructRead.state === "invalid") {
		showText(ctx, `Construct sync failed.\nCannot sync because .pi/construct.json is invalid JSON.\n${constructRead.error}`);
		return;
	}
	if (constructRead.state === "ok" && !isObject(constructRead.data)) {
		showText(ctx, "Construct sync failed.\nCannot sync because .pi/construct.json is not a JSON object.");
		return;
	}

	const catalogRead = await readJson(paths.userCatalogPath);
	if (catalogRead.state === "invalid") {
		showText(ctx, `Construct sync failed.\nCannot sync because Construct library catalog is invalid JSON.\n${catalogRead.error}`);
		return;
	}
	const catalogCheck = parseCatalog(catalogRead);
	if (catalogRead.state === "ok" && catalogCheck.warnings.length > 0) {
		showText(ctx, [`Construct sync failed.`, `Cannot sync because Construct library catalog has structural warnings. Fix ${paths.userCatalogPath} first.`, ...catalogCheck.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	let candidates: { adoptable: SyncCandidate[]; alreadyManaged: SyncCandidate[] };
	try {
		candidates = await projectSyncCandidates(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct sync failed.\n${message}`);
		return;
	}

	if (candidates.adoptable.length === 0) {
		showText(
			ctx,
			[
				"Construct sync complete.",
				`Project: ${paths.cwd}`,
				"No project package declarations are waiting to be adopted.",
				candidates.alreadyManaged.length > 0 ? `Already Construct-managed here: ${candidates.alreadyManaged.length}` : "No Construct-managed project packages found.",
				"No files were changed.",
			].join("\n"),
		);
		return;
	}

	let selectedSources: string[] = [];
	if (syncArgs.mode === "auto") {
		selectedSources = candidates.adoptable.map((candidate) => candidate.source);
	} else if (ctx.mode === "tui") {
		const pickerItems: CheckboxPickerItem[] = [
			...candidates.adoptable.map((candidate) => ({
				id: candidate.source,
				label: candidate.id,
				value: candidate.source,
				description: candidate.alreadyKnown ? "Already in the Construct library; sync will arm project metadata." : undefined,
				checked: false,
				section: "NOT IN CONSTRUCT — available to adopt",
			})),
			...candidates.alreadyManaged.map((candidate) => ({
				id: `managed:${candidate.source}`,
				label: candidate.id,
				value: candidate.source,
				checked: true,
				disabled: true,
				section: "ALREADY IN CONSTRUCT — read-only",
				marker: "[x]",
			})),
		];
		const selected = await pickCheckboxes(ctx, "Construct sync — adopt project packages", pickerItems);
		if (!selected) {
			showText(ctx, "Construct sync cancelled. No files were changed.");
			return;
		}
		const adoptableSources = new Set(candidates.adoptable.map((candidate) => candidate.source));
		selectedSources = selected.filter((source) => adoptableSources.has(source));
	} else {
		showText(
			ctx,
			[
				"Construct sync needs a selection.",
				`Project: ${paths.cwd}`,
				`Available to adopt: ${candidates.adoptable.length}`,
				...candidates.adoptable.map((candidate) => `- ${candidate.id}: ${candidate.source}`),
				candidates.alreadyManaged.length > 0 ? `Already Construct-managed here: ${candidates.alreadyManaged.length}` : undefined,
				"",
				"Run /construct sync in the TUI to choose items, or /construct sync auto to adopt all new project package sources.",
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	if (selectedSources.length === 0) {
		showText(ctx, "No packages selected for Construct sync. No files were changed.");
		return;
	}

	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	const warnings: string[] = [];
	try {
		const result = await syncSourcesToCatalog(ctx, selectedSources);
		added.push(...result.added);
		alreadyKnown += result.alreadyKnown;
		warnings.push(...result.warnings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct sync failed.\n${message}`);
		return;
	}

	const addedBySource = new Map(added.map((item) => [item.source, item]));
	const { catalog } = await loadCatalog(ctx);
	const skipped = Math.max(0, selectedSources.length - added.length);

	let metadataChanged = 0;
	try {
		let construct = parseProjectConstruct(constructRead);
		for (const source of selectedSources) {
			const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
			const itemId = uniqueManagedIdInConstruct(construct, item?.id ?? deriveId(source), source);
			construct = upsertConstructItem(construct, itemId, source, source, paths);
			metadataChanged += 1;
		}
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Could not update project Construct metadata: ${message}`);
	}

	await showSummary(
		ctx,
		[
			"Construct sync complete.",
			`Added to Construct: ${added.length}`,
			`Skipped/already known: ${Math.max(skipped, alreadyKnown)}`,
			`Errors: ${warnings.length}`,
			metadataChanged > 0 ? `Project items armed: ${metadataChanged}` : undefined,
			...warnings.map((warning) => `! ${warning}`),
			"No /reload needed; sync only updates the Construct library and project metadata.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

