import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, JsonObject, JsonReadResult } from "../types.js";
import { findCatalogItem, loadCatalog, normalizeSourceForLibrary, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { backupProjectSettingsIfPresent, getPackages, packageSource, readSettingsObject } from "../project-settings.js";
import { getManagedEntry, updateConstructItemEnabled, updateConstructSourcesEnabled } from "../metadata.js";
import { pickCheckboxes, showText } from "../ui.js";

export async function resolveUnloadTarget(
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	query: string,
): Promise<{ construct: JsonReadResult; id?: string; source?: string; label?: string }> {
	const construct = await readJson(paths.projectConstructPath);
	let resolvedQuery = query.trim();
	if (!resolvedQuery && ctx.hasUI) {
		const settings = await readJson(paths.projectSettingsPath);
		const packageDeclarations = getPackages(settings).filter((pkg) => pkg.form !== "invalid" && pkg.enabled && pkg.source.trim());
		const choiceToTarget = new Map<string, { id?: string; source: string; label: string }>();
		const choices = packageDeclarations.map((pkg) => {
			const managed = getManagedEntry(construct, pkg.source);
			const label = managed?.id ?? pkg.source;
			const choice = managed ? `${managed.id}: ${pkg.source}` : pkg.source;
			choiceToTarget.set(choice, { id: managed?.id, source: pkg.source, label });
			return choice;
		});
		choices.push("Cancel");
		if (choices.length === 1) return { construct };
		const selected = await ctx.ui.select("Construct unload: loaded in this project", choices);
		if (!selected || selected === "Cancel") return { construct };
		const target = choiceToTarget.get(selected);
		if (target) return { construct, ...target };
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

function managedPackageSource(item: JsonObject): string | undefined {
	return typeof item.requestedSource === "string"
		? item.requestedSource
		: typeof item.source === "string"
			? item.source
			: undefined;
}

async function loadedManagedTargets(paths: ConstructPaths, construct: JsonReadResult): Promise<Array<{ id: string; source: string }>> {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	const projectSources = new Set(await packageSourcesFromSettings(paths.projectSettingsPath));
	const rawSources = new Set(getPackages(await readJson(paths.projectSettingsPath)).filter((pkg) => pkg.form !== "invalid" && pkg.enabled).map((pkg) => pkg.source));
	const targets: Array<{ id: string; source: string }> = [];
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const source = managedPackageSource(value);
		if (!source) continue;
		const normalized = await normalizeSourceForLibrary(source, dirname(paths.projectSettingsPath));
		if (rawSources.has(source) || projectSources.has(normalized)) targets.push({ id, source });
	}
	return targets.sort((a, b) => a.id.localeCompare(b.id));
}

async function removeMatchingPackageDeclaration(paths: ConstructPaths, source: string): Promise<boolean> {
	const settings = readSettingsObject(await readJson(paths.projectSettingsPath));
	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const nextPackages = [];
	let removed = false;
	for (const entry of packages) {
		const rawSource = packageSource(entry);
		if (!rawSource) {
			nextPackages.push(entry);
			continue;
		}
		const normalized = await normalizeSourceForLibrary(rawSource, dirname(paths.projectSettingsPath));
		if (rawSource === source || normalized === source) {
			removed = true;
			continue;
		}
		nextPackages.push(entry);
	}
	if (!removed) return false;
	settings.packages = nextPackages;
	await writeJson(paths.projectSettingsPath, settings);
	return true;
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

export async function handleOff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const construct = await readJson(paths.projectConstructPath);
	const targets = await loadedManagedTargets(paths, construct);
	if (targets.length === 0) {
		showText(ctx, "No Construct-managed packages are on in this project. Unsynced local Pi packages were ignored.");
		return;
	}
	for (const target of targets) {
		await handleUnload(target.id, pi, ctx);
	}
	showText(
		ctx,
		[
			"Construct off complete.",
			`Turned off packages: ${targets.length}`,
			...targets.map((target) => `- ${target.id}: ${target.source}`),
			"Reload Pi resources with /construct reload or /reload when ready.",
		].join("\n"),
	);
}

export async function handleUnload(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const query = args.trim();
	if (query === "all" || query === "--all") {
		showText(ctx, "Unload-all moved to /construct off and now only affects Construct-managed packages. Unsynced local Pi packages are ignored.");
		return;
	}

	if (!query && ctx.hasUI) {
		const construct = await readJson(paths.projectConstructPath);
		const targets = await loadedManagedTargets(paths, construct);
		if (targets.length === 0) {
			showText(ctx, "No Construct-managed packages are loaded in this project. Unsynced local Pi packages are ignored; run /construct sync to adopt them.");
			return;
		}
		const selectedIds = await pickCheckboxes(
			ctx,
			"Construct unload — uncheck packages to turn off",
			targets.map((target) => ({
				id: target.id,
				label: target.id,
				value: target.source,
				checked: true,
			})),
		);
		if (!selectedIds) {
			showText(ctx, "Construct unload cancelled. No files were changed.");
			return;
		}
		const keep = new Set(selectedIds);
		const toUnload = targets.filter((target) => !keep.has(target.id));
		if (toUnload.length === 0) {
			showText(ctx, "No packages were unchecked. No files were changed.");
			return;
		}
		for (const target of toUnload) {
			await handleUnload(target.id, pi, ctx);
		}
		showText(
			ctx,
			[
				"Construct unload selections applied.",
				`Turned off packages: ${toUnload.length}`,
				...toUnload.map((target) => `- ${target.id}: ${target.source}`),
				"Reload Pi resources with /construct reload or /reload when ready.",
			].join("\n"),
		);
		return;
	}

	const { construct, id, source, label } = await resolveUnloadTarget(ctx, paths, query);
	if (!source) {
		showText(ctx, "No loaded package selected. Use /construct unload <source-or-id>, or /construct wipe to unload every project package declaration.");
		return;
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
	let fallbackWarning: string | undefined;
	if (removal.code !== 0) {
		try {
			const removedByEdit = await removeMatchingPackageDeclaration(paths, source);
			if (!removedByEdit) {
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
			fallbackWarning = `pi remove did not match ${source}; removed it by editing .pi/settings.json instead.`;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showText(ctx, `Construct unload failed during fallback settings edit.\n${message}`);
			return;
		}
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
			fallbackWarning ? `! ${fallbackWarning}` : undefined,
			"The source remains remembered in Construct if it was in the library.",
			removal.stdout ? `\npi remove stdout:\n${removal.stdout}` : undefined,
			removal.stderr ? `\npi remove stderr:\n${removal.stderr}` : undefined,
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
