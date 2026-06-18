import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogItem } from "../types.js";
import { deriveId, findCatalogItem, formatCatalogItem, loadCatalog, normalizeSourceForLibrary, uniqueId } from "../catalog.js";
import { describeRead, writeJson } from "../json.js";
import { formatList } from "../project-settings.js";
import { showText, splitArgs } from "../ui.js";

export async function handleCatalog(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { paths, read, catalog, warnings } = await loadCatalog(ctx);
	const { command, rest } = args.trim() ? splitArgs(args) : { command: "list", rest: "" };

	if (command === "status" || command === "list") {
		showText(
			ctx,
			[
				"Construct library",
				"=================",
				`Path: ${paths.userCatalogPath}`,
				`State: ${describeRead(read)}`,
				`Items: ${catalog.items.length}`,
				...formatList(catalog.items.map(formatCatalogItem), "library is empty"),
				...warnings.map((warning) => `! ${warning}`),
				"",
				"Commands:",
				"- /construct library",
				"- /construct remember <source> [id]",
				"- /construct forget <id-or-source>",
				"- /construct catalog add <source> [id] (compatibility)",
				"- /construct catalog remove <id-or-source> (compatibility)",
			].join("\n"),
		);
		return;
	}

	if (command === "add") {
		const [rawSource, requestedId] = rest.split(/\s+/).filter(Boolean);
		if (!rawSource) {
			showText(ctx, "Usage: /construct catalog add <source> [id]");
			return;
		}
		const source = await normalizeSourceForLibrary(rawSource, paths.cwd);
		if (catalog.items.some((item) => item.source === source)) {
			showText(ctx, `Construct library already contains source: ${source}`);
			return;
		}
		const id = uniqueId(requestedId || deriveId(source), catalog.items);
		const item: CatalogItem = { id, kind: "package", source };
		const next: CatalogData = {
			version: 1,
			items: [...catalog.items, item].sort((a, b) => a.id.localeCompare(b.id)),
		};
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Added library item:`, formatCatalogItem(item), `Path: ${paths.userCatalogPath}`].join("\n"));
		return;
	}

	if (command === "remove" || command === "rm") {
		const query = rest.trim();
		if (!query) {
			showText(ctx, "Usage: /construct catalog remove <id-or-source>");
			return;
		}
		const existing = findCatalogItem(catalog.items, query);
		if (!existing) {
			showText(ctx, `Library item not found: ${query}`);
			return;
		}
		const next: CatalogData = { version: 1, items: catalog.items.filter((item) => item !== existing) };
		await writeJson(paths.userCatalogPath, next);
		showText(ctx, [`Removed library item:`, formatCatalogItem(existing), `Path: ${paths.userCatalogPath}`].join("\n"));
		return;
	}

	showText(
		ctx,
		[
			`Unknown /construct catalog subcommand: ${command}`,
			"",
			"Try:",
			"- /construct catalog",
			"- /construct catalog add <source> [id]",
			"- /construct catalog remove <id-or-source>",
		].join("\n"),
	);
}
