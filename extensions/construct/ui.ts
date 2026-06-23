import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

function truncateLines(lines: string[], width: number): string[] {
	return lines.map((line) => truncateToWidth(line, width));
}

function scrollWindow(lines: string[], scroll: number, maxVisible: number): { scroll: number; visible: string[]; rangeLabel?: string } {
	const maxScroll = Math.max(0, lines.length - maxVisible);
	const nextScroll = Math.max(0, Math.min(scroll, maxScroll));
	const visible = lines.slice(nextScroll, nextScroll + maxVisible);
	const rangeLabel = lines.length > maxVisible ? `(${nextScroll + 1}-${Math.min(nextScroll + maxVisible, lines.length)}/${lines.length})` : undefined;
	return { scroll: nextScroll, visible, rangeLabel };
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
			const window = scrollWindow(body, scroll, maxVisible);
			scroll = window.scroll;
			const lines = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of window.visible) {
				lines.push(line.startsWith("!") ? theme.fg("warning", line) : line);
			}
			if (window.rangeLabel) lines.push("", theme.fg("muted", `  ${window.rangeLabel}`));
			lines.push("", theme.fg("muted", "  Enter/Esc closes"));
			cachedWidth = width;
			cachedLines = truncateLines(lines, width);
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

export async function waitForIdleBeforeConstructWrite(
	ctx: ExtensionCommandContext,
	label = "Construct",
	update?: (title: string, lines: string[]) => void,
	signal?: AbortSignal,
): Promise<boolean> {
	if (ctx.isIdle()) return true;
	if (signal?.aborted) return false;

	const message = `${label} is waiting for the current agent response to finish before changing files.`;
	update?.("Waiting for agent", [message, "", "Construct will continue automatically when the agent is idle. Press Esc to cancel before changes start."]);
	if (!update && ctx.hasUI) ctx.ui.notify(message, "warning");
	setConstructStatus(ctx, "Construct: waiting for agent to finish");
	try {
		if (!signal) {
			await ctx.waitForIdle();
			return true;
		}

		const result = await Promise.race<"idle" | "abort">([
			ctx.waitForIdle().then(() => "idle"),
			new Promise<"abort">((resolve) => signal.addEventListener("abort", () => resolve("abort"), { once: true })),
		]);
		return result === "idle";
	} finally {
		setConstructStatus(ctx, undefined);
	}
}

export type CheckboxPickerTone = "accent" | "muted" | "warning" | "success";

export interface CheckboxPickerItem {
	id: string;
	label: string;
	value: string;
	description?: string;
	checked: boolean;
	disabled?: boolean;
	section?: string;
	sectionTone?: CheckboxPickerTone;
	marker?: string;
	stateIcon?: string;
	stateLabel?: string;
	stateText?: string;
	stateTone?: CheckboxPickerTone;
	relatedIds?: string[];
	quickSelectIds?: string[];
	confirmOnFocus?: boolean;
	parentId?: string;
	depth?: number;
	expandable?: boolean;
	expandedByDefault?: boolean;
	lazyChildren?: boolean;
}

export interface CheckboxPickerApplyResult {
	title: string;
	lines: string[];
	confirmHint?: string;
	confirmAction?: "reload";
}

export type CheckboxPickerSubmitAction = "confirm" | "remove";

export interface CheckboxPickerResult {
	selectedIds: string[];
	closeAction?: "confirm" | "cancel";
	confirmAction?: "reload";
	submitAction?: CheckboxPickerSubmitAction;
}

export interface CheckboxPickerConfirmation {
	title: string;
	lines: string[];
	confirmHint?: string;
}

export interface CheckboxPickerLegendItem {
	icon: string;
	label: string;
	tone: CheckboxPickerTone;
}

export interface CheckboxPickerLoadChildrenResult {
	children: CheckboxPickerItem[];
	empty?: CheckboxPickerConfirmation;
}

