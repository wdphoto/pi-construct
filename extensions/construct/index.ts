import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const constructCommands = ["status", "scan", "load", "unload", "save", "list", "run", "share", "wipe", "import"] as const;

const unknownCommandHelp = [
	"Construct is intentionally small now:",
	"- /construct",
	"- /construct status",
	"- /construct scan [path]",
	"- /construct load [id-or-source-or-path ...]",
	"- /construct unload [id-or-source ...]",
	"- /construct save <loadout-name>",
	"- /construct list",
	"- /construct run <saved-name>",
	"- /construct share <saved-name>",
	"- /construct wipe <saved-name>",
	"- /construct import [json]",
];

function splitArgs(args: string): { command: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { command: "dashboard", rest: "" };
	const firstSpace = trimmed.search(/\s/);
	if (firstSpace === -1) return { command: trimmed, rest: "" };
	return { command: trimmed.slice(0, firstSpace), rest: trimmed.slice(firstSpace).trim() };
}

function showText(ctx: ExtensionCommandContext, text: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, "info");
		return;
	}
	if (ctx.mode === "print") {
		console.log(text);
		return;
	}
	console.error(text);
}

function savedLoadoutArgs(command: string, rest: string): string {
	return command === "list" ? "list" : `${command} ${rest}`.trim();
}

export default function constructExtension(pi: ExtensionAPI) {
	pi.registerCommand("construct", {
		description: "Open the Construct loadout menu",
		getArgumentCompletions: (prefix) => {
			const matches = constructCommands.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			if (!args.trim()) {
				const { handleDashboard } = await import("./commands/dashboard.js");
				await handleDashboard(pi, ctx);
				return;
			}

			const { command, rest } = splitArgs(args);

			if (command === "status") {
				const { buildStatus } = await import("./status.js");
				showText(ctx, await buildStatus(pi, ctx, rest));
				return;
			}

			if (command === "load") {
				const { handleLoad } = await import("./commands/load.js");
				await handleLoad(rest, ctx);
				return;
			}

			if (command === "scan") {
				const { handleScan } = await import("./commands/scan.js");
				await handleScan(rest, ctx);
				return;
			}

			if (command === "unload") {
				const { handleUnload } = await import("./commands/unload.js");
				await handleUnload(rest, ctx);
				return;
			}

			if (["save", "list", "run", "share", "wipe", "import"].includes(command)) {
				const { handleSavedLoadoutCommand } = await import("./commands/saved-loadouts.js");
				await handleSavedLoadoutCommand(pi, savedLoadoutArgs(command, rest), ctx);
				return;
			}

			showText(ctx, [`Unknown /construct subcommand: ${command}`, "", ...unknownCommandHelp].join("\n"));
		},
	});
}
