import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogItem, ConstructPaths } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, normalizeSourceForLibrary, packageSourcesFromSettings, syncProjectPackagesToCatalog, uniqueId } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { backupProjectSettingsIfPresent, chooseDeclaredSource, getPackages, looksLikePackageSource, parseProjectConstruct, uniqueManagedId, upsertConstructItem } from "../project-settings.js";
import { showText } from "../ui.js";
import { handleUnload } from "./unload.js";

export function parseLoadFlags(args: string): { dryRun: boolean; query: string } {
	const tokens = args.split(/\s+/).filter(Boolean);
	const remaining: string[] = [];
	let dryRun = false;
	for (const token of tokens) {
		if (token === "--dry-run" || token === "-n") dryRun = true;
		else remaining.push(token);
	}
	return { dryRun, query: remaining.join(" ") };
}

export function buildLoadPreview(paths: ConstructPaths, source: string, item: CatalogItem | undefined, warnings: string[], dryRun: boolean): string {
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

export async function managedCatalogItems(paths: ConstructPaths): Promise<CatalogItem[]> {
	const construct = await readJson(paths.projectConstructPath);
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];

	const items: CatalogItem[] = [];
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const rawSource = typeof value.requestedSource === "string"
			? value.requestedSource
			: typeof value.source === "string"
				? value.source
				: undefined;
		if (!rawSource) continue;
		items.push({ id, kind: "package", source: await normalizeSourceForLibrary(rawSource, dirname(paths.projectSettingsPath)), managed: true });
	}
	return items;
}

export async function loadPickerItems(paths: ConstructPaths, catalog: CatalogData): Promise<CatalogItem[]> {
	const items = [...(await managedCatalogItems(paths))];
	const sources = new Set(items.map((item) => item.source));
	const ids = new Set(items.map((item) => item.id));
	for (const catalogItem of catalog.items) {
		if (sources.has(catalogItem.source)) continue;
		const id = ids.has(catalogItem.id) ? uniqueId(catalogItem.id, items) : catalogItem.id;
		const item = { ...catalogItem, id };
		items.push(item);
		sources.add(item.source);
		ids.add(item.id);
	}
	return items.sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolveLoadSource(
	args: string,
	ctx: ExtensionCommandContext,
): Promise<{ source?: string; item?: CatalogItem; alreadyInstalled?: boolean; action?: "unloadAll"; warnings: string[] }> {
	const { paths, catalog, warnings } = await loadCatalog(ctx);
	const items = await loadPickerItems(paths, catalog);
	const query = args.trim();
	if (query) {
		const item = findCatalogItem(items, query);
		return item ? { source: item.source, item, warnings } : { source: query, warnings };
	}

	if (!ctx.hasUI) return { warnings };
	if (items.length === 0) {
		const choices = ["Enter source manually", "Cancel"];
		const selected = await ctx.ui.select("Your Construct library is empty", choices);
		if (!selected || selected === "Cancel") return { warnings };
		const source = await ctx.ui.input("Pi package source", "npm:@scope/package");
		return source?.trim() ? { source: source.trim(), warnings } : { warnings };
	}

	const projectSources = new Set(await packageSourcesFromSettings(paths.projectSettingsPath));
	const choiceToResolution = new Map<string, { item: CatalogItem; alreadyInstalled: boolean }>();
	const choices = items.map((item) => {
		const alreadyInstalled = projectSources.has(item.source);
		const label = item.name ?? item.id;
		const choice = `${alreadyInstalled ? "[x]" : "[ ]"} ${label}  ${item.source}`;
		choiceToResolution.set(choice, { item, alreadyInstalled });
		return choice;
	});
	choices.push("Enter source manually", "Unload all project packages", "Cancel");

	const selected = await ctx.ui.select("Construct — project loadout", choices);
	if (!selected || selected === "Cancel") return { warnings };
	if (selected === "Unload all project packages") return { action: "unloadAll", warnings };
	if (selected === "Enter source manually") {
		const source = await ctx.ui.input("Pi package source", "npm:@scope/package");
		return source?.trim() ? { source: source.trim(), warnings } : { warnings };
	}
	const resolution = choiceToResolution.get(selected);
	return resolution
		? { source: resolution.item.source, item: resolution.item, alreadyInstalled: resolution.alreadyInstalled, warnings }
		: { warnings: [...warnings, `Could not resolve selected library item: ${selected}`] };
}

export async function handleLoad(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const flags = parseLoadFlags(args);
	const sync = flags.dryRun ? { added: [], warnings: [] } : await syncProjectPackagesToCatalog(ctx);
	const resolved = await resolveLoadSource(flags.query, ctx);

	if (resolved.action === "unloadAll") {
		await handleUnload("all", pi, ctx);
		return;
	}

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

	if (resolved.alreadyInstalled) {
		if (ctx.hasUI) {
			const action = await ctx.ui.select(
				"Already loaded in this project",
				[
					"Unload this package from this project",
					"Keep it loaded",
				],
			);
			if (action === "Unload this package from this project") {
				await handleUnload(resolved.source, pi, ctx);
				return;
			}
			showText(ctx, "Construct picker closed. No files were changed.");
			return;
		}

		showText(
			ctx,
			[
				"Already installed in this project.",
				`Source: ${resolved.source}`,
				`Project: ${paths.cwd}`,
				"",
				"Checked items are already declared in .pi/settings.json. Choose an unchecked item to add it here, or run /construct unload <source-or-id>.",
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

	const install = await pi.exec("pi", ["install", resolved.source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
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
	const itemId = resolved.item?.managed ? resolved.item.id : uniqueManagedId(resolved.item?.id ?? deriveId(resolved.source), constructRead, declaredSource);
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
