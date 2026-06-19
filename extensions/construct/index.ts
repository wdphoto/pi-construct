import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDashboard } from "./commands/dashboard.js";
import { handleSync } from "./commands/sync.js";
import { buildStatus } from "./status.js";
import { showText, splitArgs } from "./ui.js";

export default function constructExtension(pi: ExtensionAPI) {
	pi.registerCommand("construct", {
		description: "Open the Construct loadout menu",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "sync", "reload"];
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

			if (command === "sync") {
				await handleSync(rest, ctx);
				return;
			}

			if (command === "reload") {
				await ctx.reload();
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
					"- /construct sync [-a]",
					"- /construct reload",
				].join("\n"),
			);
		},
	});
}
