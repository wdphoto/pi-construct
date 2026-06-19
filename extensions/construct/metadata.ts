import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths, JsonObject, JsonReadResult } from "./types.js";
import { isObject, readJson } from "./json.js";
import { parseProjectConstruct } from "./project-settings.js";

export function getManagedEntry(construct: JsonReadResult, query: string): { id: string; item: JsonObject } | undefined {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return undefined;
	for (const [id, item] of Object.entries(construct.data.items)) {
		if (!isObject(item)) continue;
		if (id === query || item.source === query || item.requestedSource === query) return { id, item };
	}
	return undefined;
}

export function managedItemChoices(construct: JsonReadResult): string[] {
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return [];
	return Object.entries(construct.data.items)
		.filter(([, item]) => isObject(item))
		.map(([id, item]) => {
			const source = isObject(item) && typeof item.source === "string" ? item.source : "<no source>";
			const enabled = isObject(item) && item.enabled === false ? "disabled" : "enabled";
			return `${id}: ${source} (${enabled})`;
		});
}

export async function resolveManagedEntry(
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	query: string,
	action: string,
): Promise<{ construct: JsonReadResult; id?: string; item?: JsonObject }> {
	const construct = await readJson(paths.projectConstructPath);
	let resolvedQuery = query.trim();
	if (!resolvedQuery && ctx.hasUI) {
		const choices = [...managedItemChoices(construct), "Cancel"];
		if (choices.length === 1) return { construct };
		const selected = await ctx.ui.select(`Construct ${action}: choose item`, choices);
		if (!selected || selected === "Cancel") return { construct };
		resolvedQuery = selected.split(":", 1)[0];
	}
	if (!resolvedQuery) return { construct };
	const entry = getManagedEntry(construct, resolvedQuery);
	return entry ? { construct, id: entry.id, item: entry.item } : { construct };
}

export function updateConstructItemEnabled(construct: JsonReadResult, id: string, enabled: boolean): JsonObject {
	const root = parseProjectConstruct(construct);
	const items = isObject(root.items) ? root.items : {};
	const item = isObject(items[id]) ? items[id] : {};
	return {
		...root,
		version: 1,
		managedBy: "the-construct",
		items: {
			...items,
			[id]: {
				...item,
				enabled,
				updatedAt: new Date().toISOString(),
			},
		},
	};
}

export function removeConstructItem(construct: JsonReadResult, id: string): JsonObject {
	const root = parseProjectConstruct(construct);
	const items = isObject(root.items) ? { ...root.items } : {};
	delete items[id];
	return {
		...root,
		version: 1,
		managedBy: "the-construct",
		items,
	};
}
