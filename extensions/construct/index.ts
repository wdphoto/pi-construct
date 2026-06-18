import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleAutoload } from "./commands/autoload.js";
import { handleCatalog } from "./commands/catalog.js";
import { handleEnable, handleDisable, handleRemove } from "./commands/manage.js";
import { handleLoad, handleOn } from "./commands/load.js";
import { handleSync, handleAutosync } from "./commands/sync.js";
import { handleOff, handleUnload } from "./commands/unload.js";
import { maybeAutosyncOnShutdown, maybeOfferAutoload } from "./lifecycle.js";
import { buildStatus } from "./status.js";
import { showText, splitArgs } from "./ui.js";

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
			const commands = ["status", "load", "unload", "on", "off", "sync", "catalog", "reload"];
			const matches = commands.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitArgs(args);

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

			if (command === "off") {
				await handleOff(pi, ctx);
				return;
			}

			if (command === "on") {
				await handleOn(pi, ctx);
				return;
			}

			if (command === "wipe") {
				showText(ctx, "/construct wipe was removed. Use /construct off to turn off Construct-managed packages; unsynced local Pi packages are ignored.");
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
					"- /construct off",
					"- /construct on",
					"- /construct sync",
					"- /construct sync on|off|status",
				].join("\n"),
			);
		},
	});
}
