import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CatalogItem, ConstructPaths, DirectResourceSummary } from "./types.js";
import {
	disableDirectResourceInProject,
	disablePackageResourcesInProject,
	enableDirectResourceInProject,
	enablePackageResourcesInProject,
	loadPackageIntoProject,
	removePackageFromProject,
} from "./package-ops.js";
import { progressStatus, setConstructStatus } from "./ui.js";

export type ConstructOperationAction = "Install" | "Enable" | "Disable" | "Remove";
export type ConstructOperationItem = {
	id: string;
	label: string;
	source: string;
	displaySource: string;
	managed?: boolean;
	direct?: DirectResourceSummary;
	catalogItem?: CatalogItem;
};
export type ConstructOperationStep = {
	action: ConstructOperationAction;
	item: ConstructOperationItem;
	state: "pending" | "running" | "done" | "failed";
	error?: string;
};
export type ConstructOperationPartialChange = { action: ConstructOperationAction; item: ConstructOperationItem; error: string };
export type ConstructOperationOutcome = {
	completed: Array<{ action: ConstructOperationAction; item: ConstructOperationItem }>;
	partialRuntimeChanges: ConstructOperationPartialChange[];
	failures: string[];
	needsReload: boolean;
	cancelled: boolean;
	appliedChanges: number;
};
export type ConstructOperationRunResult = {
	title: string;
	lines: string[];
	confirmHint?: string;
	confirmAction?: "reload";
};
export type ProgressUpdate = (title: string, lines: string[]) => void;

export function operationError(result: { error?: string; stderr?: string; exitCode?: number }): string {
	return result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
}

export function operationProgressLines(steps: ConstructOperationStep[], completeLabel: string, itemPrefix = ""): string[] {
	const complete = steps.filter((step) => step.state === "done" || step.state === "failed").length;
	return [
		`${complete}/${steps.length} ${completeLabel} complete`,
		"",
		...steps.map((step) => {
			const marker = step.state === "done" ? "✓" : step.state === "failed" ? "!" : step.state === "running" ? "→" : " ";
			const suffix = step.error ? ` — ${step.error}` : "";
			return `${marker} ${itemPrefix}${step.action} ${step.item.label}  ${step.item.displaySource}${suffix}`;
		}),
	];
}

async function applyOperation(pi: ExtensionAPI, paths: ConstructPaths, step: ConstructOperationStep) {
	if (step.item.direct) {
		if (step.action === "Enable") return enableDirectResourceInProject(paths, step.item.direct);
		if (step.action === "Disable") return disableDirectResourceInProject(paths, step.item.direct);
		return { ok: false, error: `${step.action} is not supported for direct project resources.` };
	}
	if (step.action === "Install") {
		return loadPackageIntoProject(pi, paths, {
			source: step.item.source,
			item: step.item.catalogItem ?? { id: step.item.id, kind: "package", source: step.item.source },
		});
	}
	if (step.action === "Enable") return enablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined });
	if (step.action === "Disable") return disablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined });
	return removePackageFromProject(pi, paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined });
}

export async function runConstructOperationSteps(input: {
	pi: ExtensionAPI;
	ctx?: ExtensionCommandContext;
	paths: ConstructPaths;
	steps: ConstructOperationStep[];
	update?: ProgressUpdate;
	signal?: AbortSignal;
	progressTitle: string;
	completeLabel: string;
	progressItemPrefix?: string;
	statusKind?: string;
}): Promise<ConstructOperationOutcome> {
	const { pi, ctx, paths, steps, update, signal, progressTitle, completeLabel, progressItemPrefix = "", statusKind } = input;
	const completed: Array<{ action: ConstructOperationAction; item: ConstructOperationItem }> = [];
	const partialRuntimeChanges: ConstructOperationPartialChange[] = [];
	const failures: string[] = [];
	let needsReload = false;

	try {
		update?.(progressTitle, operationProgressLines(steps, completeLabel, progressItemPrefix));
		for (const step of steps) {
			if (signal?.aborted) break;
			step.state = "running";
			update?.(progressTitle, operationProgressLines(steps, completeLabel, progressItemPrefix));
			if (ctx && statusKind) setConstructStatus(ctx, progressStatus(statusKind, completed.length + partialRuntimeChanges.length + failures.length + 1, steps.length, step.item.label));
			const result = await applyOperation(pi, paths, step);
			if (result.needsReload) needsReload = true;
			if (result.ok) {
				completed.push({ action: step.action, item: step.item });
				step.state = "done";
			} else {
				step.state = "failed";
				step.error = operationError(result);
				if (result.metadataOnlyFailure && result.needsReload) partialRuntimeChanges.push({ action: step.action, item: step.item, error: step.error });
				else failures.push(`${step.item.id}: ${step.error}`);
			}
			update?.(progressTitle, operationProgressLines(steps, completeLabel, progressItemPrefix));
		}
	} finally {
		if (ctx && statusKind) setConstructStatus(ctx, undefined);
	}

	const appliedChanges = completed.length + partialRuntimeChanges.length;
	return {
		completed,
		partialRuntimeChanges,
		failures,
		needsReload,
		cancelled: signal?.aborted ?? false,
		appliedChanges,
	};
}

