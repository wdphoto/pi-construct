import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, JsonReadResult } from "../types.js";
import { findCatalogItem, loadCatalog, packageSourcesFromSettings } from "../catalog.js";
import { isObject, readJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getPackages } from "../project-settings.js";
import { getManagedEntry } from "../metadata.js";
import { unloadPackageFromProject } from "../package-ops.js";
import { managedPackageSourceIdentity } from "../sources.js";
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

async function loadedManagedTargets(paths: ConstructPaths, construct: JsonReadResult): Promise<Array<{ id: string; source: string }>> {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	const projectSources = new Set(await packageSourcesFromSettings(paths.projectSettingsPath));
	const rawSources = new Set(getPackages(await readJson(paths.projectSettingsPath)).filter((pkg) => pkg.form !== "invalid" && pkg.enabled).map((pkg) => pkg.source));
	const targets: Array<{ id: string; source: string }> = [];
	for (const [id, value] of Object.entries(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (!identity.normalizedInstallSource) continue;
		const isDeclared = [...identity.matchSources].some((source) => rawSources.has(source) || projectSources.has(source));
		if (isDeclared) targets.push({ id, source: identity.normalizedInstallSource });
	}
	return targets.sort((a, b) => a.id.localeCompare(b.id));
}

export async function handleOff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const construct = await readJson(paths.projectConstructPath);
	const targets = await loadedManagedTargets(paths, construct);
	if (targets.length === 0) {
		showText(ctx, "No Construct-managed packages are on in this project. Unsynced local Pi packages were ignored.");
		return;
	}
	const unloaded: Array<{ id: string; source: string }> = [];
	const failures: string[] = [];
	for (const target of targets) {
		const result = await unloadPackageFromProject(pi, paths, { source: target.source, id: target.id });
		if (result.ok) unloaded.push(target);
		else failures.push(`${target.id}: ${result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`}`);
	}
	showText(
		ctx,
		[
			"Construct off complete.",
			`Turned off packages: ${unloaded.length}`,
			...unloaded.map((target) => `- ${target.id}: ${target.source}`),
			...failures.map((failure) => `! ${failure}`),
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

	if (!query && ctx.mode === "tui") {
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
		const unloaded: Array<{ id: string; source: string }> = [];
		const failures: string[] = [];
		for (const target of toUnload) {
			const result = await unloadPackageFromProject(pi, paths, { source: target.source, id: target.id });
			if (result.ok) unloaded.push(target);
			else failures.push(`${target.id}: ${result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`}`);
		}
		showText(
			ctx,
			[
				"Construct unload selections applied.",
				`Turned off packages: ${unloaded.length}/${toUnload.length}`,
				...unloaded.map((target) => `- ${target.id}: ${target.source}`),
				...failures.map((failure) => `! ${failure}`),
				"Reload Pi resources with /construct reload or /reload when ready.",
			].join("\n"),
		);
		return;
	}

	const { id, source, label } = await resolveUnloadTarget(ctx, paths, query);
	if (!source) {
		showText(ctx, "No loaded Construct-managed package selected. Use /construct unload <source-or-id>, or /construct toggle to turn the managed loadout off/on.");
		return;
	}

	if (ctx.hasUI) ctx.ui.setStatus("construct", `Construct: disabling ${label ?? source}`);
	else showText(ctx, [`Disabling in this project...`, `Source: ${source}`].join("\n"));

	const unload = await unloadPackageFromProject(pi, paths, { source, id });
	if (!unload.ok) {
		if (ctx.hasUI) ctx.ui.setStatus("construct", undefined);
		if (unload.metadataOnlyFailure) {
			showText(ctx, `Package disabled, but Construct metadata update failed for ${id}.\n${unload.error ?? "Unknown error"}`);
			return;
		}
		if (unload.exitCode !== undefined) {
			showText(
				ctx,
				[
					"Construct unload failed during Pi package removal.",
					`Command: pi remove ${source} -l --approve`,
					`Exit code: ${unload.exitCode}`,
					unload.backupPath ? `Settings backup: ${unload.backupPath}` : undefined,
					unload.stdout ? `\nstdout:\n${unload.stdout}` : undefined,
					unload.stderr ? `\nstderr:\n${unload.stderr}` : undefined,
				]
					.filter((line): line is string => line !== undefined)
					.join("\n"),
			);
			return;
		}
		showText(ctx, unload.error ?? "Construct unload failed.");
		return;
	}

	const backupPath = unload.backupPath;
	const fallbackWarning = unload.fallbackWarning;

	if (ctx.hasUI) ctx.ui.setStatus("construct", undefined);
	showText(
		ctx,
		[
			"Construct disable complete.",
			label ? `Disabled in this project: ${label}` : "Disabled in this project.",
			`Source: ${source}`,
			backupPath ? `Settings backup: ${backupPath}` : undefined,
			id ? "Construct metadata marked disabled." : "Construct metadata was not changed.",
			fallbackWarning ? `! ${fallbackWarning}` : undefined,
			"The source remains remembered in Construct if it was in the library.",
			"Reload Pi resources with /construct reload or /reload when ready.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
