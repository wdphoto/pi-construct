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

export async function showSummary(ctx: ExtensionCommandContext, text: string): Promise<void> {
	if (ctx.mode !== "tui") {
		showText(ctx, text);
		return;
	}

	await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		const [heading = "Construct", ...body] = text.split("\n");
		const maxVisible = 16;
		let scroll = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		function invalidate() {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const maxScroll = Math.max(0, body.length - maxVisible);
			scroll = Math.min(scroll, maxScroll);
			const visible = body.slice(scroll, scroll + maxVisible);
			const lines = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of visible) {
				lines.push(line.startsWith("!") ? theme.fg("warning", line) : line);
			}
			if (body.length > maxVisible) lines.push("", theme.fg("muted", `  (${scroll + 1}-${Math.min(scroll + maxVisible, body.length)}/${body.length})`));
			lines.push("", theme.fg("muted", "  Enter/Esc closes"));
			cachedWidth = width;
			cachedLines = lines.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}

		function handleInput(data: string): void {
			if (keybindings.matches(data, "tui.select.up")) {
				scroll = Math.max(0, scroll - 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				scroll = Math.min(Math.max(0, body.length - maxVisible), scroll + 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel")) {
				done(undefined);
			}
		}

		return { render, handleInput, invalidate };
	});
}

export function setConstructStatus(ctx: ExtensionCommandContext, text: string | undefined): void {
	if (ctx.hasUI) ctx.ui.setStatus("construct", text);
}

export function progressStatus(action: string, current: number, total: number, label: string): string {
	return `Construct: ${action} ${current}/${total} ${label}...`;
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

export interface CheckboxPickerApplyResult {
	title: string;
	lines: string[];
	confirmHint?: string;
	confirmAction?: "reload";
}

export interface CheckboxPickerResult {
	selectedIds: string[];
	closeAction?: "confirm" | "cancel";
	confirmAction?: "reload";
}

export interface CheckboxPickerOptions {
	confirmHint?: string;
	onSubmit?: (selectedIds: string[], update: (title: string, lines: string[]) => void) => Promise<CheckboxPickerApplyResult>;
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

export async function pickCheckboxes(ctx: ExtensionCommandContext, title: string, items: CheckboxPickerItem[], options: CheckboxPickerOptions = {}): Promise<CheckboxPickerResult | undefined> {
	if (ctx.mode !== "tui") return undefined;

	return ctx.ui.custom<CheckboxPickerResult | undefined>((tui, theme, keybindings, done) => {
		const checked = new Set(items.filter((item) => item.checked).map((item) => item.id));
		let query = "";
		let selected = 0;
		let phase: "pick" | "applying" | "done" = "pick";
		let submittedIds: string[] | undefined;
		let applyTitle = "Applying changes…";
		let applyLines: string[] = ["Preparing changes…"];
		let applyConfirmHint = "Press Enter/Esc to return to session";
		let applyConfirmAction: "reload" | undefined;
		let applyScroll = 0;
		let applyStartedAt = Date.now();
		let spinnerTick = 0;
		const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const animationTimer = setInterval(() => {
			if (phase !== "applying") return;
			spinnerTick += 1;
			invalidate();
			tui.requestRender();
		}, 120);
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

		function setApplyState(nextTitle: string, nextLines: string[]): void {
			applyTitle = nextTitle;
			applyLines = nextLines;
			applyScroll = 0;
			invalidate();
			tui.requestRender();
		}

		function renderApply(width: number): string[] {
			const maxVisible = 16;
			const maxScroll = Math.max(0, applyLines.length - maxVisible);
			applyScroll = Math.min(applyScroll, maxScroll);
			const visible = applyLines.slice(applyScroll, applyScroll + maxVisible);
			const elapsedSeconds = Math.max(0, Math.floor((Date.now() - applyStartedAt) / 1000));
			const heading = phase === "applying" ? `${spinnerFrames[spinnerTick % spinnerFrames.length]} ${applyTitle} · ${elapsedSeconds}s` : applyTitle;
			const lines = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of visible) {
				if (line.startsWith("!")) lines.push(theme.fg("warning", line));
				else if (line.startsWith("+")) lines.push(theme.fg("success", line));
				else if (line.startsWith("-")) lines.push(theme.fg("muted", line));
				else if (line.startsWith("Reload")) lines.push(theme.fg("warning", line));
				else if (line.trimStart().startsWith("/")) lines.push(theme.fg("accent", theme.bold(line)));
				else lines.push(line);
			}
			if (applyLines.length > maxVisible) lines.push("", theme.fg("muted", `  (${applyScroll + 1}-${Math.min(applyScroll + maxVisible, applyLines.length)}/${applyLines.length})`));
			lines.push("", phase === "applying" ? theme.fg("muted", "  Applying package changes…") : theme.fg("accent", `  ${applyConfirmHint}`));
			return lines.map((line) => truncateToWidth(line, width));
		}

		function render(width: number): string[] {
			if (phase !== "pick") return renderApply(width);
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
				lines.push(theme.fg("muted", "  No matching items"), "", theme.fg("muted", "  Esc cancels"));
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
			lines.push("", theme.fg("muted", `  Type to search/filter · Space toggles · ${options.confirmHint ?? "Enter saves"} · Esc cancels`));
			cachedWidth = width;
			cachedLines = lines.map((line) => truncateToWidth(line, width));
			return cachedLines;
		}

		function close(result: CheckboxPickerResult | undefined): void {
			clearInterval(animationTimer);
			done(result);
		}

		function handleInput(data: string): void {
			if (phase !== "pick") {
				if (keybindings.matches(data, "tui.select.up")) {
					applyScroll = Math.max(0, applyScroll - 1);
					invalidate();
					tui.requestRender();
					return;
				}
				if (keybindings.matches(data, "tui.select.down")) {
					applyScroll = Math.min(Math.max(0, applyLines.length - 16), applyScroll + 1);
					invalidate();
					tui.requestRender();
					return;
				}
				if (phase === "done" && keybindings.matches(data, "tui.select.confirm")) {
					close({ selectedIds: submittedIds ?? [], closeAction: "confirm", confirmAction: applyConfirmAction });
				}
				if (phase === "done" && keybindings.matches(data, "tui.select.cancel")) {
					close({ selectedIds: submittedIds ?? [], closeAction: "cancel", confirmAction: applyConfirmAction });
				}
				return;
			}

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
				submittedIds = [...checked];
				if (!options.onSubmit) {
					close({ selectedIds: submittedIds });
					return;
				}
				phase = "applying";
				applyStartedAt = Date.now();
				spinnerTick = 0;
				setApplyState("Applying Construct changes", ["Preparing changes…"]);
				void (async () => {
					try {
						const result = await options.onSubmit!(submittedIds ?? [], setApplyState);
						phase = "done";
						applyConfirmHint = result.confirmHint ?? "Press Enter/Esc to return to session";
						applyConfirmAction = result.confirmAction;
						setApplyState(result.title, result.lines);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						phase = "done";
						setApplyState("Construct changes failed", [`! ${message}`]);
					}
				})();
				return;
			}
			if (keybindings.matches(data, "tui.select.cancel")) {
				close(undefined);
				return;
			}
			if (data.length === 1 && data >= " " && data !== "\u007f") {
				query += data;
				selected = 0;
				invalidate();
				tui.requestRender();
			}
		}

		return { render, handleInput, invalidate, dispose: () => clearInterval(animationTimer) };
	});
}
