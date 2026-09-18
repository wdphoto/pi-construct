// Dashboard lowercase-u unload coverage.
// Two harnesses share the real dashboard closures:
//  - captured-callback: DashboardPicker seam captures options and runs them directly;
//  - real-key routing: a fake ctx.ui.custom captures the actual pickCheckboxes component and
//    drives real key input. Fixtures are isolated local projects with isolated HOME/offline.
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleDashboard, type DashboardPicker } from "../extensions/construct/commands/dashboard.js";
import { unloadConstructSources } from "../extensions/construct/commands/unload.js";
import { deriveId } from "../extensions/construct/catalog.js";
import type { CheckboxPickerApplyResult, CheckboxPickerItem, CheckboxPickerOptions, CheckboxPickerResult } from "../extensions/construct/ui.js";

interface Captured {
	items: CheckboxPickerItem[];
	options: CheckboxPickerOptions;
}

const tmp = mkdtempSync(join(tmpdir(), "construct-dashboard-unload-"));
process.env.HOME = join(tmp, "home");
mkdirSync(process.env.HOME, { recursive: true });

function packageManifest(dir: string, name: string, files: string[]): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name, version: "0.0.0", pi: { extensions: files } }, null, 2)}\n`);
}

function makePackage(dir: string, name: string, files: string[]): void {
	packageManifest(dir, name, files);
	for (const file of files) {
		mkdirSync(join(dir, file.split("/").slice(0, -1).join("/")), { recursive: true });
		writeFileSync(join(dir, file), "export default function noop() {}\n");
	}
}

function makeProject(root: string, packages: unknown[]): void {
	mkdirSync(join(root, ".pi"), { recursive: true });
	if (existsSync(settingsPath(root))) backupSettings(root);
	writeFileSync(settingsPath(root), `${JSON.stringify({ packages }, null, 2)}\n`);
	const items: Record<string, unknown> = {};
	for (const source of packages) {
		if (typeof source === "string") items[deriveId(source)] = { kind: "package", source, enabled: true };
	}
	writeFileSync(join(root, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items }, null, 2)}\n`);
}

function makeCatalog(data: { items?: unknown[]; profiles?: unknown[] }): void {
	const dir = join(process.env.HOME!, ".pi", "agent", "construct");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "catalog.json"), `${JSON.stringify({ version: 1, items: data.items ?? [], profiles: data.profiles ?? [] }, null, 2)}\n`);
}

function catalogPath(): string {
	return join(process.env.HOME!, ".pi", "agent", "construct", "catalog.json");
}

function readCatalog(): { items: Array<{ id: string; source: string }>; profiles: Array<{ id: string; sources: string[]; items: string[]; updatedAt?: string }> } {
	return JSON.parse(readFileSync(catalogPath(), "utf8")) as { items: Array<{ id: string; source: string }>; profiles: Array<{ id: string; sources: string[]; items: string[] }> };
}

function settingsPath(project: string): string {
	return join(project, ".pi", "settings.json");
}

function settingsText(project: string): string {
	return readFileSync(settingsPath(project), "utf8");
}

function constructText(project: string): string {
	return readFileSync(join(project, ".pi", "construct.json"), "utf8");
}

function backupSettings(project: string): void {
	copyFileSync(settingsPath(project), join(project, ".pi", "settings.json.test-backup"));
}

function projectConstructItemCount(project: string): number {
	const data = JSON.parse(constructText(project)) as { items?: Record<string, unknown> };
	return Object.keys(data.items ?? {}).length;
}

function makeCtx(cwd: string, trusted: () => boolean, overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: trusted,
		waitForIdle: async () => {},
		reload: async () => {},
		ui: { notify: () => {}, setStatus: () => {} },
		...overrides,
	} as unknown as ExtensionCommandContext;
}

async function openDashboard(cwd: string, ctx: ExtensionCommandContext): Promise<Captured> {
	let captured: Captured | undefined;
	const pick: DashboardPicker = async (_ctx, _title, items, options) => {
		captured = { items, options };
		return undefined;
	};
	await handleDashboard(undefined as never, ctx, pick);
	assert(captured, "dashboard did not reach the picker");
	return captured;
}

function makeKeybindings(): { matches: (data: string, id: string) => boolean } {
	const map: Record<string, string> = {
		"tui.select.up": "up",
		"tui.select.down": "down",
		"tui.select.confirm": "enter",
		"tui.select.cancel": "escape",
		"tui.editor.cursorRight": "right",
		"tui.editor.cursorLeft": "left",
	};
	return { matches: (data, id) => (map[id] ? matchesKey(data, map[id] as never) : false) };
}

interface KeyHarness {
	handleInput(data: string): void;
	render(width?: number): string[];
	result(): Promise<CheckboxPickerResult | undefined>;
}

interface KeyRun {
	started: Promise<void>;
	harness: KeyHarness;
	dispose: () => void;
}

