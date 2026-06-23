import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleAutoload, maybePromptAutoloadOnShutdown } from "./commands/autoload.js";
import { handleDashboard } from "./commands/dashboard.js";
import { handleLoad } from "./commands/load.js";
import { handleSavedLoadoutCommand } from "./commands/saved-loadouts.js";
import { handleScan } from "./commands/scan.js";
import { handleUnload } from "./commands/unload.js";
import { buildStatus } from "./status.js";
import { showText, splitArgs } from "./ui.js";

export default function constructExtension(pi: ExtensionAPI) {
	pi.on("session_shutdown", maybePromptAutoloadOnShutdown);

	pi.registerCommand("construct", {
		description: "Open the Construct loadout menu",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "scan", "load", "unload", "save", "list", "run", "share", "wipe", "import", "autoload"];
			const matches = commands.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			if (!args.trim()) {
				await handleDashboard(pi, ctx);
				return;
			}

			const { command, rest } = splitArgs(args);

			if (command === "status") {
				showText(ctx, await buildStatus(pi, ctx, rest));
				return;
			}

			if (command === "load") {
				await handleLoad(rest, ctx);
				return;
			}

			if (command === "scan") {
				await handleScan(rest, ctx);
				return;
			}

			if (command === "unload") {
				await handleUnload(rest, ctx);
				return;
			}

			if (command === "autoload") {
				await handleAutoload(rest, ctx);
				return;
			}

			if (command === "save") {
				await handleSavedLoadoutCommand(pi, `save ${rest}`.trim(), ctx);
				return;
			}

			if (command === "list") {
				await handleSavedLoadoutCommand(pi, "list", ctx);
				return;
			}

			if (command === "run") {
				await handleSavedLoadoutCommand(pi, `run ${rest}`.trim(), ctx);
				return;
			}

			if (command === "share") {
				await handleSavedLoadoutCommand(pi, `share ${rest}`.trim(), ctx);
				return;
			}

			if (command === "wipe") {
				await handleSavedLoadoutCommand(pi, `wipe ${rest}`.trim(), ctx);
				return;
			}

			if (command === "import") {
				await handleSavedLoadoutCommand(pi, `import ${rest}`.trim(), ctx);
				return;
			}

			showText(
				ctx,
				[
					`Unknown /construct subcommand: ${command}`,
					"",
					"Construct is intentionally small now:",
					"- /construct",
					"- /construct status",
					"- /construct scan [path]",
					"- /construct load [id-or-source-or-path ...]",
					"- /construct unload [id-or-source ...]",
					"- /construct autoload [on|off|status]",
					"- /construct save <loadout-name>",
					"- /construct list",
					"- /construct run <saved-name>",
					"- /construct share <saved-name>",
					"- /construct wipe <saved-name>",
					"- /construct import [json]",
				].join("\n"),
			);
		},
	});
}
