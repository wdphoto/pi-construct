import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { syncGlobalPackagesToCatalog, syncProjectPackagesToCatalog } from "../catalog.js";
import { describeRead, readJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getAutosync, writeAutosync } from "../user-settings.js";
import { showText } from "../ui.js";

export async function handleSync(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const subcommand = args.trim() || "current";
	const paths = await getPaths(ctx);

	if (subcommand === "status") {
		const settings = await readJson(paths.userSettingsPath);
		const autosync = getAutosync(settings);
		showText(
			ctx,
			[
				"Construct sync",
				"==============",
				`Invisible sync: ${autosync.note}`,
				`Settings: ${describeRead(settings)}`,
				"",
				"/construct sync remembers current project package sources now.",
				"/construct sync on remembers project package sources automatically on session shutdown.",
				"Sync never installs, removes, enables, or copies anything.",
			].join("\n"),
		);
		return;
	}

	if (subcommand === "on" || subcommand === "off") {
		try {
			await writeAutosync(paths, subcommand === "on");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showText(ctx, `Could not update sync settings.\n${message}`);
			return;
		}
		showText(
			ctx,
			[
				`Construct invisible sync ${subcommand === "on" ? "enabled" : "disabled"}.`,
				`Settings: ${paths.userSettingsPath}`,
				"Sync is remember-only. It never installs anything automatically.",
			].join("\n"),
		);
		return;
	}

	if (!["current", "project", "global", "all"].includes(subcommand)) {
		showText(ctx, "Usage: /construct sync [on|off|status]");
		return;
	}

	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	const warnings: string[] = [];
	try {
		if (subcommand === "current" || subcommand === "project" || subcommand === "all") {
			const result = await syncProjectPackagesToCatalog(ctx);
			added.push(...result.added);
			alreadyKnown += result.alreadyKnown;
			warnings.push(...result.warnings);
		}
		if (subcommand === "global" || subcommand === "all") {
			const result = await syncGlobalPackagesToCatalog(ctx);
			added.push(...result.added);
			alreadyKnown += result.alreadyKnown;
			warnings.push(...result.warnings);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct sync failed.\n${message}`);
		return;
	}

	showText(
		ctx,
		[
			"Construct sync complete.",
			added.length > 0 ? "New remembered sources:" : "No new sources remembered.",
			...added.map((item) => `- ${item.id}: ${item.source}`),
			alreadyKnown > 0 ? `Already synced: ${alreadyKnown}` : undefined,
			...warnings.map((warning) => `! ${warning}`),
			"",
			"Sync is remember-only. It never installs or edits this project.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
	);
}

export async function handleAutosync(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const settings = await readJson(paths.userSettingsPath);
	const autosync = getAutosync(settings);
	const subcommand = args.trim();
	if (subcommand === "status") {
		showText(
			ctx,
			[
				"Construct sync compatibility",
				"============================",
				`Invisible sync: ${autosync.note}`,
				`Settings: ${describeRead(settings)}`,
				"",
				"Use /construct sync on|off|status. This compatibility command will remain hidden.",
				"Invisible sync remembers package declarations on session shutdown. It never installs anything automatically.",
			].join("\n"),
		);
		return;
	}
	if (subcommand && subcommand !== "on" && subcommand !== "off") {
		showText(ctx, "Usage: /construct sync [on|off|status]");
		return;
	}
	const enabled = subcommand === "on" ? true : subcommand === "off" ? false : !autosync.enabled;
	try {
		await writeAutosync(paths, enabled);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not update autosync settings.\n${message}`);
		return;
	}
	showText(
		ctx,
		[
			`Construct invisible sync ${enabled ? "enabled" : "disabled"}.`,
			`Settings: ${paths.userSettingsPath}`,
			"Sync is remember-only. On session shutdown it remembers package sources from .pi/settings.json.",
		].join("\n"),
	);
}