// Runs the real dashboard without a DashboardPicker override so the real pickCheckboxes
// component is built; the fake ctx.ui.custom captures it for real key input.
async function runKeyHarness(ctx: ExtensionCommandContext): Promise<KeyRun> {
	const holder: { component?: { handleInput(data: string): void; render?(width: number): string[]; dispose?: () => void } } = {};
	let resolveDone: (value: CheckboxPickerResult | undefined) => void = () => {};
	const resultPromise = new Promise<CheckboxPickerResult | undefined>((resolve) => {
		resolveDone = resolve;
	});
	const identity = (...args: unknown[]): string => (typeof args[args.length - 1] === "string" ? (args[args.length - 1] as string) : "");
	const theme = new Proxy({}, { get: () => identity }) as never;
	const tui = { requestRender: () => {}, terminal: { rows: 40, cols: 120 } } as never;
	const keybindings = makeKeybindings();
	const uiCustom = ((factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => unknown) => {
		holder.component = factory(tui, theme, keybindings, (value: unknown) => resolveDone(value as CheckboxPickerResult | undefined)) as { handleInput(data: string): void; render?(width: number): string[]; dispose?: () => void };
		return resultPromise;
	}) as ExtensionCommandContext["ui"]["custom"];
	const ctxWithCustom = makeCtx(ctx.cwd, ctx.isProjectTrusted as () => boolean, { ui: { custom: uiCustom, notify: () => {}, setStatus: () => {} } as never });
	const started = handleDashboard(undefined as never, ctxWithCustom);
	const startDeadline = Date.now() + 8000;
	while (!holder.component && Date.now() < startDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
	const component = holder.component;
	assert(component, "real pickCheckboxes component was not captured");
	const dispose = () => {
		component!.dispose?.();
		resolveDone(undefined);
	};
	return {
		started,
		harness: { handleInput: (data) => component!.handleInput(data), render: (width = 120) => component!.render?.(width) ?? [], result: () => resultPromise },
		dispose,
	};
}

// Bounded driver: sends the initial keys, then closes the final done panel once the async apply
// settles (the production UI still requires the user's own final Enter/Esc).
async function driveKeys(harness: KeyHarness, keys: string[], options: { autoClose?: boolean; timeoutMs?: number } = {}): Promise<CheckboxPickerResult | undefined> {
	for (const key of keys) harness.handleInput(key);
	const timeoutMs = options.timeoutMs ?? 8000;
	const deadline = Date.now() + timeoutMs;
	let settled = false;
	const result = harness.result().then((value) => {
		settled = true;
		return value;
	});
	if (options.autoClose === false) {
		return Promise.race([result, new Promise<CheckboxPickerResult | undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs))]);
	}
	while (!settled && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (!settled) harness.handleInput("\r");
	}
	return Promise.race([result, new Promise<CheckboxPickerResult | undefined>((resolve) => setTimeout(() => resolve(undefined), 500))]);
}

async function openKeyProject(name: string): Promise<{ run: KeyRun; project: string }> {
	const project = join(tmp, name);
	makeProject(project, [pkgMulti]);
	backupSettings(project);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const run = await runKeyHarness(makeCtx(project, () => true));
	return { run, project };
}

function renderedText(harness: KeyHarness): string {
	return harness.render(120).join("\n");
}

