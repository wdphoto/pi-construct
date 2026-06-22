import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleAutoload, maybePromptAutoloadOnShutdown, maybeStartAutoloadWatcher } from "./commands/autoload.js";
import { handleDashboard } from "./commands/dashboard.js";
import { handleLoad } from "./commands/load.js";
import { handleProfile } from "./commands/profiles.js";
import { handleUnload } from "./commands/unload.js";
import { buildStatus } from "./status.js";
import { showText, splitArgs } from "./ui.js";

export default function constructExtension(pi: ExtensionAPI) {
	pi.on("session_start", maybeStartAutoloadWatcher);
	pi.on("session_shutdown", maybePromptAutoloadOnShutdown);

	pi.registerCommand("construct", {
		description: "Open the Construct loadout menu",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "load", "unload", "save", "list", "run", "share", "remove", "import", "autoload"];
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

			if (command === "unload") {
				await handleUnload(rest, ctx);
				return;
			}

			if (command === "autoload") {
				await handleAutoload(rest, ctx);
				return;
			}

			if (command === "save") {
				await handleProfile(pi, `save ${rest}`.trim(), ctx);
				return;
			}

			if (command === "list") {
				await handleProfile(pi, "list", ctx);
				return;
			}

			if (command === "run") {
				await handleProfile(pi, `run ${rest}`.trim(), ctx);
				return;
			}

			if (command === "share") {
				await handleProfile(pi, `share ${rest}`.trim(), ctx);
				return;
			}

			if (command === "remove") {
				await handleProfile(pi, `remove ${rest}`.trim(), ctx);
				return;
			}

			if (command === "import") {
				await handleProfile(pi, `import ${rest}`.trim(), ctx);
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
					"- /construct load [id-or-source ...]",
					"- /construct unload [id-or-source ...]",
					"- /construct autoload [on|off|status]",
					"- /construct save <name>",
					"- /construct list",
					"- /construct run <saved-name>",
					"- /construct share <saved-name>",
					"- /construct remove <saved-name>",
					"- /construct import [json]",
				].join("\n"),
			);
		},
	});
}
