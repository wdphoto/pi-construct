import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { chooseDeclaredSource, getPackages, removeMatchingPackageDeclaration, backupProjectSettingsIfPresent, parseProjectConstruct, upsertConstructItem } from "../project-settings.js";
import { removeConstructItem, resolveManagedEntry, updateConstructItemEnabled } from "../metadata.js";
import { showText } from "../ui.js";

export async function handleDisable(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "disable");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to disable.");
		return;
	}
	if (typeof item.source !== "string") {
		showText(ctx, `Cannot disable ${id}: metadata has no package source.`);
		return;
	}

	let removal: { removed: boolean; backupPath?: string; settingsMissing: boolean };
	try {
		removal = await removeMatchingPackageDeclaration(paths, item.source);
		await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, id, false));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Disable failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Disabled Construct item: ${id}`,
			`Source: ${item.source}`,
			removal.removed ? `Removed package declaration from: ${paths.projectSettingsPath}` : "Package declaration was not present in .pi/settings.json.",
			removal.backupPath ? `Settings backup: ${removal.backupPath}` : undefined,
			removal.settingsMissing ? ".pi/settings.json was missing; only Construct metadata was updated." : undefined,
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function handleRemove(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "remove");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to remove.");
		return;
	}
	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Remove Construct item?", `Remove ${id} from this project?\n\nThis removes the package declaration and Construct metadata only. It does not delete caches or files.`);
		if (!ok) {
			showText(ctx, "Construct remove cancelled.");
			return;
		}
	}

	let removal: { removed: boolean; backupPath?: string; settingsMissing: boolean } = { removed: false, settingsMissing: false };
	try {
		if (typeof item.source === "string") removal = await removeMatchingPackageDeclaration(paths, item.source);
		await writeJson(paths.projectConstructPath, removeConstructItem(construct, id));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Remove failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Removed Construct item: ${id}`,
			typeof item.source === "string" ? `Source: ${item.source}` : undefined,
			removal.removed ? `Removed package declaration from: ${paths.projectSettingsPath}` : "Package declaration was not present in .pi/settings.json.",
			removal.backupPath ? `Settings backup: ${removal.backupPath}` : undefined,
			"No package caches or files were deleted.",
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function handleEnable(args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const { construct, id, item } = await resolveManagedEntry(ctx, paths, args, "enable");
	if (!id || !item) {
		showText(ctx, "No Construct-managed item selected/found to enable.");
		return;
	}
	const source = typeof item.requestedSource === "string" ? item.requestedSource : typeof item.source === "string" ? item.source : undefined;
	if (!source) {
		showText(ctx, `Cannot enable ${id}: metadata has no package source.`);
		return;
	}

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Enable Construct item?", `Enable ${id} in this project?\n\nEquivalent Pi command:\npi install ${source} -l --approve`);
		if (!ok) {
			showText(ctx, "Construct enable cancelled.");
			return;
		}
	}

	const beforePackages = getPackages(await readJson(paths.projectSettingsPath));
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not back up .pi/settings.json; aborting enable.\n${message}`);
		return;
	}

	const install = await pi.exec("pi", ["install", source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
	if (install.code !== 0) {
		showText(
			ctx,
			[
				`Enable failed during Pi package install for ${id}.`,
				`Command: pi install ${source} -l --approve`,
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
	const declaredSource = chooseDeclaredSource(beforePackages, afterPackages, source);
	try {
		const constructRoot = upsertConstructItem(parseProjectConstruct(construct), id, declaredSource, source, paths);
		await writeJson(paths.projectConstructPath, constructRoot);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Package enabled, but Construct metadata update failed for ${id}.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			`Enabled Construct item: ${id}`,
			`Source: ${source}`,
			declaredSource === source ? undefined : `Declared package source: ${declaredSource}`,
			backupPath ? `Settings backup: ${backupPath}` : "Settings backup: none (.pi/settings.json did not exist)",
			install.stdout ? `\npi install stdout:\n${install.stdout}` : undefined,
			install.stderr ? `\npi install stderr:\n${install.stderr}` : undefined,
			"Reload Pi resources with /construct reload or /reload.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}