async function escAndExpectClose(harness: KeyHarness, presses = 1): Promise<void> {
	for (let index = 0; index < presses; index += 1) harness.handleInput("\x1b");
	let settled = false;
	void harness.result().then(() => {
		settled = true;
	});
	const deadline = Date.now() + 2000;
	while (!settled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
	assert(settled, "Esc must close the picker");
}

async function settleRun(run: KeyRun): Promise<void> {
	run.dispose();
	await Promise.race([run.started, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
}

const driver = join(tmp, "driver");
mkdirSync(driver, { recursive: true });
const pkgMulti = join(tmp, "pkg-multi");
const pkgOther = join(tmp, "pkg-other");
const pkgUnloaded = join(tmp, "pkg-unloaded");
makePackage(pkgMulti, "pkg-multi", ["extensions/a.ts", "extensions/b.ts"]);
makePackage(pkgOther, "pkg-other", ["extensions/c.ts", "extensions/d.ts"]);
makePackage(pkgUnloaded, "pkg-unloaded", ["extensions/e.ts"]);

try {
	// 1) Captured callbacks: complete child group normalizes to the parent and unloads the whole source.
	const proj = join(tmp, "project");
	makeProject(proj, [pkgMulti]);
	backupSettings(proj);
	makeCatalog({
		items: [
			{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti },
			{ id: "keep-item", kind: "package", source: "keep-source" },
		],
		profiles: [
			{ id: "recipe", name: "Recipe", sources: [pkgMulti], items: [deriveId(pkgMulti)] },
			{ id: "keep-profile", name: "Keep", sources: ["keep-source"], items: ["keep-item"], updatedAt: "2020-01-01T00:00:00.000Z" },
		],
	});
	const settingsBefore = settingsText(proj);
	const captured = await openDashboard(proj, makeCtx(proj, () => true));
	const parent = captured.items.find((item) => item.label === deriveId(pkgMulti) || item.value === pkgMulti);
	assert(parent, "multi-resource package parent row not found");
	const childIds = captured.items.filter((item) => item.parentId === parent.id).map((item) => item.id);
	assert(childIds.length === 2, `expected 2 child rows, got ${childIds.length}`);
	assert(captured.options.resolveUnloadIds, "resolveUnloadIds missing");
	assert(captured.options.unloadConfirmation, "unloadConfirmation missing");
	const normalized = captured.options.resolveUnloadIds!(childIds);
	assert.deepEqual(normalized, [parent.id], `complete child group should normalize to parent: ${JSON.stringify(normalized)}`);
	const confirmation = captured.options.unloadConfirmation!(normalized);
	assert(confirmation, "unload confirmation missing");
	assert.notEqual(confirmation!.canSubmit, false, "complete group confirmation should be submittable");
	const confirmationText = (confirmation!.lines ?? []).join("\n");
	assert(confirmationText.includes("whole package source"), "confirmation must say complete groups forget the whole package source");
	assert(confirmationText.includes("global Construct library"), "confirmation must mention global library removal");
	assert(confirmationText.includes("saved-recipe membership"), "confirmation must mention saved recipe membership");
	assert(confirmationText.includes("Unloaded"), "confirmation must mention Unloaded read-only outcome");
	assert(captured.options.onSubmit, "onSubmit missing");
	const apply = await captured.options.onSubmit!(normalized, () => {}, new AbortController().signal, "unload", []);
	assert.equal(apply.title, "Construct unload complete");
	assert.equal(apply.confirmAction, undefined, "unload must not request reload");
	const catalogAfter = readCatalog();
	assert(!catalogAfter.items.some((item) => item.source === pkgMulti), "catalog item was not removed");
	assert(catalogAfter.items.some((item) => item.source === "keep-source"), "unrelated catalog item was not preserved");
	const recipe = catalogAfter.profiles.find((profile) => profile.id === "recipe");
	assert(recipe && recipe.sources.length === 0 && recipe.items.length === 0, "saved recipe membership was not pruned");
	assert(catalogAfter.profiles.some((profile) => profile.id === "keep-profile" && profile.sources.length === 1), "unrelated profile was not preserved");
	assert.equal(catalogAfter.profiles.find((profile) => profile.id === "keep-profile")?.updatedAt, "2020-01-01T00:00:00.000Z", "untouched profile timestamp was rewritten");
	assert.equal(projectConstructItemCount(proj), 0, "current project metadata was not cleaned");
	assert.equal(settingsText(proj), settingsBefore, "unload edited .pi/settings.json");
	const applyText = apply.lines.join("\n");
	assert(!/reload needed/i.test(applyText) || applyText.includes("No /reload needed"), "unload should not claim a reload is needed");
	assert(applyText.includes("No /reload needed"), "unload result must state no reload is needed");

	// 2) Partial child group is refused, never promoted to the parent.
	makeProject(proj, [pkgMulti]);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedPartial = await openDashboard(proj, makeCtx(proj, () => true));
	const parentPartial = capturedPartial.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length === 2);
	assert(parentPartial, "parent row missing in second capture");
	const partialChildren = parentPartial!.aggregateChildIds ?? [];
	const partialIds = capturedPartial.options.resolveUnloadIds!([partialChildren[0]]);
	assert.deepEqual(partialIds, [partialChildren[0]], "partial child group must not normalize to parent");
	const partialConfirmation = capturedPartial.options.unloadConfirmation!(partialIds);
	assert.equal(partialConfirmation!.canSubmit, false, "partial child group confirmation must refuse");
	assert((partialConfirmation!.lines ?? []).join("\n").includes("whole package group"), "partial refusal must guide to the whole group");

	// 3) Multiple complete child groups normalize to both parents; mixed saved row refuses.
	const projTwo = join(tmp, "project-two");
	makeProject(projTwo, [pkgMulti, pkgOther]);
	backupSettings(projTwo);
	makeCatalog({
		items: [
			{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti },
			{ id: deriveId(pkgOther), kind: "package", source: pkgOther },
		],
		profiles: [{ id: "recipe-two", name: "Recipe", sources: [pkgMulti], items: [deriveId(pkgMulti)] }],
	});
	const capturedTwo = await openDashboard(projTwo, makeCtx(projTwo, () => true));
	const parents = capturedTwo.items.filter((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert.equal(parents.length, 2, `expected 2 multi-resource parents, got ${parents.length}`);
	const allChildren = parents.flatMap((parentItem) => parentItem.aggregateChildIds ?? []);
	const normalizedTwo = capturedTwo.options.resolveUnloadIds!(allChildren);
	assert.deepEqual(normalizedTwo.sort(), parents.map((parentItem) => parentItem.id).sort(), "complete groups should normalize to both parents");
	const savedRow = capturedTwo.items.find((item) => item.id.startsWith("saved:"));
	assert(savedRow, "saved recipe row must exist for mixed refusal coverage");
	const mixed = capturedTwo.options.resolveUnloadIds!([...(parents[0].aggregateChildIds ?? []), savedRow!.id]);
	const mixedConfirmation = capturedTwo.options.unloadConfirmation!(mixed);
	assert.equal(mixedConfirmation!.canSubmit, false, "mixed saved selection must refuse");
	assert((mixedConfirmation!.lines ?? []).join("\n").includes("saved loadout"), "mixed refusal should explain saved rows");

	// 3b) Actually apply BOTH complete groups through the real onSubmit and assert both removals.
	const twoSettings = settingsText(projTwo);
	const twoApply = await capturedTwo.options.onSubmit!(allChildren, () => {}, new AbortController().signal, "unload", []);
	assert.equal(twoApply.title, "Construct unload complete");
	const twoCatalog = readCatalog();
	assert(!twoCatalog.items.some((item) => item.source === pkgMulti), "first complete group should be removed");
	assert(!twoCatalog.items.some((item) => item.source === pkgOther), "second complete group should be removed");
	assert(projectConstructItemCount(projTwo) === 0, "both package metadata entries should be removed");
	assert.equal(settingsText(projTwo), twoSettings, "multi-group unload must not edit settings");

	// 4) Unsupported IDs alongside one eligible complete group refuse the whole batch through real onSubmit.
	const projSkip = join(tmp, "project-skip");
	mkdirSync(join(projSkip, ".pi", "extensions"), { recursive: true });
	writeFileSync(join(projSkip, ".pi", "extensions", "direct.ts"), "export default function noop() {}\n");
	writeFileSync(settingsPath(projSkip), `${JSON.stringify({ packages: [pkgMulti, { source: pkgOther, autoload: false }, pkgUnloaded] }, null, 2)}\n`);
	writeFileSync(join(projSkip, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: { [deriveId(pkgMulti)]: { kind: "package", source: pkgMulti, enabled: true } } }, null, 2)}\n`);
	backupSettings(projSkip);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [{ id: "recipe-mix", name: "Mix", sources: [pkgMulti], items: [deriveId(pkgMulti)] }] });
	const capturedSkip = await openDashboard(projSkip, makeCtx(projSkip, () => true));
	const overrideRow = capturedSkip.items.find((item) => item.section === "Overrides");
	const unloadedRow = capturedSkip.items.find((item) => item.section === "Unloaded");
	const savedSkipRow = capturedSkip.items.find((item) => item.id.startsWith("saved:"));
	const directRow = capturedSkip.items.find((item) => item.id.startsWith("direct:"));
	const eligibleParent = capturedSkip.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(overrideRow, "override row not found");
	assert(unloadedRow, "unloaded row not found");
	assert(savedSkipRow, "saved row not found");
	assert(directRow, "direct row not found");
	assert(eligibleParent, "eligible parent group not found");
	const eligibleChildren = eligibleParent!.aggregateChildIds ?? [];
	const partialChild = eligibleChildren[0]!;
	const unsupportedIds: Array<[string, string]> = [
		["override", overrideRow!.id],
		["unloaded", unloadedRow!.id],
		["saved", savedSkipRow!.id],
		["direct", directRow!.id],
		["unknown", "unknown-row"],
	];
	const skipSettingsBefore = settingsText(projSkip);
	const skipConstructBefore = constructText(projSkip);
	const skipCatalogBefore = readCatalog();
	const projectsIndexSkip = join(process.env.HOME!, ".pi", "agent", "construct", "projects.json");
	const skipIndexBefore = existsSync(projectsIndexSkip) ? readFileSync(projectsIndexSkip, "utf8") : undefined;
	for (const [label, unsupportedId] of unsupportedIds) {
		const refusal = await capturedSkip.options.onSubmit!([...eligibleChildren, unsupportedId], () => {}, new AbortController().signal, "unload", []);
		assert.equal(refusal.title, "Unload selection needs re-review", `${label} should refuse the whole batch`);
		assert.equal(settingsText(projSkip), skipSettingsBefore, `${label} refusal must not edit settings`);
		assert.equal(constructText(projSkip), skipConstructBefore, `${label} refusal must not edit metadata`);
		assert.deepEqual(readCatalog(), skipCatalogBefore, `${label} refusal must not edit the catalog`);
		assert.equal(existsSync(projectsIndexSkip) ? readFileSync(projectsIndexSkip, "utf8") : undefined, skipIndexBefore, `${label} refusal must not edit the known-project index`);
	}
	const partialRefusal = await capturedSkip.options.onSubmit!([partialChild], () => {}, new AbortController().signal, "unload", []);
	assert.equal(partialRefusal.title, "Unload selection needs re-review", "partial child should refuse the whole batch");
	assert.equal(settingsText(projSkip), skipSettingsBefore, "partial refusal must not edit settings");
	assert.equal(constructText(projSkip), skipConstructBefore, "partial refusal must not edit metadata");
	assert.deepEqual(readCatalog(), skipCatalogBefore, "partial refusal must not edit the catalog");

	// 5) Trust-loss after opening: global cleanup commits, current metadata/index reported skipped.
	const projTrust = join(tmp, "project-trust");
	makeProject(projTrust, [pkgMulti]);
	backupSettings(projTrust);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	let trusted = true;
	const ctxTrust = makeCtx(projTrust, () => trusted);
	const capturedTrust = await openDashboard(projTrust, ctxTrust);
	const trustParent = capturedTrust.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(trustParent, "trust parent row missing");
	const trustIds = capturedTrust.options.resolveUnloadIds!(trustParent!.aggregateChildIds!);
	trusted = false;
	const trustApply = await capturedTrust.options.onSubmit!(trustIds, () => {}, new AbortController().signal, "unload", []);
	const trustText = trustApply.lines.join("\n");
	assert(trustApply.title === "Construct unload complete", "trust-loss should still complete global cleanup");
	assert(trustText.includes("not trusted"), "trust-loss should report skipped current-project metadata");
	assert(!readCatalog().items.some((item) => item.source === pkgMulti), "trust-loss should still remove the catalog item");
	assert(projectConstructItemCount(projTrust) === 1, "trust-loss must not write current project metadata");

	// 5b) Fresh override conversion after review: batch refused, no writes.
	const projFlip = join(tmp, "project-flip");
	makeProject(projFlip, [pkgMulti]);
	backupSettings(projFlip);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedFlip = await openDashboard(projFlip, makeCtx(projFlip, () => true));
	const flipParent = capturedFlip.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(flipParent, "flip parent row missing");
	const flipIds = capturedFlip.options.resolveUnloadIds!(flipParent!.aggregateChildIds!);
	writeFileSync(settingsPath(projFlip), `${JSON.stringify({ packages: [{ source: pkgMulti, autoload: false }] }, null, 2)}\n`);
	const flipApply = await capturedFlip.options.onSubmit!(flipIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(flipApply.title, "Construct unload needs re-review");
	assert((flipApply.lines.join("\n")).includes("project override"), "fresh override refusal should be explained");
	assert(readCatalog().items.some((item) => item.source === pkgMulti), "fresh override conversion must not remove the catalog item");

	// 5c) Stale catalog disappearance after review: reported, nothing removed, metadata untouched.
	const projStale = join(tmp, "project-stale");
	makeProject(projStale, [pkgMulti]);
	backupSettings(projStale);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedStale = await openDashboard(projStale, makeCtx(projStale, () => true));
	const staleParent = capturedStale.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(staleParent, "stale parent row missing");
	const staleIds = capturedStale.options.resolveUnloadIds!(staleParent!.aggregateChildIds!);
	makeCatalog({ items: [], profiles: [] });
	const staleApply = await capturedStale.options.onSubmit!(staleIds, () => {}, new AbortController().signal, "unload", []);
	assert((staleApply.lines.join("\n")).includes("Construct library removed: 0"), "stale disappearance should report zero removed");
	assert((staleApply.lines.join("\n")).includes("disappeared before unload"), "stale disappearance should be reported");
	assert(projectConstructItemCount(projStale) === 1, "stale disappearance must not remove project metadata");

	// 5d) Newly added equivalent catalog entry after review is excluded from reviewed keys.
	const projEquiv = join(tmp, "project-equiv");
	makeProject(projEquiv, [pkgMulti]);
	backupSettings(projEquiv);
	const reviewId = deriveId(pkgMulti);
	makeCatalog({ items: [{ id: reviewId, kind: "package", source: pkgMulti }], profiles: [] });
	const capturedEquiv = await openDashboard(projEquiv, makeCtx(projEquiv, () => true));
	const equivParent = capturedEquiv.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(equivParent, "equiv parent row missing");
	const equivIds = capturedEquiv.options.resolveUnloadIds!(equivParent!.aggregateChildIds!);
	makeCatalog({ items: [
		{ id: reviewId, kind: "package", source: pkgMulti },
		{ id: "pkg-multi-second", kind: "package", source: pkgMulti },
	], profiles: [] });
	const equivApply = await capturedEquiv.options.onSubmit!(equivIds, () => {}, new AbortController().signal, "unload", []);
	const catalogEquiv = readCatalog();
	assert(!catalogEquiv.items.some((item) => item.id === reviewId), "reviewed id should be removed");
	assert(catalogEquiv.items.some((item) => item.id === "pkg-multi-second"), "newly added equivalent entry must not be removed");
	assert.equal(equivApply.title, "Construct unload complete");

	// 5e) Equivalent alias entries: capture prefers the exact catalog id+source pair and removes only that.
	const projEq = join(tmp, "project-eq");
	const realEq = join(tmp, "pkg-eq-real");
	const linkEq = join(tmp, "pkg-eq-link");
	makePackage(realEq, "pkg-eq", ["extensions/a.ts", "extensions/b.ts"]);
	symlinkSync(realEq, linkEq);
	mkdirSync(join(projEq, ".pi"), { recursive: true });
	writeFileSync(settingsPath(projEq), `${JSON.stringify({ packages: [realEq] }, null, 2)}\n`);
	writeFileSync(join(projEq, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: { "eq-second": { kind: "package", source: realEq, enabled: true } } }, null, 2)}\n`);
	backupSettings(projEq);
	makeCatalog({ items: [{ id: "eq-first", kind: "package", source: linkEq }, { id: "eq-second", kind: "package", source: realEq }], profiles: [] });
	const capturedEq = await openDashboard(projEq, makeCtx(projEq, () => true));
	const eqParent = capturedEq.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length === 2);
	assert(eqParent, "equivalent-alias parent row missing");
	const eqIds = capturedEq.options.resolveUnloadIds!([eqParent!.id]);
	const eqConfirmation = capturedEq.options.unloadConfirmation!(eqIds);
	const eqConfirmationText = (eqConfirmation!.lines ?? []).join("\n");
	assert(eqConfirmationText.includes("eq-second"), "confirmation must show the captured exact catalog id");
	assert(!eqConfirmationText.includes("eq-first"), "confirmation must not show an earlier equivalent alias");
	const eqApply = await capturedEq.options.onSubmit!(eqIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(eqApply.title, "Construct unload complete");
	const eqCatalog = readCatalog();
	assert(!eqCatalog.items.some((item) => item.id === "eq-second"), "exact reviewed id should be removed");
	assert(eqCatalog.items.some((item) => item.id === "eq-first"), "equivalent alias entry must be preserved");

	// 5f) Trust refusal at the final metadata prewrite: index+catalog complete, metadata skipped.
	const projMetaTrust = join(tmp, "project-meta-trust");
	makeProject(projMetaTrust, [pkgMulti]);
	backupSettings(projMetaTrust);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const projectsIndexPath = join(process.env.HOME!, ".pi", "agent", "construct", "projects.json");
	rmSync(projectsIndexPath, { force: true });
	const ctxMetaTrust = makeCtx(projMetaTrust, () => !existsSync(projectsIndexPath));
	const capturedMetaTrust = await openDashboard(projMetaTrust, ctxMetaTrust);
	const mtParent = capturedMetaTrust.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(mtParent, "metadata-trust parent row missing");
	const mtIds = capturedMetaTrust.options.resolveUnloadIds!(mtParent!.aggregateChildIds!);
	const mtApply = await capturedMetaTrust.options.onSubmit!(mtIds, () => {}, new AbortController().signal, "unload", []);
	const mtText = mtApply.lines.join("\n");
	assert(mtText.includes("Known-project index was updated; current-project Construct metadata was not updated"), mtText);
	assert(!mtText.includes("shown as Unloaded"), mtText);
	assert(!readCatalog().items.some((item) => item.source === pkgMulti), "catalog removal should proceed when only metadata trust fails");
	assert(projectConstructItemCount(projMetaTrust) === 1, "metadata must be skipped when trust fails at its prewrite");

	// 5g) Metadata write failure after index+catalog writes: earlier results survive truthfully.
	const projMetaFail = join(tmp, "project-meta-fail");
	makeProject(projMetaFail, [pkgMulti]);
	backupSettings(projMetaFail);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedMF = await openDashboard(projMetaFail, makeCtx(projMetaFail, () => true));
	const mfParent = capturedMF.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(mfParent, "metadata-failure parent row missing");
	const mfIds = capturedMF.options.resolveUnloadIds!(mfParent!.aggregateChildIds!);
	chmodSync(join(projMetaFail, ".pi"), 0o555);
	try {
		const mfApply = await capturedMF.options.onSubmit!(mfIds, () => {}, new AbortController().signal, "unload", []);
		const mfText = mfApply.lines.join("\n");
		assert(mfText.includes("Current project Construct metadata removed: 0"), mfText);
		assert(mfText.includes("Could not update current project Construct metadata"), mfText);
		assert(!mfText.includes("shown as Unloaded"), mfText);
		assert(!readCatalog().items.some((item) => item.source === pkgMulti), "catalog removal should survive a metadata write failure");
	} finally {
		chmodSync(join(projMetaFail, ".pi"), 0o755);
	}

	// 5h) Available library-only package row unloads and leaves settings untouched.
	const projAvail = join(tmp, "project-avail");
	mkdirSync(join(projAvail, ".pi"), { recursive: true });
	writeFileSync(settingsPath(projAvail), `${JSON.stringify({ packages: [] }, null, 2)}\n`);
	writeFileSync(join(projAvail, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: {} }, null, 2)}\n`);
	backupSettings(projAvail);
	makeCatalog({ items: [{ id: "avail-pkg", kind: "package", source: pkgOther }], profiles: [] });
	const capturedAvail = await openDashboard(projAvail, makeCtx(projAvail, () => true));
	const availRow = capturedAvail.items.find((item) => item.section === "Available");
	assert(availRow, "Available row missing");
	const availSettings = settingsText(projAvail);
	const availIds = capturedAvail.options.resolveUnloadIds!([availRow!.id]);
	const availApply = await capturedAvail.options.onSubmit!(availIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(availApply.title, "Construct unload complete");
	assert(!readCatalog().items.some((item) => item.id === "avail-pkg"), "Available library item should be removed");
	assert.equal(settingsText(projAvail), availSettings, "Available unload must not edit settings");

	// 5i) Disabled (whole-package-filtered) row unloads from the library.
	const pkgDisabled = join(tmp, "pkg-disabled");
	makePackage(pkgDisabled, "pkg-disabled", ["extensions/a.ts"]);
	const projDisabled = join(tmp, "project-disabled");
	mkdirSync(join(projDisabled, ".pi"), { recursive: true });
	writeFileSync(settingsPath(projDisabled), `${JSON.stringify({ packages: [{ source: pkgDisabled, extensions: [], skills: [], prompts: [], themes: [] }] }, null, 2)}\n`);
	writeFileSync(join(projDisabled, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: { [deriveId(pkgDisabled)]: { kind: "package", source: pkgDisabled, enabled: true } } }, null, 2)}\n`);
	backupSettings(projDisabled);
	makeCatalog({ items: [{ id: deriveId(pkgDisabled), kind: "package", source: pkgDisabled }], profiles: [] });
	const capturedDisabled = await openDashboard(projDisabled, makeCtx(projDisabled, () => true));
	const disabledRow = capturedDisabled.items.find((item) => item.section === "Disabled");
	assert(disabledRow, "Disabled row missing");
	const disabledIds = capturedDisabled.options.resolveUnloadIds!([disabledRow!.id]);
	const disabledApply = await capturedDisabled.options.onSubmit!(disabledIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(disabledApply.title, "Construct unload complete");
	assert(!readCatalog().items.some((item) => item.source === pkgDisabled), "Disabled library item should be removed");

	// 5j) Unresolved (zero-resource managed) row unloads from the library.
	const pkgEmpty = join(tmp, "pkg-empty");
	mkdirSync(pkgEmpty, { recursive: true });
	writeFileSync(join(pkgEmpty, "package.json"), `${JSON.stringify({ name: "pkg-empty", version: "0.0.0", pi: { extensions: [] } }, null, 2)}\n`);
	const projUnresolved = join(tmp, "project-unresolved");
	mkdirSync(join(projUnresolved, ".pi"), { recursive: true });
	writeFileSync(settingsPath(projUnresolved), `${JSON.stringify({ packages: [pkgEmpty] }, null, 2)}\n`);
	writeFileSync(join(projUnresolved, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: { [deriveId(pkgEmpty)]: { kind: "package", source: pkgEmpty, enabled: true } } }, null, 2)}\n`);
	backupSettings(projUnresolved);
	makeCatalog({ items: [{ id: deriveId(pkgEmpty), kind: "package", source: pkgEmpty }], profiles: [] });
	const capturedUnresolved = await openDashboard(projUnresolved, makeCtx(projUnresolved, () => true));
	const unresolvedRow = capturedUnresolved.items.find((item) => item.section === "Unresolved");
	assert(unresolvedRow, "Unresolved row missing");
	const unresolvedIds = capturedUnresolved.options.resolveUnloadIds!([unresolvedRow!.id]);
	const unresolvedApply = await capturedUnresolved.options.onSubmit!(unresolvedIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(unresolvedApply.title, "Construct unload complete");
	assert(!readCatalog().items.some((item) => item.source === pkgEmpty), "Unresolved library item should be removed");

	// 5k) Cancellation during the index prewrite native await (helper boundary, no validate): no writes, no false untrusted label.
	const projAbortIndex = join(tmp, "project-abort-index");
	makeProject(projAbortIndex, [pkgMulti]);
	backupSettings(projAbortIndex);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const projectsIndex = join(process.env.HOME!, ".pi", "agent", "construct", "projects.json");
	rmSync(projectsIndex, { force: true });
	const indexCatalogItem = readCatalog().items.find((item) => item.source === pkgMulti)!;
	const controllerIndex = new AbortController();
	let abortOnTrust = false;
	const ctxAbortIndex = makeCtx(projAbortIndex, () => {
		if (abortOnTrust) controllerIndex.abort();
		return true;
	});
	abortOnTrust = true;
	const aiResult = await unloadConstructSources(ctxAbortIndex, [{ id: indexCatalogItem.id, source: indexCatalogItem.source }], { signal: controllerIndex.signal });
	assert(aiResult, "abort-index should return a partial result");
	assert(aiResult!.cancelled, "abort-index should report cancellation");
	assert.equal(aiResult!.removed.length, 0, "no catalog removal after index abort");
	assert.equal(aiResult!.trustSkipped, false, "Esc must not be labelled untrusted");
	assert.equal(aiResult!.indexUpdated, false, "no index update after index abort");
	assert(readCatalog().items.some((item) => item.source === pkgMulti), "no catalog write after index abort");
	assert(projectConstructItemCount(projAbortIndex) === 1, "no metadata write after index abort");
	assert(!existsSync(projectsIndex), "no index write after index abort");

	// 5l) Cancellation during the final metadata prewrite native await: index+catalog survive, metadata skipped, no false untrusted label.
	const projAbortMeta = join(tmp, "project-abort-meta");
	makeProject(projAbortMeta, [pkgMulti]);
	backupSettings(projAbortMeta);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	rmSync(projectsIndex, { force: true });
	const metaCatalogItem = readCatalog().items.find((item) => item.source === pkgMulti)!;
	const controllerMeta = new AbortController();
	const ctxAbortMeta = makeCtx(projAbortMeta, () => {
		if (existsSync(projectsIndex)) controllerMeta.abort();
		return true;
	});
	const amResult = await unloadConstructSources(ctxAbortMeta, [{ id: metaCatalogItem.id, source: metaCatalogItem.source }], { signal: controllerMeta.signal });
	assert(amResult, "abort-meta should return a partial result");
	assert(amResult!.cancelled, "abort-meta should report cancellation");
	assert.equal(amResult!.removed.length, 1, "catalog removal should survive a metadata abort");
	assert.equal(amResult!.indexUpdated, true, "index update should survive a metadata abort");
	assert.equal(amResult!.metadataRemoved, 0, "metadata must be skipped after its abort");
	assert.equal(amResult!.trustSkipped, false, "Esc must not be labelled untrusted");
	assert(projectConstructItemCount(projAbortMeta) === 1, "no metadata write after metadata abort");

	// 5m) Zero-write cancellation must not claim partial changes; malformed settings must re-review.
	const projCancelZero = join(tmp, "project-cancel-zero");
	makeProject(projCancelZero, [pkgMulti]);
	backupSettings(projCancelZero);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedCZ = await openDashboard(projCancelZero, makeCtx(projCancelZero, () => true));
	const czParent = capturedCZ.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(czParent, "cancel-zero parent row missing");
	const czIds = capturedCZ.options.resolveUnloadIds!(czParent!.aggregateChildIds!);
	const zeroController = new AbortController();
	zeroController.abort();
	const zeroApply = await capturedCZ.options.onSubmit!(czIds, () => {}, zeroController.signal, "unload", []);
	assert.equal(zeroApply.title, "Construct unload cancelled");
	assert(!zeroApply.lines.join("\n").includes("some writes"), "zero-write cancel must not claim writes");
	assert(readCatalog().items.some((item) => item.source === pkgMulti), "zero-write cancel must not remove the catalog item");

	const projMalformed = join(tmp, "project-malformed");
	makeProject(projMalformed, [pkgMulti]);
	backupSettings(projMalformed);
	makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
	const capturedMalformed = await openDashboard(projMalformed, makeCtx(projMalformed, () => true));
	const malformedParent = capturedMalformed.items.find((item) => item.aggregateChildIds && item.aggregateChildIds.length > 0);
	assert(malformedParent, "malformed parent row missing");
	const malformedIds = capturedMalformed.options.resolveUnloadIds!(malformedParent!.aggregateChildIds!);
	writeFileSync(settingsPath(projMalformed), "{ not json\n");
	const malformedApply = await capturedMalformed.options.onSubmit!(malformedIds, () => {}, new AbortController().signal, "unload", []);
	assert.equal(malformedApply.title, "Construct unload failed");
	assert(malformedApply.lines.join("\n").includes("re-review before unload"), "malformed settings should require re-review");
	assert(readCatalog().items.some((item) => item.source === pkgMulti), "malformed settings must not remove the catalog item");

	// 6) Real key routing: Space on a known multi-resource parent, Ctrl+U, then Enter unloads.
	{
		const { run } = await openKeyProject("project-key");
		try {
			run.harness.handleInput(" ");
			run.harness.handleInput("\u0015");
			assert(renderedText(run.harness).includes("from Construct?"), "Ctrl+U with a selection must open the unload confirmation");
			const keyResult = await driveKeys(run.harness, ["\r"]);
			assert(keyResult, "real-key unload did not complete");
			assert.equal(keyResult!.closeAction, "confirm");
			assert(!readCatalog().items.some((item) => item.source === pkgMulti), "real-key Ctrl+U did not unload the library item");
		} finally {
			await settleRun(run);
		}
	}

	// 6b) Kitty CSI-u Ctrl+U also works; legacy Esc in confirmation still cancels.
	{
		const { run } = await openKeyProject("project-key-kitty");
		try {
			run.harness.handleInput(" ");
			run.harness.handleInput("\x1b[117;5u");
			assert(renderedText(run.harness).includes("from Construct?"), "Kitty Ctrl+U must open the unload confirmation");
			run.harness.handleInput("\x1b");
			assert(readCatalog().items.some((item) => item.source === pkgMulti), "Esc in the unload confirmation must leave the library item");
			await escAndExpectClose(run.harness, 1);
		} finally {
			await settleRun(run);
		}
	}

	// 7) Ctrl+U without a selection stays selected-only: refusal panel, no mutation.
	{
		const { run } = await openKeyProject("project-key-no-sel");
		try {
			run.harness.handleInput("\u0015");
			const text = renderedText(run.harness);
			assert(text.includes("No library package selected"), "Ctrl+U without selection must explain selected-only scope");
			assert(text.includes("No files were changed") || text.includes("Nothing will be forgotten"), "Ctrl+U without selection must not promise changes");
			await escAndExpectClose(run.harness, 2);
			assert(readCatalog().items.some((item) => item.source === pkgMulti), "Ctrl+U without selection must not unload");
		} finally {
			await settleRun(run);
		}
	}

	// 8) Plain u/U/r/R/i/I always become filter text, with and without a selection.
	const plainKeys = ["u", "U", "r", "R", "i", "I"];
	let plainIndex = 0;
	for (const scope of ["nosel", "sel"] as const) {
		for (const key of plainKeys) {
			plainIndex += 1;
			const { run } = await openKeyProject(`project-plain-${scope}-${plainIndex}`);
			try {
				if (scope === "sel") run.harness.handleInput(" ");
				run.harness.handleInput(key);
				const text = renderedText(run.harness);
				assert(text.includes(`Filter: ${key}`), `plain "${key}" (${scope}) must become filter text`);
				assert(!text.includes("from this project?"), `plain "${key}" (${scope}) must not open remove`);
				assert(!text.includes("from Construct?"), `plain "${key}" (${scope}) must not open unload`);
				assert(!text.includes("No library package selected"), `plain "${key}" (${scope}) must not trigger unload refusal`);
				assert(!text.includes("Package resources:"), `plain "${key}" (${scope}) must not open inspect`);
				assert(readCatalog().items.some((item) => item.source === pkgMulti), `plain "${key}" (${scope}) must not mutate the library`);
				await escAndExpectClose(run.harness, 1);
			} finally {
				await settleRun(run);
			}
		}
	}

	// 9) Ctrl+R focused fallback opens remove; selected opens remove and can apply.
	{
		const { run, project } = await openKeyProject("project-ctrl-r-focused");
		try {
			run.harness.handleInput("\u0012");
			assert(renderedText(run.harness).includes("from this project?"), "Ctrl+R focused must open the remove confirmation");
			await escAndExpectClose(run.harness, 2);
			assert(settingsText(project).includes(pkgMulti), "Ctrl+R focused then Esc must not edit settings");
		} finally {
			await settleRun(run);
		}
	}
	{
		const { run, project } = await openKeyProject("project-ctrl-r-selected");
		try {
			run.harness.handleInput(" ");
			run.harness.handleInput("\u0012");
			assert(renderedText(run.harness).includes("from this project?"), "Ctrl+R selected must open the remove confirmation");
			const result = await driveKeys(run.harness, ["\r"]);
			assert(result, "Ctrl+R selected remove did not settle");
			assert(!settingsText(project).includes(pkgMulti), "Ctrl+R selected Enter must remove the declaration");
		} finally {
			await settleRun(run);
		}
	}
	{
		const { run } = await openKeyProject("project-ctrl-r-kitty");
		try {
			run.harness.handleInput("\x1b[114;5u");
			assert(renderedText(run.harness).includes("from this project?"), "Kitty Ctrl+R must open the remove confirmation");
			await escAndExpectClose(run.harness, 2);
		} finally {
			await settleRun(run);
		}
	}

	// 9b) Ctrl+Alt+R is the advertised remove trigger: legacy ESC+ctrl char and Kitty CSI-u, focused fallback and selected removal.
	{
		const { run, project } = await openKeyProject("project-ctrl-alt-r-focused");
		try {
			const text = renderedText(run.harness);
			assert(text.includes("Ctrl+Alt+R removes"), "dashboard footer must advertise Ctrl+Alt+R removal");
			assert(!text.includes("Ctrl+R removes"), "dashboard footer must no longer advertise Ctrl+R removal");
			run.harness.handleInput("\x1b\x12");
			assert(renderedText(run.harness).includes("from this project?"), "legacy Ctrl+Alt+R focused must open the remove confirmation");
			await escAndExpectClose(run.harness, 2);
			assert(settingsText(project).includes(pkgMulti), "legacy Ctrl+Alt+R focused then Esc must not edit settings");
		} finally {
			await settleRun(run);
		}
	}
	{
		const { run, project } = await openKeyProject("project-ctrl-alt-r-selected");
		try {
			run.harness.handleInput(" ");
			run.harness.handleInput("\x1b\x12");
			assert(renderedText(run.harness).includes("from this project?"), "legacy Ctrl+Alt+R selected must open the remove confirmation");
			const result = await driveKeys(run.harness, ["\r"]);
			assert(result, "legacy Ctrl+Alt+R selected remove did not settle");
			assert(!settingsText(project).includes(pkgMulti), "legacy Ctrl+Alt+R selected Enter must remove the declaration");
		} finally {
			await settleRun(run);
		}
	}
	{
		const { run, project } = await openKeyProject("project-ctrl-alt-r-kitty");
		try {
			run.harness.handleInput("\x1b[114;7u");
			assert(renderedText(run.harness).includes("from this project?"), "Kitty Ctrl+Alt+R must open the remove confirmation");
			await escAndExpectClose(run.harness, 2);
			assert(settingsText(project).includes(pkgMulti), "Kitty Ctrl+Alt+R then Esc must not edit settings");
		} finally {
			await settleRun(run);
		}
	}

	// 10) Alt+I opens details (legacy and Kitty); Enter returns to the pick, Esc closes.
	for (const [label, sequence] of [["legacy", "\x1bi"], ["kitty", "\x1b[105;3u"]] as const) {
		const { run } = await openKeyProject(`project-alt-i-${label}`);
		try {
			run.harness.handleInput(sequence);
			assert(renderedText(run.harness).includes("Package resources:"), `Alt+I (${label}) must open details`);
			run.harness.handleInput("\r");
			assert(!renderedText(run.harness).includes("Package resources:"), `Enter in details (${label}) must return to the pick`);
			assert(readCatalog().items.some((item) => item.source === pkgMulti), `Alt+I (${label}) must not mutate the library`);
			await escAndExpectClose(run.harness, 1);
		} finally {
			await settleRun(run);
		}
	}

	// 11) Tab must not open details or change the filter.
	{
		const { run } = await openKeyProject("project-tab");
		try {
			run.harness.handleInput("\t");
			const text = renderedText(run.harness);
			assert(!text.includes("Package resources:"), "Tab must not open details");
			assert(text.includes("Filter: all items"), "Tab must not change the filter query");
			await escAndExpectClose(run.harness, 1);
		} finally {
			await settleRun(run);
		}
	}

	// 12) Captured remove wiring unchanged: focused-row fallback still resolves through the real closures.
	{
		const project = join(tmp, "project-remove");
		makeProject(project, [pkgMulti]);
		backupSettings(project);
		makeCatalog({ items: [{ id: deriveId(pkgMulti), kind: "package", source: pkgMulti }], profiles: [] });
		const removeCaptured = await openDashboard(project, makeCtx(project, () => true));
		assert(removeCaptured.options.removeConfirmation, "remove confirmation missing");
		assert(removeCaptured.options.resolveRemoveIds, "resolveRemoveIds missing");
	}

	console.log("dashboard-unload smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
