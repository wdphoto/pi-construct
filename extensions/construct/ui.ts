import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

export interface CheckboxPickerItem {
	id: string;
	label: string;
	value: string;
	description?: string;
	checked: boolean;
	disabled?: boolean;
}

export async function pickCheckboxes(ctx: ExtensionCommandContext, title: string, items: CheckboxPickerItem[]): Promise<string[] | undefined> {
	if (!ctx.hasUI) return undefined;

	return ctx.ui.custom<string[] | undefined>((tui, theme, keybindings, done) => {
		const checked = new Set(items.filter((item) => item.checked).map((item) => item.id));
		let selected = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		function invalidate() {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function selectedItem(): CheckboxPickerItem | undefined {
			return items[selected];
		}

		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const lines: string[] = [theme.fg("accent", theme.bold(title)), ""];
			if (items.length === 0) {
				lines.push(theme.fg("muted", "  No items available"), "", theme.fg("muted", "  Esc to close"));
				cachedWidth = width;
				cachedLines = lines.map((line) => truncateToWidth(line, width));
				return cachedLines;
			}

			const maxVisible = 12;
			const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), items.length - maxVisible));
			const end = Math.min(start + maxVisible, items.length);
			const maxLabelWidth = Math.min(28, Math.max(...items.map((item) => visibleWidth(item.label))));

			for (let index = start; index < end; index += 1) {
				const item = items[index];
				if (!item) continue;
				const isSelected = index === selected;
				const marker = item.disabled ? "[!]" : checked.has(item.id) ? "[x]" : "[ ]";
				const cursor = isSelected ? "> " : "  ";
				const paddedLabel = item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
				let line = `${cursor}${marker} ${paddedLabel}  ${item.value}`;
				if (item.disabled) line = theme.fg("warning", line);
				else if (isSelected) line = theme.bold(line);
				lines.push(truncateToWidth(line, width));
			}

			if (start > 0 || end < items.length) lines.push(theme.fg("muted", `  (${selected + 1}/${items.length})`));
			const item = selectedItem();
			if (item?.description) lines.push("", ...item.description.split("\n").map((line) => theme.fg("muted", `  ${line}`)));
			lines.push("", theme.fg("muted", "  Space toggles · Enter saves · Esc cancels"));
			cachedWidth = width;
			cachedLines = lines.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}

		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.up")) {
				if (items.length > 0) selected = selected === 0 ? items.length - 1 : selected - 1;
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				if (items.length > 0) selected = selected === items.length - 1 ? 0 : selected + 1;
				invalidate();
				tui.requestRender();
				return;
			}
			if (data === " ") {
				const item = selectedItem();
				if (item && !item.disabled) {
					if (checked.has(item.id)) checked.delete(item.id);
					else checked.add(item.id);
				}
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm") || data === "s" || data === "S") {
				done([...checked]);
				return;
			}
			if (keybindings.matches(data, "tui.select.cancel")) {
				done(undefined);
			}
		}

		return { render, handleInput, invalidate };
	});
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
			"- /construct unload [source-or-library-id]",
			"- /construct toggle",
			"- /construct sync",
			"- /construct sync on|off|status",
			"",
			"Next phase improves the TUI loadout picker.",
		].join("\n"),
	);
}
