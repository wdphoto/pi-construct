import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, packageSourcesFromSettings, syncProjectPackagesToCatalog } from "../catalog.js";
import { describeRead, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { parseProjectConstruct, uniqueManagedId, upsertConstructItem } from "../project-settings.js";
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

	if (!["current", "project"].includes(subcommand)) {
		showText(ctx, "Usage: /construct sync [project|on|off|status]\n\nConstruct sync only reads this project's local package declarations from .pi/settings.json.");
		return;
	}

	const added: CatalogItem[] = [];
	let alreadyKnown = 0;
	const warnings: string[] = [];
	try {
		const result = await syncProjectPackagesToCatalog(ctx);
		added.push(...result.added);
		alreadyKnown += result.alreadyKnown;
		warnings.push(...result.warnings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Construct sync failed.\n${message}`);
		return;
	}

	const localSources = await packageSourcesFromSettings(paths.projectSettingsPath);
	const addedBySource = new Map(added.map((item) => [item.source, item]));
	const { catalog } = await loadCatalog(ctx);
	const syncedLines = localSources.map((source) => {
		const item = addedBySource.get(source) ?? findCatalogItem(catalog.items, source);
		const status = addedBySource.has(source) ? "added" : "already remembered";
		return `- ${item?.id ?? "<unknown>"}: ${source} (${status})`;
	});

	let metadataChanged = 0;
	if (localSources.length > 0) {
		const constructRead = await readJson(paths.projectConstructPath);
		try {
			let construct = parseProjectConstruct(constructRead);
			for (const source of localSources) {
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
	}

	showText(
		ctx,
		[
			"Construct sync complete.",
			`Project: ${paths.cwd}`,
			`Project settings: ${paths.projectSettingsPath}`,
			"",
			"Local package installs remembered from this project:",
			...(syncedLines.length > 0 ? syncedLines : ["- none"]),
			"",
			`Added to Construct: ${added.length}`,
			`Already remembered: ${alreadyKnown}`,
			metadataChanged > 0 ? `Project Construct items armed: ${metadataChanged}` : undefined,
			...warnings.map((warning) => `! ${warning}`),
			"",
			"Sync is adoption-only. It never installs or removes package declarations; it may update .pi/construct.json metadata.",
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
