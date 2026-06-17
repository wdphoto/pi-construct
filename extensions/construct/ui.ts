import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export function splitArgs(args: string): { command: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { command: "load", rest: "" };
	const firstSpace = trimmed.search(/\s/);
	if (firstSpace === -1) return { command: trimmed, rest: "" };
	return { command: trimmed.slice(0, firstSpace), rest: trimmed.slice(firstSpace).trim() };
}

export function showText(ctx: ExtensionCommandContext, text: string): void {
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

export function planned(ctx: ExtensionCommandContext, subcommand: string): void {
	showText(
		ctx,
		[
			`/construct ${subcommand} is planned but not implemented yet.`,
			"",
			"Implemented now:",
			"- /construct",
			"- /construct status",
			"- /construct catalog",
			"- /construct catalog add <source> [id]",
			"- /construct catalog remove <id-or-source>",
			"- /construct load [source-or-library-id]",
			"- /construct unload [all|source-or-library-id]",
			"- /construct sync",
			"- /construct sync on|off|status",
			"",
			"Next phase improves the TUI loadout picker.",
		].join("\n"),
	);
}
