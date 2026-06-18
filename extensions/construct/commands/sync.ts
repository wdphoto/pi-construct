import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { dirname } from "node:path";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, parseCatalog, syncSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages, parseProjectConstruct, uniqueManagedId, upsertConstructItem } from "../project-settings.js";
import { pickCheckboxes, showText, type CheckboxPickerItem } from "../ui.js";

interface SyncCandidate {
	id: string;
	source: string;
}

async function constructManagedSources(paths: Awaited<ReturnType<typeof getPaths>>): Promise<Set<string>> {
	const construct = await readJson(paths.projectConstructPath);
	const sources = new Set<string>();
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return sources;
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		for (const source of [value.source, value.requestedSource]) {
			if (typeof source !== "string" || !source.trim()) continue;
			sources.add(source.trim());
			sources.add(await normalizeSourceForLibrary(source, dirname(paths.projectSettingsPath)));
		}
	}
	return sources;
}

async function unsyncedProjectPackages(paths: Awaited<ReturnType<typeof getPaths>>): Promise<SyncCandidate[]> {
	const settings = await readJson(paths.projectSettingsPath);
	const managedSources = await constructManagedSources(paths);
	const seen = new Set<string>();
	const candidates: SyncCandidate[] = [];
	for (const pkg of getPackages(settings)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		const source = await normalizeSourceForLibrary(pkg.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(pkg.source) || managedSources.has(source) || seen.has(source)) continue;
		seen.add(source);
		candidates.push({ id: deriveId(source), source });
	}
	return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

export async function handleSync(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const subcommand = args.trim() || "current";
	const paths = await getPaths(ctx);

	if (subcommand === "status") {
		showText(
			ctx,
			[
				"Construct sync",
				"==============",
				"Automatic sync: off (manual; use /construct sync)",
				"",
				"/construct sync adopts unsynced project package sources into Construct only when you run it.",
				"Sync never installs, removes, enables, reloads, or copies anything.",
			].join("\n"),
		);
		return;
	}

	if (!["current", "project"].includes(subcommand)) {
		showText(ctx, "Usage: /construct sync [project|status]\n\nConstruct sync only reads this project's local package declarations from .pi/settings.json.");
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

	let candidates: SyncCandidate[];
	try {
		candidates = await unsyncedProjectPackages(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct sync failed.\n${message}`);
		return;
	}

	if (candidates.length === 0) {
		showText(
			ctx,
			[
				"Construct sync complete.",
				`Project: ${paths.cwd}`,
				"No unsynced local package declarations found.",
				"Sync only adopts project packages that are not already Construct-managed.",
			].join("\n"),
		);
		return;
	}

	let selectedSources = candidates.map((candidate) => candidate.source);
	if (ctx.hasUI && candidates.length > 1) {
		const pickerItems: CheckboxPickerItem[] = candidates.map((candidate) => ({
			id: candidate.source,
			label: candidate.id,
			value: candidate.source,
			checked: true,
		}));
		const selected = await pickCheckboxes(ctx, "Sync local-only packages into Construct", pickerItems);
		if (!selected) {
			showText(ctx, "Construct sync cancelled. No files were changed.");
			return;
		}
		selectedSources = selected;
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
	const syncedLines = selectedSources.map((source) => {
		const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
		const status = addedBySource.has(source) ? "added" : "already remembered";
		return `- ${item?.id ?? "<unknown>"}: ${source} (${status})`;
	});

	let metadataChanged = 0;
	try {
		let construct = parseProjectConstruct(constructRead);
		for (const source of selectedSources) {
			const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
			const itemId = uniqueManagedId(item?.id ?? deriveId(source), constructRead, source);
			construct = upsertConstructItem(construct, itemId, source, source, paths);
			metadataChanged += 1;
		}
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Could not update project Construct metadata: ${message}`);
	}

	showText(
		ctx,
		[
			"Construct sync complete.",
			`Project: ${paths.cwd}`,
			`Project settings: ${paths.projectSettingsPath}`,
			"",
			"Local-only package declarations adopted into Construct:",
			...(syncedLines.length > 0 ? syncedLines : ["- none"]),
			"",
			`Added to Construct: ${added.length}`,
			`Already remembered: ${alreadyKnown}`,
			metadataChanged > 0 ? `Project Construct items armed: ${metadataChanged}` : undefined,
			...warnings.map((warning) => `! ${warning}`),
			"",
			"Sync is adoption-only. It never installs or removes package declarations; it may update the Construct library and .pi/construct.json metadata.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

