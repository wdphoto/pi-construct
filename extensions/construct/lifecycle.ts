import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseCatalog } from "./catalog.js";
import { readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { addSkip, getAutoload, getSkippedHere } from "./user-settings.js";

export async function maybeOfferAutoload(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	if (!ctx.isProjectTrusted()) return;

	const paths = await getPaths(ctx);
	if (existsSync(paths.projectConstructPath)) return;

	const [settingsRead, catalogRead, skipsRead] = await Promise.all([
		readJson(paths.userSettingsPath),
		readJson(paths.userCatalogPath),
		readJson(paths.userSkipsPath),
	]);
	const autoload = getAutoload(settingsRead);
	if (!autoload.enabled) return;
	if (getSkippedHere(skipsRead, paths.cwd, paths.realCwd)) return;

	const catalog = parseCatalog(catalogRead);
	if (catalog.data.items.length === 0) return;

	const choice = await ctx.ui.confirm("Load it into the Construct?", "Open the Construct loadout picker for this trusted project? No packages will be installed unless you select them there.");
	if (choice) {
		pi.sendUserMessage("/construct");
		return;
	}
	try {
		await addSkip(paths);
		ctx.ui.notify("Construct will not auto-offer in this project again.", "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not save Construct skip: ${message}`, "error");
	}
}
