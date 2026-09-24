import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CatalogItem, ConstructPaths, DirectResourceSummary } from "./types.js";
import {
	disableDirectResourceInProject,
	disablePackageResourcesInProject,
	enableDirectResourceInProject,
	enablePackageResourcesInProject,
	loadPackageIntoProject,
	removePackageFromProject,
	type PackageOperationOptions,
} from "./package-ops.js";
import { progressStatus, setConstructStatus } from "./ui.js";
import { matchingDeclaredPackage, matchingPiProjectOverride } from "./project-settings.js";

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
	/**
	 * True when changes need a manual `/reload` and automatic reload was intentionally suppressed
	 * (for example an install that must be filtered from the reopened dashboard first). Print-mode
	 * callers use this to avoid telling the user no reload is needed.
	 */
	manualReload?: boolean;
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

/**
 * Shared pre-write guard for Install steps. Runs immediately before each Install mutation (after
 * any earlier operations) and rechecks live trust plus whether the reviewed source is still
 * undeclared, so a target that changed after review refuses without undoing earlier results.
 * Returns undefined for non-install steps. `runConstructOperationSteps` runs this by default; an
 * optional `beforeOperation` hook can only add a refusal, never clear a default refusal. Install
 * steps refuse when no live session context is supplied rather than assuming trust.
 */
export async function installOperationPreflight(
	ctx: Pick<ExtensionCommandContext, "isProjectTrusted"> | undefined,
	paths: ConstructPaths,
	step: ConstructOperationStep,
): Promise<{ ok: boolean; error?: string } | undefined> {
	if (step.action !== "Install") return undefined;
	if (!ctx) return { ok: false, error: "no live session context; refusing to install." };
	if (!ctx.isProjectTrusted()) {
		return { ok: false, error: "project is no longer trusted by Pi; this install was not applied. Re-run after trust is restored." };
	}
	try {
		const override = await matchingPiProjectOverride(paths, step.item.source);
		if (override) return { ok: false, error: `${override} is a Pi project override (autoload:false); manage it with pi config -l.` };
		const declared = await matchingDeclaredPackage(paths, step.item.source);
		if (declared) return { ok: false, error: "a package declaration appeared since this review; reopen /construct to re-review install targets." };
	} catch (error) {
		return { ok: false, error: `could not verify the install target: ${error instanceof Error ? error.message : String(error)}` };
	}
	return { ok: true };
}

async function resolveOperationGate(
	ctx: ExtensionCommandContext,
	paths: ConstructPaths,
	step: ConstructOperationStep,
	beforeOperation?: (step: ConstructOperationStep) => Promise<{ ok: boolean; error?: string } | undefined>,
): Promise<{ ok: boolean; error?: string } | undefined> {
	let gate: { ok: boolean; error?: string } | undefined;
	try {
		gate = await installOperationPreflight(ctx, paths, step);
		const custom = await beforeOperation?.(step);
		// The optional hook may only add a refusal. A default preflight refusal (lost trust, newly
		// declared source, autoload:false override) must never be cleared by a returning { ok: true }.
		if (custom && !custom.ok) gate = custom;
		else if (!gate) gate = custom;
	} catch (error) {
		// A preflight throw must become a structured failed step instead of escaping the generic UI
		// and losing the outcome of earlier successful steps.
		gate = { ok: false, error: `install preflight failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	return gate;
}

async function applyOperation(paths: ConstructPaths, step: ConstructOperationStep, options: PackageOperationOptions = {}) {
	if (step.item.direct) {
		if (step.action === "Enable") return enableDirectResourceInProject(paths, step.item.direct, options);
		if (step.action === "Disable") return disableDirectResourceInProject(paths, step.item.direct, options);
		return { ok: false, error: `${step.action} is not supported for direct project resources.` };
	}
	if (step.action === "Install") {
		return loadPackageIntoProject(paths, {
			source: step.item.source,
			item: step.item.catalogItem ?? { id: step.item.id, kind: "package", source: step.item.source },
		}, options);
	}
	if (step.action === "Enable") return enablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined }, options);
	if (step.action === "Disable") return disablePackageResourcesInProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined }, options);
	return removePackageFromProject(paths, { source: step.item.source, id: step.item.managed ? step.item.id : undefined }, options);
}

export async function runConstructOperationSteps(input: {
	ctx: ExtensionCommandContext;
	paths: ConstructPaths;
	steps: ConstructOperationStep[];
	update?: ProgressUpdate;
	signal?: AbortSignal;
	progressTitle: string;
	completeLabel: string;
	progressItemPrefix?: string;
	statusKind?: string;
	// Optional per-step gate run after earlier operations and immediately before this step's mutation.
	// Callers can recheck live trust and reviewed declaration state for Install steps; returning
	// { ok: false } refuses only this step and leaves earlier results intact. A hook can only add a
	// refusal; it cannot clear a default install preflight refusal.
	beforeOperation?: (step: ConstructOperationStep) => Promise<{ ok: boolean; error?: string } | undefined>;
}): Promise<ConstructOperationOutcome> {
	const { ctx, paths, steps, update, signal, progressTitle, completeLabel, progressItemPrefix = "", statusKind, beforeOperation } = input;
	const quietPackageInstallOutput = ctx.mode === "tui";
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
			if (statusKind) setConstructStatus(ctx, progressStatus(statusKind, completed.length + partialRuntimeChanges.length + failures.length + 1, steps.length, step.item.label));
			const gate = await resolveOperationGate(ctx, paths, step, beforeOperation);
			// A preflight may resolve after cancellation (e.g. a deferred callback); never mutate then.
			if (signal?.aborted) break;
			if (gate && !gate.ok) {
				step.state = "failed";
				step.error = gate.error ?? "refused";
				failures.push(`${step.item.id}: ${step.error}`);
				update?.(progressTitle, operationProgressLines(steps, completeLabel, progressItemPrefix));
				continue;
			}
			// Re-read live trust immediately before each mutation so a lost grant/denial after an
			// earlier step refuses this target instead of using the batch-start snapshot.
			const operationOptions: PackageOperationOptions = { projectTrusted: ctx.isProjectTrusted(), quietPackageInstallOutput };
			const result = await applyOperation(paths, step, operationOptions);
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
		if (statusKind) setConstructStatus(ctx, undefined);
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
