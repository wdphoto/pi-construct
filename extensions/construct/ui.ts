import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function splitArgs(args: string): { command: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { command: "dashboard", rest: "" };
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
	section?: string;
	marker?: string;
}

function fuzzyMatches(text: string, query: string): boolean {
	const normalizedText = text.toLowerCase();
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return true;
	if (normalizedText.includes(normalizedQuery)) return true;
	let cursor = 0;
	for (const char of normalizedQuery) {
		cursor = normalizedText.indexOf(char, cursor);
		if (cursor === -1) return false;
		cursor += 1;
	}
	return true;
}

export async function pickCheckboxes(ctx: ExtensionCommandContext, title: string, items: CheckboxPickerItem[]): Promise<string[] | undefined> {
	if (!ctx.hasUI) return undefined;

	return ctx.ui.custom<string[] | undefined>((tui, theme, keybindings, done) => {
		const checked = new Set(items.filter((item) => item.checked).map((item) => item.id));
		let query = "";
		let selected = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		function invalidate() {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function searchableText(item: CheckboxPickerItem): string {
			return [item.label, item.value, item.description, item.section].filter(Boolean).join(" ");
		}

		function filteredItems(): CheckboxPickerItem[] {
			return items.filter((item) => fuzzyMatches(searchableText(item), query));
		}

		function selectedItem(): CheckboxPickerItem | undefined {
			return filteredItems()[selected];
		}

		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const visibleItems = filteredItems();
			if (selected >= visibleItems.length) selected = Math.max(0, visibleItems.length - 1);
			const lines: string[] = [theme.fg("accent", theme.bold(title)), theme.fg("muted", `  Search: ${query || "type to filter"}`), ""];
			if (items.length === 0) {
				lines.push(theme.fg("muted", "  No items available"), "", theme.fg("muted", "  Esc to close"));
				cachedWidth = width;
				cachedLines = lines.map((line) => truncateToWidth(line, width));
				return cachedLines;
			}
			if (visibleItems.length === 0) {
				lines.push(theme.fg("muted", "  No matching items"), "", theme.fg("muted", "  Backspace clears search · Esc cancels"));
				cachedWidth = width;
				cachedLines = lines.map((line) => truncateToWidth(line, width));
				return cachedLines;
			}

			const maxVisible = 12;
			const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), visibleItems.length - maxVisible));
			const end = Math.min(start + maxVisible, visibleItems.length);
			const maxLabelWidth = Math.min(28, Math.max(...visibleItems.map((item) => visibleWidth(item.label))));

			let previousSection: string | undefined;
			for (let index = start; index < end; index += 1) {
				const item = visibleItems[index];
				if (!item) continue;
				if (item.section && item.section !== previousSection) {
					lines.push(theme.fg("accent", item.section));
					previousSection = item.section;
				}
				const isSelected = index === selected;
				const marker = item.marker ?? (item.disabled ? "[!]" : checked.has(item.id) ? "[x]" : "[ ]");
				const cursor = isSelected ? "> " : "  ";
				const paddedLabel = item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
				let line = `${cursor}${marker} ${paddedLabel}  ${item.value}`;
				if (item.disabled) line = theme.fg(item.marker === "[i]" ? "muted" : "warning", line);
				else if (isSelected) line = theme.bold(line);
				lines.push(truncateToWidth(line, width));
			}

			if (start > 0 || end < visibleItems.length || query) lines.push(theme.fg("muted", `  (${selected + 1}/${visibleItems.length}${query ? ` of ${items.length}` : ""})`));
			const item = selectedItem();
			if (item?.description) lines.push("", ...item.description.split("\n").map((line) => theme.fg("muted", `  ${line}`)));
			lines.push("", theme.fg("muted", "  Type to fuzzy filter · Backspace edits · Space toggles · Enter saves · Esc cancels"));
			cachedWidth = width;
			cachedLines = lines.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}

		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.up")) {
				const visibleCount = filteredItems().length;
				if (visibleCount > 0) selected = selected === 0 ? visibleCount - 1 : selected - 1;
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				const visibleCount = filteredItems().length;
				if (visibleCount > 0) selected = selected === visibleCount - 1 ? 0 : selected + 1;
				invalidate();
				tui.requestRender();
				return;
			}
			if (data === "\u007f" || data === "\b") {
				if (query) {
					query = query.slice(0, -1);
					selected = 0;
					invalidate();
					tui.requestRender();
				}
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
			if (keybindings.matches(data, "tui.select.confirm")) {
				done([...checked]);
				return;
			}
			if (keybindings.matches(data, "tui.select.cancel")) {
				done(undefined);
				return;
			}
			if (data.length === 1 && data >= " " && data !== "\u007f") {
				query += data;
				selected = 0;
				invalidate();
				tui.requestRender();
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
			"- /construct library",
			"- /construct remember <source> [id]",
			"- /construct forget <id-or-source>",
			"- /construct catalog (compatibility)",
			"- /construct catalog add <source> [id] (compatibility)",
			"- /construct catalog remove <id-or-source> (compatibility)",
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