export interface CheckboxPickerOptions {
	confirmHint?: string;
	footerHint?: string;
	filterLabel?: string;
	filterHint?: string;
	filterHintInline?: boolean;
	subtitle?: string;
	titleBold?: boolean;
	highlightFocused?: boolean;
	colorRowsByState?: boolean;
	stateLegend?: CheckboxPickerLegendItem[];
	initialSelection?: "checked" | "empty";
	actions?: {
		remove?: boolean;
	};
	removeConfirmation?: (selectedIds: string[]) => CheckboxPickerConfirmation | undefined;
	submitConfirmation?: (selectedIds: string[], action: CheckboxPickerSubmitAction, changedIds: string[]) => CheckboxPickerConfirmation | undefined;
	inspect?: (focusedItem: CheckboxPickerItem) => CheckboxPickerConfirmation | undefined;
	inspectKey?: string;
	loadChildren?: (focusedItem: CheckboxPickerItem) => Promise<CheckboxPickerItem[] | CheckboxPickerLoadChildrenResult>;
	onSubmit?: (
		selectedIds: string[],
		update: (title: string, lines: string[]) => void,
		signal: AbortSignal,
		action: CheckboxPickerSubmitAction,
		changedIds: string[],
	) => Promise<CheckboxPickerApplyResult>;
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
		const checked = new Set(options.initialSelection === "empty" ? [] : items.filter((item) => item.checked).map((item) => item.id));
		const changed = new Set<string>();
		let query = "";
		let selected = 0;
		let phase: "pick" | "inspect" | "confirmSubmit" | "applying" | "loading" | "done" = "pick";
		const expanded = new Set(items.filter((item) => item.expandedByDefault).map((item) => item.id));
		let itemById = new Map(items.map((item) => [item.id, item]));
		const hasTreeItems = items.some((item) => item.expandable || item.lazyChildren || item.parentId);
		let submittedIds: string[] | undefined;
		let submittedChangedIds: string[] = [];
		let confirmationAction: CheckboxPickerSubmitAction = "remove";
		let confirmationTitle = "Remove from this project?";
		let confirmationLines: string[] = [];
		let confirmationHint = "Press Enter to remove · Esc cancels";
		let confirmationTone: CheckboxPickerTone = "warning";
		let confirmationScroll = 0;
		let applyTitle = "Applying changes…";
		let applyLines: string[] = ["Preparing changes…"];
		let applyConfirmHint = "Press Enter/Esc to return to session";
		let applyConfirmAction: "reload" | undefined;
		let applyScroll = 0;
		let applyStartedAt = Date.now();
		let submitAbort: AbortController | undefined;
		let loadingToken = 0;
		let spinnerTick = 0;
		const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const animationTimer = setInterval(() => {
			if (phase !== "applying" && phase !== "loading") return;
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

		function styleTone(tone: CheckboxPickerTone | undefined, text: string): string {
			return theme.fg(tone ?? "accent", text);
		}

		function searchableText(item: CheckboxPickerItem): string {
			return [item.label, item.value, item.description, item.section, item.stateLabel, item.stateText].filter(Boolean).join(" ");
		}

		function ancestorsExpanded(item: CheckboxPickerItem): boolean {
			let parentId = item.parentId;
			while (parentId) {
				if (!expanded.has(parentId)) return false;
				parentId = itemById.get(parentId)?.parentId;
			}
			return true;
		}

		function filteredItems(): CheckboxPickerItem[] {
			return items.filter((item) => ancestorsExpanded(item) && fuzzyMatches(searchableText(item), query));
		}

		function displayLabel(item: CheckboxPickerItem): string {
			return `${"  ".repeat(Math.max(0, item.depth ?? 0))}${item.label}`;
		}

		function expansionMarker(item: CheckboxPickerItem): string {
			if (item.expandable) return expanded.has(item.id) ? "▾" : "▸";
			if (item.lazyChildren) return "?";
			return item.parentId ? "└" : " ";
		}

		function renderLegendItem(item: CheckboxPickerLegendItem): string {
			return `${styleTone(item.tone, item.icon)} ${theme.fg("muted", item.label)}`;
		}

		function relatedIdsFor(focused: CheckboxPickerItem | undefined): Set<string> {
			const related = new Set<string>();
			for (const id of focused?.relatedIds ?? []) related.add(id);
			for (const item of items) {
				if (!checked.has(item.id)) continue;
				for (const id of item.relatedIds ?? []) related.add(id);
			}
			return related;
		}

		function selectedItem(): CheckboxPickerItem | undefined {
			return filteredItems()[selected];
		}

		function quickSelectTargets(item: CheckboxPickerItem): string[] {
			if (!item.quickSelectIds) return [];
			const targetIds = new Set(item.quickSelectIds);
			return items.filter((candidate) => targetIds.has(candidate.id) && !candidate.disabled).map((candidate) => candidate.id);
		}

		function setApplyState(nextTitle: string, nextLines: string[]): void {
			applyTitle = nextTitle;
			applyLines = nextLines;
			applyScroll = 0;
			invalidate();
			tui.requestRender();
		}

		function renderConfirmation(width: number): string[] {
			const maxVisible = 16;
			const window = scrollWindow(confirmationLines, confirmationScroll, maxVisible);
			confirmationScroll = window.scroll;
			const lines = [styleTone(confirmationTone, theme.bold(confirmationTitle)), ""];
			for (const line of window.visible) {
				if (line.startsWith("!")) lines.push(theme.fg("warning", line));
				else if (line.trimStart().startsWith("`")) lines.push(theme.fg("accent", line));
				else lines.push(line);
			}
			if (window.rangeLabel) lines.push("", theme.fg("muted", `  ${window.rangeLabel}`));
			lines.push("", styleTone(confirmationTone, `  ${confirmationHint}`));
			return truncateLines(lines, width);
		}

		function renderApply(width: number): string[] {
			const maxVisible = 16;
			const window = scrollWindow(applyLines, applyScroll, maxVisible);
			applyScroll = window.scroll;
			const elapsedSeconds = Math.max(0, Math.floor((Date.now() - applyStartedAt) / 1000));
			const heading = phase === "applying" || phase === "loading" ? `${spinnerFrames[spinnerTick % spinnerFrames.length]} ${applyTitle} · ${elapsedSeconds}s` : applyTitle;
			const lines = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of window.visible) {
				if (line.startsWith("!")) lines.push(theme.fg("warning", line));
				else if (line.startsWith("+")) lines.push(theme.fg("success", line));
				else if (line.startsWith("-")) lines.push(theme.fg("muted", line));
				else if (line.startsWith("Reload")) lines.push(theme.fg("warning", line));
				else if (line.trimStart().startsWith("/")) lines.push(theme.fg("accent", theme.bold(line)));
				else lines.push(line);
			}
			if (window.rangeLabel) lines.push("", theme.fg("muted", `  ${window.rangeLabel}`));
			lines.push(
				"",
				phase === "applying"
					? theme.fg("muted", "  Applying package changes…")
					: phase === "loading"
						? theme.fg("muted", "  Inspecting package resources…")
						: theme.fg("accent", `  ${applyConfirmHint}`),
			);
			return truncateLines(lines, width);
		}

		function render(width: number): string[] {
			if (phase === "confirmSubmit" || phase === "inspect") return renderConfirmation(width);
			if (phase !== "pick") return renderApply(width);
			if (cachedLines && cachedWidth === width) return cachedLines;
			const visibleItems = filteredItems();
			if (selected >= visibleItems.length) selected = Math.max(0, visibleItems.length - 1);
			const filterLabel = options.filterLabel ?? "Filter";
			const filterHint = options.filterHint ?? "Type to narrow by name/source · Backspace edits";
			const filterValue = query ? theme.fg("accent", query) : theme.fg("muted", "all items");
			const renderedTitle = options.titleBold === false ? theme.fg("accent", title) : theme.fg("accent", theme.bold(title));
			const filterLine = options.filterHintInline ? `${filterLabel}: ${filterValue}${filterHint ? theme.fg("muted", ` · ${filterHint}`) : ""}` : `${filterLabel}: ${filterValue}`;
			const lines: string[] = [renderedTitle];
			if (options.subtitle) lines.push(theme.fg("accent", options.subtitle));
			lines.push(filterLine);
			if (!options.filterHintInline && filterHint) lines.push(theme.fg("muted", `  ${filterHint}`));
			lines.push("");
			if (items.length === 0) {
				lines.push(theme.fg("muted", "  No items available"), "", theme.fg("muted", "  Esc to close"));
				cachedWidth = width;
				cachedLines = truncateLines(lines, width);
				return cachedLines;
			}
			if (visibleItems.length === 0) {
				lines.push(theme.fg("muted", "  No matching items"), "", theme.fg("muted", "  Esc cancels"));
				cachedWidth = width;
				cachedLines = truncateLines(lines, width);
				return cachedLines;
			}

			const maxVisible = 12;
			const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), visibleItems.length - maxVisible));
			const end = Math.min(start + maxVisible, visibleItems.length);
			const focusedItem = visibleItems[selected];
			const relatedIds = relatedIdsFor(focusedItem);
			const maxLabelWidth = Math.min(28, Math.max(...visibleItems.map((item) => visibleWidth(displayLabel(item)))));
			const stateTexts = visibleItems.map((item) => item.stateText ?? (item.stateLabel ? `${item.stateIcon ? `${item.stateIcon} ` : ""}${item.stateLabel}` : item.stateIcon ?? ""));
			const maxStateWidth = Math.min(16, Math.max(0, ...stateTexts.map((text) => visibleWidth(text))));
			let previousSection: string | undefined;
			for (let index = start; index < end; index += 1) {
				const item = visibleItems[index];
				if (!item) continue;
				if (item.section && item.section !== previousSection) {
					lines.push(styleTone(item.sectionTone ?? "accent", item.section));
					previousSection = item.section;
				}
				const isSelected = index === selected;
				const cursor = isSelected ? "> " : "  ";
				const label = displayLabel(item);
				const paddedLabel = label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(label)));

				const stateText = item.stateText ?? (item.stateLabel ? `${item.stateIcon ? `${item.stateIcon} ` : ""}${item.stateLabel}` : item.stateIcon ?? "");
				const isRelated = relatedIds.has(item.id) && !checked.has(item.id) && !item.relatedIds?.includes(item.id);
				if (stateText) {
					const paddedState = stateText + " ".repeat(Math.max(0, maxStateWidth - visibleWidth(stateText)));
					const selectMarker = checked.has(item.id) ? "[x]" : isRelated ? "[·]" : (item.marker ?? (item.disabled ? "   " : "[ ]"));
					const prefix = `${cursor}${selectMarker} ${hasTreeItems ? `${expansionMarker(item)} ` : ""}`;
					if (options.colorRowsByState) {
						let bodyText = truncateToWidth(`${paddedState}  ${paddedLabel}  ${item.value}`, Math.max(0, width - visibleWidth(prefix)));
						if (!item.disabled && isSelected && options.highlightFocused !== false) bodyText = theme.bold(bodyText);
						lines.push(`${prefix}${styleTone(item.stateTone, bodyText)}`);
						continue;
					}
					let line = `${prefix}${styleTone(item.stateTone, paddedState)}  ${paddedLabel}  ${item.value}`;
					if (!item.disabled && isSelected && options.highlightFocused !== false) line = theme.bold(line);
					lines.push(truncateToWidth(line, width));
					continue;
				}

				const marker = item.marker ?? (checked.has(item.id) ? "[x]" : isRelated ? "[·]" : item.disabled ? "[!]" : "[ ]");
				let line = `${cursor}${marker} ${hasTreeItems ? `${expansionMarker(item)} ` : ""}${paddedLabel}  ${item.value}`;
				if (item.disabled) line = theme.fg(item.marker === "[i]" || item.marker === "[u]" ? "muted" : "warning", line);
				else if (isSelected && options.highlightFocused !== false) line = theme.bold(line);
				lines.push(truncateToWidth(line, width));
			}

			if (start > 0 || end < visibleItems.length || query) lines.push(theme.fg("muted", `  (${selected + 1}/${visibleItems.length}${query ? ` of ${items.length}` : ""})`));
			const item = selectedItem();
			if (item?.description) lines.push("", ...item.description.split("\n").map((line) => theme.fg("muted", `  ${line}`)));
			lines.push("");
			if (options.stateLegend) lines.push(`  ${options.stateLegend.map(renderLegendItem).join(theme.fg("muted", " · "))}`);
			const footerLines = (options.footerHint ?? `  Type to search/filter · Space toggles · ${options.confirmHint ?? "Enter saves"} · Esc cancels`).split("\n");
			for (const footerLine of footerLines) lines.push(theme.fg("muted", footerLine));
			cachedWidth = width;
			cachedLines = truncateLines(lines, width);
			return cachedLines;
		}

		function selectedIds(): string[] {
			return [...checked];
		}

		function close(result: CheckboxPickerResult | undefined): void {
			submitAbort?.abort();
			clearInterval(animationTimer);
			done(result);
		}

		function startConfirmation(action: CheckboxPickerSubmitAction, confirmation: CheckboxPickerConfirmation, ids: string[]): void {
			submittedIds = ids;
			submittedChangedIds = [...changed];
			confirmationAction = action;
			confirmationTitle = confirmation.title;
			confirmationLines = confirmation.lines;
			confirmationHint = confirmation.confirmHint ?? (action === "remove" ? "Press Enter to remove · Esc cancels" : "Press Enter to apply · Esc cancels");
			confirmationTone = "warning";
			confirmationScroll = 0;
			phase = "confirmSubmit";
			invalidate();
			tui.requestRender();
		}

		function startInspect(inspection: CheckboxPickerConfirmation): void {
			confirmationTitle = inspection.title;
			confirmationLines = inspection.lines;
			confirmationHint = inspection.confirmHint ?? "Press Enter/Esc to return";
			confirmationTone = "accent";
			confirmationScroll = 0;
			phase = "inspect";
			invalidate();
			tui.requestRender();
		}

		function startRemove(): void {
			const ids = selectedIds();
			const confirmation = options.removeConfirmation?.(ids) ?? options.submitConfirmation?.(ids, "remove", [...changed]);
			if (!confirmation) {
				startSubmit("remove", ids);
				return;
			}
			startConfirmation("remove", confirmation, ids);
		}

		function refreshItemIndex(): void {
			itemById = new Map(items.map((item) => [item.id, item]));
		}

		function startLoadChildren(item: CheckboxPickerItem): void {
			if (!options.loadChildren) return;
			const token = ++loadingToken;
			phase = "loading";
			applyStartedAt = Date.now();
			spinnerTick = 0;
			setApplyState(`Inspecting ${item.label}`, [
				"Resolving package-contained resources with Pi.",
				"For Available packages, this may clone/cache package sources before showing child rows.",
				"Press Esc to return to the dashboard; already-started Pi resolution may still finish in the background.",
			]);
			void (async () => {
				try {
					const result = await options.loadChildren!(item);
					if (token !== loadingToken) return;
					const children = Array.isArray(result) ? result : result.children;
					const empty = Array.isArray(result) ? undefined : result.empty;
					const existingIds = new Set(items.map((candidate) => candidate.id));
					const newChildren = children.filter((child) => !existingIds.has(child.id));
					if (newChildren.length > 0) {
						item.expandable = true;
						item.lazyChildren = false;
						const parentIndex = items.findIndex((candidate) => candidate.id === item.id);
						items.splice(parentIndex >= 0 ? parentIndex + 1 : items.length, 0, ...newChildren);
						for (const child of newChildren) {
							if (child.checked) checked.add(child.id);
						}
						refreshItemIndex();
						expanded.add(item.id);
						const visibleIndex = filteredItems().findIndex((candidate) => candidate.id === item.id);
						selected = Math.max(0, visibleIndex);
						phase = "pick";
						invalidate();
						tui.requestRender();
						return;
					}
					item.expandable = false;
					item.lazyChildren = false;
					confirmationTitle = empty?.title ?? `Package resources: ${item.label}`;
					confirmationLines = empty?.lines ?? ["No package-contained resources resolved for this package."];
					confirmationHint = empty?.confirmHint ?? "Press Enter/Esc to return";
					confirmationTone = "accent";
					confirmationScroll = 0;
					phase = "inspect";
					invalidate();
					tui.requestRender();
				} catch (error) {
					if (token !== loadingToken) return;
					confirmationTitle = `Could not inspect ${item.label}`;
					confirmationLines = [`! ${error instanceof Error ? error.message : String(error)}`];
					confirmationHint = "Press Enter/Esc to return";
					confirmationTone = "warning";
					confirmationScroll = 0;
					phase = "inspect";
					invalidate();
					tui.requestRender();
				}
			})();
		}

		function startSubmit(action: CheckboxPickerSubmitAction, idsOverride?: string[]): void {
			submittedIds = idsOverride ?? selectedIds();
			submittedChangedIds = [...changed];
			if (!options.onSubmit) {
				close({ selectedIds: submittedIds, submitAction: action });
				return;
			}
			phase = "applying";
			applyStartedAt = Date.now();
			const abort = new AbortController();
			submitAbort = abort;
			spinnerTick = 0;
			setApplyState("Applying Construct changes", ["Preparing changes…"]);
			void (async () => {
				try {
					const result = await options.onSubmit!(submittedIds ?? [], setApplyState, abort.signal, action, submittedChangedIds);
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
		}

		function handleInput(data: string): void {
			if (phase !== "pick") {
				if (phase === "loading") {
					if (keybindings.matches(data, "tui.select.cancel")) {
						loadingToken += 1;
						phase = "pick";
						invalidate();
						tui.requestRender();
					}
					return;
				}
				if (phase === "confirmSubmit" || phase === "inspect") {
					if (keybindings.matches(data, "tui.select.up")) {
						confirmationScroll = Math.max(0, confirmationScroll - 1);
						invalidate();
						tui.requestRender();
						return;
					}
					if (keybindings.matches(data, "tui.select.down")) {
						confirmationScroll = Math.min(Math.max(0, confirmationLines.length - 16), confirmationScroll + 1);
						invalidate();
						tui.requestRender();
						return;
					}
					if (keybindings.matches(data, "tui.select.confirm")) {
						if (phase === "inspect") {
							phase = "pick";
							invalidate();
							tui.requestRender();
							return;
						}
						startSubmit(confirmationAction, submittedIds);
						return;
					}
					if (keybindings.matches(data, "tui.select.cancel")) {
						phase = "pick";
						invalidate();
						tui.requestRender();
						return;
					}
					return;
				}
				if (phase === "applying" && keybindings.matches(data, "tui.select.cancel")) {
					submitAbort?.abort();
					setApplyState("Cancelling Construct changes", ["Cancel requested.", "Construct will stop before the next file-changing step."]);
					return;
				}
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
			if (keybindings.matches(data, "tui.editor.cursorRight") || matchesKey(data, Key.right)) {
				const item = selectedItem();
				if (item?.lazyChildren && options.loadChildren) {
					startLoadChildren(item);
					return;
				}
				if (item?.expandable && !expanded.has(item.id)) {
					const hasLoadedChildren = items.some((candidate) => candidate.parentId === item.id);
					if (!hasLoadedChildren && options.loadChildren) {
						startLoadChildren(item);
						return;
					}
					expanded.add(item.id);
					invalidate();
					tui.requestRender();
				}
				return;
			}
			if (keybindings.matches(data, "tui.editor.cursorLeft") || matchesKey(data, Key.left)) {
				const item = selectedItem();
				const collapseId = item?.expandable && expanded.has(item.id) ? item.id : item?.parentId;
				if (collapseId) {
					expanded.delete(collapseId);
					selected = Math.max(0, filteredItems().findIndex((candidate) => candidate.id === collapseId));
					invalidate();
					tui.requestRender();
				}
				return;
			}
			if (options.inspect && data.toLowerCase() === (options.inspectKey ?? "i").toLowerCase()) {
				const item = selectedItem();
				if (item?.lazyChildren && !items.some((candidate) => candidate.parentId === item.id) && options.loadChildren) {
					startLoadChildren(item);
					return;
				}
				const inspection = item ? options.inspect(item) : undefined;
				if (inspection) {
					startInspect(inspection);
					return;
				}
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
					const targetIds = quickSelectTargets(item);
					if (targetIds.length > 0) {
						const allTargetsChecked = targetIds.every((id) => checked.has(id));
						for (const id of targetIds) {
							if (allTargetsChecked) checked.delete(id);
							else checked.add(id);
							changed.add(id);
						}
					} else if (!item.quickSelectIds) {
						if (checked.has(item.id)) checked.delete(item.id);
						else checked.add(item.id);
						changed.add(item.id);
					}
				}
				invalidate();
				tui.requestRender();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm")) {
				const item = selectedItem();
				const ids = checked.size === 0 && item?.confirmOnFocus && !item.disabled ? [item.id] : selectedIds();
				const confirmation = options.submitConfirmation?.(ids, "confirm", [...changed]);
				if (confirmation) startConfirmation("confirm", confirmation, ids);
				else startSubmit("confirm", ids);
				return;
			}
			if (options.actions?.remove && (data.toLowerCase() === "r" || data === "\u001b[3~") && checked.size > 0) {
				startRemove();
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
