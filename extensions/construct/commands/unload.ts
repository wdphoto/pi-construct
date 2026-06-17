import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, JsonReadResult } from "../types.js";
import { findCatalogItem, loadCatalog, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { backupProjectSettingsIfPresent, getPackages, readSettingsObject } from "../project-settings.js";
import { getManagedEntry, managedItemChoices, updateConstructItemEnabled, updateConstructSourcesEnabled } from "../metadata.js";
import { showText } from "../ui.js";

export async function resolveUnloadTarget(
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	query: string,
): Promise<{ construct: JsonReadResult; id?: string; source?: string; label?: string }> {
	const construct = await readJson(paths.projectConstructPath);
	let resolvedQuery = query.trim();
	if (!resolvedQuery && ctx.hasUI) {
		const choices = [...managedItemChoices(construct), "Cancel"];
		if (choices.length === 1) return { construct };
		const selected = await ctx.ui.select("Construct unload: choose item", choices);
		if (!selected || selected === "Cancel") return { construct };
		resolvedQuery = selected.split(":", 1)[0];
	}
	if (!resolvedQuery) return { construct };

	const managed = getManagedEntry(construct, resolvedQuery);
	if (managed) {
		const source = typeof managed.item.requestedSource === "string"
			? managed.item.requestedSource
			: typeof managed.item.source === "string"
				? managed.item.source
				: undefined;
		return { construct, id: managed.id, source, label: managed.id };
	}

	const { catalog } = await loadCatalog(ctx);
	const libraryItem = findCatalogItem(catalog.items, resolvedQuery);
	if (libraryItem) return { construct, source: libraryItem.source, label: libraryItem.id };
	return { construct, source: resolvedQuery, label: resolvedQuery };
}

export async function handleUnloadAll(pi: ExtensionAPI, ctx: ExtensionCommandContext, paths: ConstructPaths): Promise<void> {
	const settings = await readJson(paths.projectSettingsPath);
	if (settings.state === "invalid") {
		showText(ctx, `Cannot unload packages because .pi/settings.json is invalid JSON.\n${settings.error}`);
		return;
	}
	if (settings.state === "ok" && !isObject(settings.data)) {
		showText(ctx, "Cannot unload packages because .pi/settings.json is not a JSON object.");
		return;
	}

	const rawSources = getPackages(settings).filter((pkg) => pkg.form !== "invalid" && pkg.source.trim()).map((pkg) => pkg.source.trim());
	const sources = [...new Set(await packageSourcesFromSettings(paths.projectSettingsPath))];
	if (rawSources.length === 0) {
		showText(ctx, "No project package declarations to unload.");
		return;
	}

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			"Unload ALL project packages?",
			[
				`Project: ${paths.cwd}`,
				`Packages: ${sources.length}`,
				"",
				...sources.map((source) => `- ${source}`),
				"",
				"This runs pi remove <source> -l --approve for each package declaration.",
				"It removes project package declarations only. It does not delete local source files or forget Construct library items.",
			].join("\n"),
		);
		if (!ok) {
			showText(ctx, "Construct unload cancelled.");
			return;
		}
	}

	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not back up .pi/settings.json; aborting unload.\n${message}`);
		return;
	}

	const removed: string[] = [];
	const removeWarnings: string[] = [];
	for (const source of rawSources) {
		const removal = await pi.exec("pi", ["remove", source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
		if (removal.code === 0) {
			removed.push(source);
			continue;
		}
		removeWarnings.push(`pi remove did not match ${source}; removed it by editing .pi/settings.json instead.`);
	}

	try {
		const latestSettings = readSettingsObject(await readJson(paths.projectSettingsPath));
		latestSettings.packages = [];
		await writeJson(paths.projectSettingsPath, latestSettings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not finish clearing project package declarations.\n${message}`);
		return;
	}

	const metadataSources = new Set([...rawSources, ...sources]);
	let metadataChanged = 0;
	const construct = await readJson(paths.projectConstructPath);
	if (construct.state !== "missing") {
		try {
			const update = updateConstructSourcesEnabled(construct, metadataSources, false);
			metadataChanged = update.changed;
			if (metadataChanged > 0) await writeJson(paths.projectConstructPath, update.data);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showText(ctx, `Packages unloaded, but Construct metadata update failed.\n${message}`);
			return;
		}
	}

	showText(
		ctx,
		[
			"Construct unload complete.",
			`Unloaded project packages: ${rawSources.length}`,
			...rawSources.map((source) => `- ${source}`),
			`Project settings: ${paths.projectSettingsPath}`,
			backupPath ? `Settings backup: ${backupPath}` : "Settings backup: none (.pi/settings.json did not exist)",
			metadataChanged > 0 ? `Construct metadata marked unloaded: ${metadataChanged}` : "Construct metadata was not changed.",
			...removeWarnings.map((warning) => `! ${warning}`),
			"Sources remain remembered in Construct if they were in the library.",
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function handleUnload(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const query = args.trim();
	if (!query || query === "all" || query === "--all") {
		await handleUnloadAll(pi, ctx, paths);
		return;
	}

	const { construct, id, source, label } = await resolveUnloadTarget(ctx, paths, query);
	if (!source) {
		showText(ctx, "No Construct item/source selected to unload.");
		return;
	}

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			"Unload from this project?",
			[
				`Source: ${source}`,
				`Project: ${paths.cwd}`,
				"",
				"This runs:",
				`pi remove ${source} -l --approve`,
				"",
				"It removes the project package declaration only. It does not delete local source files or forget the Construct library item.",
			].join("\n"),
		);
		if (!ok) {
			showText(ctx, "Construct unload cancelled.");
			return;
		}
	}

	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not back up .pi/settings.json; aborting unload.\n${message}`);
		return;
	}

	const removal = await pi.exec("pi", ["remove", source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
	if (removal.code !== 0) {
		showText(
			ctx,
			[
				"Construct unload failed during Pi package removal.",
				`Command: pi remove ${source} -l --approve`,
				`Exit code: ${removal.code}`,
				backupPath ? `Settings backup: ${backupPath}` : undefined,
				removal.stdout ? `\nstdout:\n${removal.stdout}` : undefined,
				removal.stderr ? `\nstderr:\n${removal.stderr}` : undefined,
			]
				.filter((line): line is string => line !== undefined)
				.join("\n"),
		);
		return;
	}

	if (id) {
		try {
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, id, false));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showText(ctx, `Package unloaded, but Construct metadata update failed for ${id}.\n${message}`);
			return;
		}
	}

	showText(
		ctx,
		[
			"Construct unload complete.",
			label ? `Item: ${label}` : undefined,
			`Source: ${source}`,
			`Project settings: ${paths.projectSettingsPath}`,
			backupPath ? `Settings backup: ${backupPath}` : "Settings backup: none (.pi/settings.json did not exist)",
			id ? "Construct metadata marked unloaded." : "Construct metadata was not changed.",
			"The source remains remembered in Construct if it was in the library.",
			removal.stdout ? `\npi remove stdout:\n${removal.stdout}` : undefined,
			removal.stderr ? `\npi remove stderr:\n${removal.stderr}` : undefined,
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
