import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describeRead, readJson } from "../json.js";
import { getPaths } from "../paths.js";
import { getAutoload, writeAutoload } from "../user-settings.js";
import { showText } from "../ui.js";

export async function handleAutoload(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = await getPaths(ctx);
	const subcommand = args.trim();
	if (!subcommand || subcommand === "status") {
		const settings = await readJson(paths.userSettingsPath);
		const autoload = getAutoload(settings);
		showText(
			ctx,
			[
				"Construct autoload",
				"==================",
				`Autoload: ${autoload.note}`,
				`Settings: ${describeRead(settings)}`,
				"",
				"Autoload means auto-offer only. It never installs packages by itself.",
				"Use /construct autoload on or /construct autoload off.",
			].join("\n"),
		);
		return;
	}
	if (subcommand !== "on" && subcommand !== "off") {
		showText(ctx, "Usage: /construct autoload on|off");
		return;
	}
	try {
		await writeAutoload(paths, subcommand === "on");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showText(ctx, `Could not update autoload settings.\n${message}`);
		return;
	}
	showText(
		ctx,
		[
			`Construct autoload ${subcommand === "on" ? "enabled" : "disabled"}.`,
			`Settings: ${paths.userSettingsPath}`,
			"Autoload means auto-offer only. It will not install anything automatically.",
		].join("\n"),
	);
}
