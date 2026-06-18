import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleAutoload } from "./commands/autoload.js";
import { handleCatalog } from "./commands/catalog.js";
import { handleDashboard } from "./commands/dashboard.js";
import { handleEnable, handleDisable, handleRemove } from "./commands/manage.js";
import { handleLoad, handleOn } from "./commands/load.js";
import { handleSync, handleAutosync } from "./commands/sync.js";
import { handleOff, handleUnload } from "./commands/unload.js";
import { isObject, readJson } from "./json.js";
import { maybeAutosyncOnShutdown, maybeOfferAutoload } from "./lifecycle.js";
import { getPaths } from "./paths.js";
import { buildStatus } from "./status.js";
import { showText, splitArgs } from "./ui.js";

async function hasEnabledConstructPackage(ctx: { cwd: string }): Promise<{ hasAny: boolean; hasEnabled: boolean }> {
	const paths = await getPaths(ctx);
	const construct = await readJson(paths.projectConstructPath);
	if (construct.state !== "ok" || !isObject(construct.data) || !isObject(construct.data.items)) return { hasAny: false, hasEnabled: false };
	let hasAny = false;
	let hasEnabled = false;
	for (const value of Object.values(construct.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		hasAny = true;
		if (value.enabled !== false) hasEnabled = true;
	}
	return { hasAny, hasEnabled };
}

export default function constructExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await maybeOfferAutoload(pi, ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			await maybeAutosyncOnShutdown(ctx);
		} catch {
			// Autosync is best-effort and remember-only. Never block shutdown.
		}
	});

	pi.registerCommand("construct", {
		description: "Load remembered Pi sources and unload project packages",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "load", "unload", "toggle", "sync", "catalog", "reload"];
			const matches = commands.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitArgs(args);

			if (command === "dashboard") {
				await handleDashboard(pi, ctx);
				return;
			}

			if (command === "status") {
				showText(ctx, await buildStatus(pi, ctx));
				return;
			}

			if (command === "catalog") {
				await handleCatalog(rest, ctx);
				return;
			}

			if (command === "load") {
				await handleLoad(rest, pi, ctx);
				return;
			}

			if (command === "unload") {
				await handleUnload(rest, pi, ctx);
				return;
			}

			if (command === "toggle") {
				const state = await hasEnabledConstructPackage(ctx);
				if (!state.hasAny) {
					showText(ctx, "No Construct-managed packages are remembered for this project yet. Use /construct sync or /construct load first.");
					return;
				}
				if (state.hasEnabled) await handleOff(pi, ctx);
				else await handleOn(pi, ctx);
				return;
			}

			// Hidden testing/debug aliases. Public UX should use /construct toggle.
			if (command === "off") {
				await handleOff(pi, ctx);
				return;
			}

			if (command === "on") {
				await handleOn(pi, ctx);
				return;
			}

			if (command === "wipe") {
				showText(ctx, "/construct wipe was removed. Use /construct toggle to flip Construct-managed packages off/on. Unsynced local Pi packages are ignored.");
				return;
			}

			if (command === "enable") {
				await handleEnable(rest, pi, ctx);
				return;
			}

			if (command === "disable") {
				await handleDisable(rest, ctx);
				return;
			}

			if (command === "remove") {
				await handleRemove(rest, ctx);
				return;
			}

			if (command === "reload") {
				await ctx.reload();
				return;
			}

			if (command === "autoload") {
				await handleAutoload(rest, ctx);
				return;
			}

			if (command === "autosync") {
				await handleAutosync(rest, ctx);
				return;
			}

			if (command === "sync") {
				await handleSync(rest, ctx);
				return;
			}

			showText(
				ctx,
				[
					`Unknown /construct subcommand: ${command}`,
					"",
					"Try:",
					"- /construct status",
					"- /construct load <source-or-library-id>",
					"- /construct unload [source-or-library-id]",
					"- /construct toggle",
					"- /construct sync",
					"- /construct sync on|off|status",
				].join("\n"),
			);
		},
	});
}