export async function showOperationRunPanel(
	ctx: ExtensionCommandContext,
	input: {
		initialTitle: string;
		preparingLine: string;
		applyingHint: string;
		failureTitle: string;
		run: (update: ProgressUpdate, signal: AbortSignal) => Promise<ConstructOperationRunResult>;
	},
): Promise<{ closeAction: "confirm" | "cancel"; confirmAction?: "reload" }> {
	return ctx.ui.custom((tui, theme, keybindings, done) => {
		let phase: "applying" | "done" = "applying";
		let title = input.initialTitle;
		let lines = [input.preparingLine];
		let confirmHint = "Press Enter/Esc to return to session";
		let confirmAction: "reload" | undefined;
		let scroll = 0;
		const startedAt = Date.now();
		let spinnerTick = 0;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		const abort = new AbortController();
		const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const animationTimer = setInterval(() => {
			if (phase !== "applying") return;
			spinnerTick += 1;
			invalidate();
			tui.requestRender();
		}, 120);

		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function update(nextTitle: string, nextLines: string[]): void {
			title = nextTitle;
			lines = nextLines;
			scroll = 0;
			invalidate();
			tui.requestRender();
		}

		function close(closeAction: "confirm" | "cancel"): void {
			abort.abort();
			clearInterval(animationTimer);
			done({ closeAction, confirmAction });
		}

		void (async () => {
			try {
				const result = await input.run(update, abort.signal);
				phase = "done";
				confirmHint = result.confirmHint ?? confirmHint;
				confirmAction = result.confirmAction;
				update(result.title, result.lines);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				phase = "done";
				confirmAction = undefined;
				update(input.failureTitle, [`! ${message}`]);
			}
		})();

		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;
			const maxVisible = 16;
			const maxScroll = Math.max(0, lines.length - maxVisible);
			scroll = Math.min(scroll, maxScroll);
			const visible = lines.slice(scroll, scroll + maxVisible);
			const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
			const heading = phase === "applying" ? `${spinnerFrames[spinnerTick % spinnerFrames.length]} ${title} · ${elapsedSeconds}s` : title;
			const rendered = [theme.fg("accent", theme.bold(heading)), ""];
			for (const line of visible) {
				if (line.startsWith("!")) rendered.push(theme.fg("warning", line));
				else if (line.startsWith("+")) rendered.push(theme.fg("success", line));
				else if (line.startsWith("-")) rendered.push(theme.fg("muted", line));
				else if (line.startsWith("Reload")) rendered.push(theme.fg("warning", line));
				else if (line.trimStart().startsWith("/")) rendered.push(theme.fg("accent", theme.bold(line)));
				else rendered.push(line);
			}
			if (lines.length > maxVisible) rendered.push("", theme.fg("muted", `  (${scroll + 1}-${Math.min(scroll + maxVisible, lines.length)}/${lines.length})`));
			rendered.push("", phase === "applying" ? theme.fg("muted", `  ${input.applyingHint}`) : theme.fg("accent", `  ${confirmHint}`));
			cachedWidth = width;
			cachedLines = rendered.map((line) => truncateToWidth(line, width));
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
				scroll = Math.min(Math.max(0, lines.length - 16), scroll + 1);
				invalidate();
				tui.requestRender();
				return;
			}
			if (phase === "applying" && keybindings.matches(data, "tui.select.cancel")) {
				abort.abort();
				update(`Cancelling ${input.initialTitle}`, ["Cancel requested.", "Construct will stop before the next file-changing step."]);
				return;
			}
			if (phase === "done" && keybindings.matches(data, "tui.select.confirm")) close("confirm");
			if (phase === "done" && keybindings.matches(data, "tui.select.cancel")) close("cancel");
		}

		return { render, handleInput, invalidate, dispose: () => clearInterval(animationTimer) };
	});
}
