// Orchestration coverage for the dashboard child-filter submit path.
// Uses the narrow DashboardPicker injection seam to capture the REAL submitConfirmation/onSubmit
// closures and run them against real isolated local projects (no mocks of the executor internals).
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleDashboard, type DashboardPicker } from "../extensions/construct/commands/dashboard.js";
import { deriveId } from "../extensions/construct/catalog.js";
import { formatPackageSourceLabel } from "../extensions/construct/sources.js";
import type { CheckboxPickerApplyResult, CheckboxPickerItem, CheckboxPickerOptions } from "../extensions/construct/ui.js";

interface Captured {
	items: CheckboxPickerItem[];
	options: CheckboxPickerOptions;
}

type Update = (title: string, lines: string[]) => void;

function makePackage(dir: string, name: string, files: string[]): void {
	mkdirSync(join(dir, "extensions"), { recursive: true });
	writePackageManifest(dir, name, files);
	for (const file of files) writeFileSync(join(dir, file), "export default function noop() {}\n");
}

function writePackageManifest(dir: string, name: string, files: string[]): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", pi: { extensions: files } }, null, 2) + "\n");
}

function makeProject(root: string, packages: unknown[], extra: Record<string, unknown> = {}): void {
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ ...extra, packages }, null, 2) + "\n");
	const items: Record<string, unknown> = {};
	for (const source of packages) {
		if (typeof source === "string") items[deriveId(source)] = { kind: "package", source, enabled: true };
	}
	writeFileSync(join(root, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items }, null, 2) + "\n");
}

function addConstructItems(project: string, items: Record<string, unknown>): void {
	const path = join(project, ".pi", "construct.json");
	const data = JSON.parse(readFileSync(path, "utf8"));
	data.items = { ...data.items, ...items };
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function makeCatalog(home: string, data: { items?: unknown[]; profiles?: unknown[] }): void {
	const dir = join(home, ".pi", "agent", "construct");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "catalog.json"), JSON.stringify({ version: 1, items: data.items ?? [], profiles: data.profiles ?? [] }, null, 2) + "\n");
}

function settingsPath(project: string): string {
	return join(project, ".pi", "settings.json");
}

function settings(project: string): string {
	return readFileSync(settingsPath(project), "utf8");
}

function backupSettings(project: string): void {
	copyFileSync(settingsPath(project), join(project, ".pi", "settings.json.test-backup"));
}

function makeCtx(cwd: string, trusted: () => boolean): ExtensionCommandContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: trusted,
		waitForIdle: async () => {},
		reload: async () => {},
		ui: { notify: () => {}, setStatus: () => {} },
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

async function submit(captured: Captured, ids: string[], changedIds: string[], update: Update = () => {}, controller = new AbortController()): Promise<CheckboxPickerApplyResult> {
	assert(captured.options.onSubmit, "onSubmit missing");
	return captured.options.onSubmit(ids, update, controller.signal, "confirm", changedIds);
}

function parentOfValue(captured: Captured, value: string): CheckboxPickerItem {
	const child = captured.items.find((item) => item.parentId && item.value === value);
	assert(child?.parentId, `no child row for ${value}`);
	const parent = captured.items.find((item) => item.id === child.parentId);
	assert(parent, `parent missing for ${value}`);
	return parent;
}

function childrenByValue(captured: Captured, parentId: string): CheckboxPickerItem[] {
	return captured.items.filter((item) => item.parentId === parentId);
}

const tmp = mkdtempSync(join(tmpdir(), "construct-submit-safety-"));
process.env.HOME = join(tmp, "home");
mkdirSync(process.env.HOME, { recursive: true });

try {
	const pkgA = join(tmp, "pkg-a");
	const pkgB = join(tmp, "pkg-b");
	const pkgC = join(tmp, "pkg-c");
	makePackage(pkgA, "pkg-a", ["extensions/a.ts", "extensions/b.ts"]);
	makePackage(pkgB, "pkg-b", ["extensions/only.ts"]);
	makePackage(pkgC, "pkg-c", ["extensions/c.ts", "extensions/d.ts"]);

	// 1) Mixed: child plan + sibling package row is refused before any mutation, and the review refuses to submit.
	const mixed = join(tmp, "proj-mixed");
	makeProject(mixed, [pkgA, pkgB], { model: "keep-me" });
	const mixedCtx = makeCtx(mixed, () => true);
	const mixedCaptured = await openDashboard(mixed, mixedCtx);
	const mixedParent = parentOfValue(mixedCaptured, "extensions/a.ts");
	const mixedChildA = childrenByValue(mixedCaptured, mixedParent.id).find((item) => item.value === "extensions/a.ts");
	assert(mixedChildA, "child a missing");
	const sibling = mixedCaptured.items.find((item) => !item.parentId && item.value === formatPackageSourceLabel(pkgB));
	assert(sibling, "sibling package row missing");
	const beforeMixed = settings(mixed);
	const mixedIds = [mixedParent.id, mixedChildA.id, sibling.id];
	assert.equal(mixedCaptured.options.submitConfirmation?.(mixedIds, "confirm", [mixedChildA.id])?.canSubmit, false, "preview must refuse mixed batches");
	const mixedResult = await submit(mixedCaptured, mixedIds, [mixedChildA.id]);
	assert.equal(mixedResult.title, "Mixed selection not applied", JSON.stringify(mixedResult));
	assert(mixedResult.lines.some((line) => line.includes("No files were changed.")), JSON.stringify(mixedResult));
	assert.equal(settings(mixed), beforeMixed, "mixed refusal must not write settings");

	// 2) Child-only all-selected (aggregate parent id present) applies, preserves unrelated settings.
	const solo = join(tmp, "proj-solo");
	makeProject(solo, [pkgA], { model: "keep-me" });
	const soloCaptured = await openDashboard(solo, makeCtx(solo, () => true));
	const soloParent = parentOfValue(soloCaptured, "extensions/a.ts");
	const soloChildren = childrenByValue(soloCaptured, soloParent.id);
	assert.equal(soloChildren.length, 2);
	const soloResult = await submit(soloCaptured, [soloParent.id, ...soloChildren.map((child) => child.id)], soloChildren.map((child) => child.id));
	assert.equal(soloResult.title, "Package resource filters applied", JSON.stringify(soloResult));
	const soloSettings = JSON.parse(settings(solo));
	assert.equal(soloSettings.model, "keep-me", "unrelated setting must survive");
	assert.deepEqual(soloSettings.packages[0].extensions, [], "all-selected enabled children toggle off");
	assert.deepEqual(soloSettings.packages[0].themes, []);

	// 3) Multiple child-only packages in one batch must not self-conflict.
	const multi = join(tmp, "proj-multi");
	makeProject(multi, [pkgA, pkgC]);
	const multiCaptured = await openDashboard(multi, makeCtx(multi, () => true));
	const multiParentA = parentOfValue(multiCaptured, "extensions/a.ts");
	const multiParentC = parentOfValue(multiCaptured, "extensions/c.ts");
	const multiChildrenA = childrenByValue(multiCaptured, multiParentA.id);
	const multiChildrenC = childrenByValue(multiCaptured, multiParentC.id);
	const multiResult = await submit(
		multiCaptured,
		[multiParentA.id, ...multiChildrenA.map((c) => c.id), multiParentC.id, ...multiChildrenC.map((c) => c.id)],
		[...multiChildrenA.map((c) => c.id), ...multiChildrenC.map((c) => c.id)],
	);
	assert.equal(multiResult.title, "Package resource filters applied", JSON.stringify(multiResult));
	assert(!multiResult.lines.some((line) => line.includes("Not applied")), JSON.stringify(multiResult));

	// 4) Sequential child packages: the second submit must not self-conflict with the first's write.
	const seq = join(tmp, "proj-seq");
	makeProject(seq, [pkgA, pkgC]);
	const seqFirst = await openDashboard(seq, makeCtx(seq, () => true));
	const seqParentA = parentOfValue(seqFirst, "extensions/a.ts");
	const seqChildrenA = childrenByValue(seqFirst, seqParentA.id);
	const seqFirstResult = await submit(seqFirst, [seqParentA.id, ...seqChildrenA.map((c) => c.id)], seqChildrenA.map((c) => c.id));
	assert.equal(seqFirstResult.title, "Package resource filters applied", JSON.stringify(seqFirstResult));
	const seqSecond = await openDashboard(seq, makeCtx(seq, () => true));
	const seqParentC = parentOfValue(seqSecond, "extensions/c.ts");
	const seqChildrenC = childrenByValue(seqSecond, seqParentC.id);
	const seqSecondResult = await submit(seqSecond, [seqParentC.id, ...seqChildrenC.map((c) => c.id)], seqChildrenC.map((c) => c.id));
	assert.equal(seqSecondResult.title, "Package resource filters applied", JSON.stringify(seqSecondResult));

	// 5) A real change to an unselected child's effective state between review and apply is refused.
	const drift = join(tmp, "proj-drift");
	makeProject(drift, [pkgA]);
	const driftCaptured = await openDashboard(drift, makeCtx(drift, () => true));
	const driftParent = parentOfValue(driftCaptured, "extensions/a.ts");
	const driftChildA = childrenByValue(driftCaptured, driftParent.id).find((item) => item.value === "extensions/a.ts");
	assert(driftChildA, "drift child missing");
	backupSettings(drift);
	writeFileSync(settingsPath(drift), JSON.stringify({ packages: [{ source: pkgA, extensions: ["extensions/a.ts"], skills: [], prompts: [], themes: [] }] }, null, 2) + "\n");
	const beforeDrift = settings(drift);
	const driftResult = await submit(driftCaptured, [driftParent.id, driftChildA.id], [driftChildA.id]);
	assert.equal(driftResult.title, "Package resource update needs re-review", JSON.stringify(driftResult));
	assert.equal(settings(drift), beforeDrift, "stale refusal must not write settings");

	// 6) A reviewed resource that disappears between review and apply is refused (no zero-selected stale plan).
	const missing = join(tmp, "proj-missing");
	makeProject(missing, [pkgA]);
	const missingCaptured = await openDashboard(missing, makeCtx(missing, () => true));
	const missingParent = parentOfValue(missingCaptured, "extensions/a.ts");
	const missingChildB = childrenByValue(missingCaptured, missingParent.id).find((item) => item.value === "extensions/b.ts");
	assert(missingChildB, "missing child missing");
	writePackageManifest(pkgA, "pkg-a", ["extensions/a.ts"]);
	const beforeMissing = settings(missing);
	const missingResult = await submit(missingCaptured, [missingParent.id, missingChildB.id], [missingChildB.id]);
	assert.equal(missingResult.title, "Package resource update needs re-review", JSON.stringify(missingResult));
	assert.equal(settings(missing), beforeMissing, "missing-resource refusal must not write settings");
	writePackageManifest(pkgA, "pkg-a", ["extensions/a.ts", "extensions/b.ts"]);

	// 7) Declaration-policy-only drift: broad -> exact with the SAME enabled resources must still be refused.
	const policy = join(tmp, "proj-policy");
	makeProject(policy, [pkgA]);
	backupSettings(policy);
	writeFileSync(settingsPath(policy), JSON.stringify({ packages: [{ source: pkgA, extensions: ["extensions/*"] }] }, null, 2) + "\n");
	const policyCaptured = await openDashboard(policy, makeCtx(policy, () => true));
	const policyParent = parentOfValue(policyCaptured, "extensions/a.ts");
	const policyChildA = childrenByValue(policyCaptured, policyParent.id).find((item) => item.value === "extensions/a.ts");
	assert(policyChildA, "policy child missing");
	backupSettings(policy);
	writeFileSync(settingsPath(policy), JSON.stringify({ packages: [{ source: pkgA, extensions: ["extensions/a.ts", "extensions/b.ts"] }] }, null, 2) + "\n");
	const beforePolicy = settings(policy);
	const policyResult = await submit(policyCaptured, [policyParent.id, policyChildA.id], [policyChildA.id]);
	assert.equal(policyResult.title, "Package resource update needs re-review", JSON.stringify(policyResult));
	assert(policyResult.lines.some((line) => line.includes("declaration policy changed")), JSON.stringify(policyResult));
	assert.equal(settings(policy), beforePolicy, "declaration-policy refusal must not write settings");

	// 8) A newly added reviewed-package resource (not selected) is refused rather than silently disabled.
	const added = join(tmp, "proj-added");
	makeProject(added, [pkgA]);
	const addedCaptured = await openDashboard(added, makeCtx(added, () => true));
	const addedParent = parentOfValue(addedCaptured, "extensions/a.ts");
	const addedChildA = childrenByValue(addedCaptured, addedParent.id).find((item) => item.value === "extensions/a.ts");
	assert(addedChildA, "added child missing");
	writeFileSync(join(pkgA, "extensions/c.ts"), "export default function noop() {}\n");
	writePackageManifest(pkgA, "pkg-a", ["extensions/a.ts", "extensions/b.ts", "extensions/c.ts"]);
	const beforeAdded = settings(added);
	const addedResult = await submit(addedCaptured, [addedParent.id, addedChildA.id], [addedChildA.id]);
	assert.equal(addedResult.title, "Package resource update needs re-review", JSON.stringify(addedResult));
	assert(addedResult.lines.some((line) => line.includes("1 added")), JSON.stringify(addedResult));
	assert.equal(settings(added), beforeAdded, "added-resource refusal must not write settings");
	writePackageManifest(pkgA, "pkg-a", ["extensions/a.ts", "extensions/b.ts"]);

	// 9) Per-target re-read: editing a later target after the first write must not be blessed by a batch snapshot.
	const later = join(tmp, "proj-later");
	makeProject(later, [pkgA, pkgC]);
	const laterCaptured = await openDashboard(later, makeCtx(later, () => true));
	const laterParentA = parentOfValue(laterCaptured, "extensions/a.ts");
	const laterParentC = parentOfValue(laterCaptured, "extensions/c.ts");
	const laterChildrenA = childrenByValue(laterCaptured, laterParentA.id);
	const laterChildrenC = childrenByValue(laterCaptured, laterParentC.id);
	let editedLater = false;
	const laterResult = await submit(
		laterCaptured,
		[laterParentA.id, ...laterChildrenA.map((c) => c.id), laterParentC.id, ...laterChildrenC.map((c) => c.id)],
		[...laterChildrenA.map((c) => c.id), ...laterChildrenC.map((c) => c.id)],
		(_title, lines) => {
			if (editedLater || !lines[0]?.startsWith("1/")) return;
			editedLater = true;
			backupSettings(later);
			const data = JSON.parse(settings(later));
			data.packages[1] = { source: pkgC, extensions: ["extensions/c.ts", "extensions/d.ts"] };
			writeFileSync(settingsPath(later), JSON.stringify(data, null, 2) + "\n");
		},
	);
	assert.equal(laterResult.title, "Package resource update needs re-review", JSON.stringify(laterResult));
	const laterSettings = JSON.parse(settings(later));
	assert.equal(laterSettings.packages[1].source, pkgC);
	assert.deepEqual(laterSettings.packages[1].extensions, ["extensions/c.ts", "extensions/d.ts"], "second target must keep the external edit, not Construct filters");
	assert.deepEqual(Object.keys(laterSettings.packages[1]).sort(), ["extensions", "source"], "second target declaration must not be rewritten with Construct filter kinds");

	// 10) Trust revoked after idle but before the first mutator: no writes.
	const trustRevokedEarly = join(tmp, "proj-trust-early");
	makeProject(trustRevokedEarly, [pkgA]);
	let earlyTrust = true;
	const earlyCaptured = await openDashboard(trustRevokedEarly, makeCtx(trustRevokedEarly, () => earlyTrust));
	const earlyParent = parentOfValue(earlyCaptured, "extensions/a.ts");
	const earlyChildren = childrenByValue(earlyCaptured, earlyParent.id);
	const beforeEarly = settings(trustRevokedEarly);
	const earlyResult = await submit(earlyCaptured, [earlyParent.id, ...earlyChildren.map((c) => c.id)], earlyChildren.map((c) => c.id), () => {
		earlyTrust = false;
	});
	assert.equal(earlyResult.title, "Project not trusted", JSON.stringify(earlyResult));
	assert(earlyResult.lines.some((line) => line.includes("No files were changed.")), JSON.stringify(earlyResult));
	assert.equal(settings(trustRevokedEarly), beforeEarly, "revoked trust must not write settings");

	// 11) Trust revoked mid-batch: first target applies, second is skipped with trust accounting.
	const trustRevokedMid = join(tmp, "proj-trust-mid");
	makeProject(trustRevokedMid, [pkgA, pkgC]);
	let midTrust = true;
	const midCaptured = await openDashboard(trustRevokedMid, makeCtx(trustRevokedMid, () => midTrust));
	const midParentA = parentOfValue(midCaptured, "extensions/a.ts");
	const midParentC = parentOfValue(midCaptured, "extensions/c.ts");
	const midChildrenA = childrenByValue(midCaptured, midParentA.id);
	const midChildrenC = childrenByValue(midCaptured, midParentC.id);
	const midResult = await submit(
		midCaptured,
		[midParentA.id, ...midChildrenA.map((c) => c.id), midParentC.id, ...midChildrenC.map((c) => c.id)],
		[...midChildrenA.map((c) => c.id), ...midChildrenC.map((c) => c.id)],
		(_title, lines) => {
			if (lines[0]?.startsWith("1/")) midTrust = false;
		},
	);
	assert.equal(midResult.title, "Package resource update needs re-review", JSON.stringify(midResult));
	assert(midResult.lines.some((line) => line.includes("Trust changed (not applied): 1")), JSON.stringify(midResult));
	const midSettings = JSON.parse(settings(trustRevokedMid));
	assert.deepEqual(midSettings.packages[0].extensions, [], "first target applied before trust was revoked");
	assert.equal(typeof midSettings.packages[1], "string", "second target stayed untouched");

	// 12) Mixed child + direct resource is refused.
	const mixedDirect = join(tmp, "proj-mixed-direct");
	makeProject(mixedDirect, [pkgA]);
	mkdirSync(join(mixedDirect, ".pi", "skills", "review"), { recursive: true });
	writeFileSync(join(mixedDirect, ".pi", "skills", "review", "SKILL.md"), "---\ndescription: review\n---\n# Review\n");
	addConstructItems(mixedDirect, { "skill:review": { kind: "skill", path: ".pi/skills/review/SKILL.md", enabled: true } });
	const mixedDirectCaptured = await openDashboard(mixedDirect, makeCtx(mixedDirect, () => true));
	const mixedDirectParent = parentOfValue(mixedDirectCaptured, "extensions/a.ts");
	const mixedDirectChild = childrenByValue(mixedDirectCaptured, mixedDirectParent.id)[0];
	assert(mixedDirectChild, "mixed direct child missing");
	const directRow = mixedDirectCaptured.items.find((item) => item.label === "skill:review");
	assert(directRow, "direct row missing");
	const beforeMixedDirect = settings(mixedDirect);
	const mixedDirectResult = await submit(mixedDirectCaptured, [mixedDirectParent.id, mixedDirectChild.id, directRow.id], [mixedDirectChild.id]);
	assert.equal(mixedDirectResult.title, "Mixed selection not applied", JSON.stringify(mixedDirectResult));
	assert.equal(settings(mixedDirect), beforeMixedDirect, "mixed direct refusal must not write settings");

	// 13) Mixed child + saved loadout is refused.
	const mixedSaved = join(tmp, "proj-mixed-saved");
	makeProject(mixedSaved, [pkgA]);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-b", source: pkgB }], profiles: [{ id: "loadout-b", sources: [pkgB] }] });
	const mixedSavedCaptured = await openDashboard(mixedSaved, makeCtx(mixedSaved, () => true));
	const mixedSavedParent = parentOfValue(mixedSavedCaptured, "extensions/a.ts");
	const mixedSavedChild = childrenByValue(mixedSavedCaptured, mixedSavedParent.id)[0];
	assert(mixedSavedChild, "mixed saved child missing");
	const savedRow = mixedSavedCaptured.items.find((item) => item.label === "loadout-b");
	assert(savedRow, `saved row missing: ${JSON.stringify(mixedSavedCaptured.items.map((i) => i.label))}`);
	const beforeMixedSaved = settings(mixedSaved);
	const mixedSavedResult = await submit(mixedSavedCaptured, [mixedSavedParent.id, mixedSavedChild.id, savedRow.id], [mixedSavedChild.id]);
	assert.equal(mixedSavedResult.title, "Mixed selection not applied", JSON.stringify(mixedSavedResult));
	assert.equal(settings(mixedSaved), beforeMixedSaved, "mixed saved refusal must not write settings");

	// 14) Ordinary-only selection (no child changes) still applies through the normal step runner.
	const ordinary = join(tmp, "proj-ordinary");
	makeProject(ordinary, [pkgA]);
	const ordinaryCaptured = await openDashboard(ordinary, makeCtx(ordinary, () => true));
	const ordinaryParent = parentOfValue(ordinaryCaptured, "extensions/a.ts");
	const ordinaryResult = await submit(ordinaryCaptured, [ordinaryParent.id], []);
	assert.equal(ordinaryResult.title, "Construct Loadout changes applied", JSON.stringify(ordinaryResult));
	const ordinarySettings = JSON.parse(settings(ordinary));
	assert.deepEqual(ordinarySettings.packages[0].extensions, [], "ordinary whole-package disable applied");
	assert.equal(ordinarySettings.packages[0].source, pkgA);

	// 15) Available install then zero resolved inventory: installed, filters not applied, reload required.
	const availZeroDir = join(tmp, "pkg-avail-zero");
	makePackage(availZeroDir, "pkg-avail-zero", ["extensions/x.ts", "extensions/y.ts"]);
	const availZero = join(tmp, "proj-avail-zero");
	makeProject(availZero, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-zero", kind: "package", source: availZeroDir }], profiles: [] });
	const availZeroCaptured = await openDashboard(availZero, makeCtx(availZero, () => true));
	const availZeroParent = parentOfValue(availZeroCaptured, "extensions/x.ts");
	const availZeroChildren = childrenByValue(availZeroCaptured, availZeroParent.id);
	assert.equal(availZeroChildren.length, 2, "Available children must come from cached temporary resources");
	writePackageManifest(availZeroDir, "pkg-avail-zero", []);
	const availZeroResult = await submit(availZeroCaptured, [availZeroParent.id, ...availZeroChildren.map((c) => c.id)], availZeroChildren.map((c) => c.id));
	assert.equal(availZeroResult.title, "Installed without reviewed filters", JSON.stringify(availZeroResult));
	assert(availZeroResult.lines.some((line) => line.includes("installed, but Pi did not resolve package resources")), JSON.stringify(availZeroResult));
	assert.equal(availZeroResult.confirmAction, "reload", "install requires reload");
	const availZeroSettings = JSON.parse(settings(availZero));
	assert.equal(availZeroSettings.packages.length, 1, "install must add exactly one declaration");
	const availZeroEntry = availZeroSettings.packages[0] as string | { source: string; extensions?: string[] };
	assert((typeof availZeroEntry === "string" ? availZeroEntry : availZeroEntry.source).includes("pkg-avail-zero"), JSON.stringify(availZeroEntry));
	assert.equal(typeof availZeroEntry === "string" ? undefined : availZeroEntry.extensions, undefined, "no filters written after zero resolve");

	// 16) Available install then changed inventory: installed, reviewed filters refused, reload required.
	const availChangedDir = join(tmp, "pkg-avail-changed");
	makePackage(availChangedDir, "pkg-avail-changed", ["extensions/x.ts", "extensions/y.ts"]);
	const availChanged = join(tmp, "proj-avail-changed");
	makeProject(availChanged, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-changed", kind: "package", source: availChangedDir }], profiles: [] });
	const availChangedCaptured = await openDashboard(availChanged, makeCtx(availChanged, () => true));
	const availChangedParent = parentOfValue(availChangedCaptured, "extensions/x.ts");
	const availChangedChildren = childrenByValue(availChangedCaptured, availChangedParent.id);
	assert.equal(availChangedChildren.length, 2);
	writeFileSync(join(availChangedDir, "extensions/z.ts"), "export default function noop() {}\n");
	writePackageManifest(availChangedDir, "pkg-avail-changed", ["extensions/z.ts"]);
	const availChangedResult = await submit(availChangedCaptured, [availChangedParent.id, ...availChangedChildren.map((c) => c.id)], availChangedChildren.map((c) => c.id));
	assert.equal(availChangedResult.title, "Installed without reviewed filters", JSON.stringify(availChangedResult));
	assert(availChangedResult.lines.some((line) => line.includes("resources changed after install")), JSON.stringify(availChangedResult));
	assert.equal(availChangedResult.confirmAction, "reload", "install requires reload");
	const availChangedSettings = JSON.parse(settings(availChanged));
	assert.equal(availChangedSettings.packages.length, 1, "install must add exactly one declaration");
	const availChangedEntry = availChangedSettings.packages[0] as string | { source: string; extensions?: string[] };
	assert((typeof availChangedEntry === "string" ? availChangedEntry : availChangedEntry.source).includes("pkg-avail-changed"), JSON.stringify(availChangedEntry));
	assert.equal(typeof availChangedEntry === "string" ? undefined : availChangedEntry.extensions, undefined, "no filters written after changed inventory");

	// 17) Available gains an equivalent-relative declaration before submit: refused before install, no mutation.
	const availGainDir = join(tmp, "pkg-avail-gain");
	makePackage(availGainDir, "pkg-avail-gain", ["extensions/x.ts", "extensions/y.ts"]);
	const availGain = join(tmp, "proj-avail-gain");
	makeProject(availGain, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-gain", kind: "package", source: availGainDir }], profiles: [] });
	const availGainCaptured = await openDashboard(availGain, makeCtx(availGain, () => true));
	const availGainParent = parentOfValue(availGainCaptured, "extensions/x.ts");
	const availGainChildren = childrenByValue(availGainCaptured, availGainParent.id);
	assert.equal(availGainChildren.length, 2);
	const relativeGain = relative(join(availGain, ".pi"), availGainDir);
	backupSettings(availGain);
	writeFileSync(settingsPath(availGain), JSON.stringify({ packages: [{ source: relativeGain, extensions: ["extensions/x.ts", "extensions/y.ts"] }] }, null, 2) + "\n");
	const beforeGain = settings(availGain);
	const availGainResult = await submit(availGainCaptured, [availGainParent.id, ...availGainChildren.map((c) => c.id)], availGainChildren.map((c) => c.id));
	assert.equal(availGainResult.title, "Package resource update needs re-review", JSON.stringify(availGainResult));
	assert(availGainResult.lines.some((line) => line.includes("a package declaration appeared since this review")), JSON.stringify(availGainResult));
	assert(availGainResult.lines.some((line) => line.includes("No files were changed.")), JSON.stringify(availGainResult));
	assert.equal(settings(availGain), beforeGain, "pre-install declaration refusal must not write or install");

	// 18) Available policy added during install/re-resolve with the SAME enabled resources: installed without reviewed filters.
	const availPolicyDir = join(tmp, "pkg-avail-policy");
	makePackage(availPolicyDir, "pkg-avail-policy", ["extensions/x.ts", "extensions/y.ts"]);
	const availPolicy = join(tmp, "proj-avail-policy");
	makeProject(availPolicy, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-policy", kind: "package", source: availPolicyDir }], profiles: [] });
	let injectPolicy = false;
	let policyInjected = false;
	const availPolicyCtx = makeCtx(availPolicy, () => {
		if (injectPolicy && !policyInjected) {
			const data = JSON.parse(settings(availPolicy));
			if (Array.isArray(data.packages) && data.packages.length > 0) {
				policyInjected = true;
				const source = typeof data.packages[0] === "string" ? data.packages[0] : data.packages[0].source;
				data.packages[0] = { source, extensions: ["extensions/x.ts", "extensions/y.ts"] };
				backupSettings(availPolicy);
				writeFileSync(settingsPath(availPolicy), JSON.stringify(data, null, 2) + "\n");
			}
		}
		return true;
	});
	const availPolicyCaptured = await openDashboard(availPolicy, availPolicyCtx);
	const availPolicyParent = parentOfValue(availPolicyCaptured, "extensions/x.ts");
	const availPolicyChildren = childrenByValue(availPolicyCaptured, availPolicyParent.id);
	const availPolicyResult = await submit(availPolicyCaptured, [availPolicyParent.id, ...availPolicyChildren.map((c) => c.id)], availPolicyChildren.map((c) => c.id), () => {
		injectPolicy = true;
	});
	assert.equal(availPolicyResult.title, "Installed without reviewed filters", JSON.stringify(availPolicyResult));
	assert(availPolicyResult.lines.some((line) => line.includes("partial filters")), JSON.stringify(availPolicyResult));
	assert(policyInjected, "policy injection must have run after install");
	assert.equal(availPolicyResult.confirmAction, "reload", "install requires reload");

	// 19) Trust revoked immediately after install, before inspection: installed without reviewed filters, reload kept.
	const availTrustDir = join(tmp, "pkg-avail-trust");
	makePackage(availTrustDir, "pkg-avail-trust", ["extensions/x.ts", "extensions/y.ts"]);
	const availTrust = join(tmp, "proj-avail-trust");
	makeProject(availTrust, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-trust", kind: "package", source: availTrustDir }], profiles: [] });
	let revokeAfterInstall = false;
	const availTrustCtx = makeCtx(availTrust, () => {
		if (revokeAfterInstall) {
			const data = JSON.parse(settings(availTrust));
			if (Array.isArray(data.packages) && data.packages.length > 0) return false;
		}
		return true;
	});
	const availTrustCaptured = await openDashboard(availTrust, availTrustCtx);
	const availTrustParent = parentOfValue(availTrustCaptured, "extensions/x.ts");
	const availTrustChildren = childrenByValue(availTrustCaptured, availTrustParent.id);
	const availTrustResult = await submit(availTrustCaptured, [availTrustParent.id, ...availTrustChildren.map((c) => c.id)], availTrustChildren.map((c) => c.id), () => {
		revokeAfterInstall = true;
	});
	assert.equal(availTrustResult.title, "Installed without reviewed filters", JSON.stringify(availTrustResult));
	assert(availTrustResult.lines.some((line) => line.includes("project is no longer trusted")), JSON.stringify(availTrustResult));
	assert.equal(availTrustResult.confirmAction, "reload", "install requires reload");
	const availTrustSettings = JSON.parse(settings(availTrust));
	assert.equal(availTrustSettings.packages.length, 1, "install must have happened");
	assert.equal(typeof availTrustSettings.packages[0] === "string" ? undefined : availTrustSettings.packages[0].extensions, undefined, "no filters written after trust was revoked");

	// 20) Absolute Construct metadata + equivalent relative declaration broad -> exact (same enabled) is refused.
	const availMetaDir = join(tmp, "pkg-avail-meta");
	makePackage(availMetaDir, "pkg-avail-meta", ["extensions/x.ts", "extensions/y.ts"]);
	const metaProject = join(tmp, "proj-meta");
	makeProject(metaProject, []);
	const metaRelative = relative(join(metaProject, ".pi"), availMetaDir);
	backupSettings(metaProject);
	writeFileSync(settingsPath(metaProject), JSON.stringify({ packages: [{ source: metaRelative, extensions: ["extensions/*"] }] }, null, 2) + "\n");
	addConstructItems(metaProject, { [deriveId(availMetaDir)]: { kind: "package", source: availMetaDir, enabled: true } });
	const metaCaptured = await openDashboard(metaProject, makeCtx(metaProject, () => true));
	const metaParent = parentOfValue(metaCaptured, "extensions/x.ts");
	const metaChildA = childrenByValue(metaCaptured, metaParent.id).find((item) => item.value === "extensions/x.ts");
	assert(metaChildA, "metadata/relative child missing (scope-aware match failed)");
	backupSettings(metaProject);
	writeFileSync(settingsPath(metaProject), JSON.stringify({ packages: [{ source: metaRelative, extensions: ["extensions/x.ts", "extensions/y.ts"] }] }, null, 2) + "\n");
	const beforeMeta = settings(metaProject);
	const metaResult = await submit(metaCaptured, [metaParent.id, metaChildA.id], [metaChildA.id]);
	assert.equal(metaResult.title, "Package resource update needs re-review", JSON.stringify(metaResult));
	assert(metaResult.lines.some((line) => line.includes("declaration policy changed")), JSON.stringify(metaResult));
	assert.equal(settings(metaProject), beforeMeta, "scope-aware declaration refusal must not write settings");

	// 21) Abort after install before the write: installed without reviewed filters, reload kept.
	const availCancelDir = join(tmp, "pkg-avail-cancel");
	makePackage(availCancelDir, "pkg-avail-cancel", ["extensions/x.ts", "extensions/y.ts"]);
	const availCancel = join(tmp, "proj-avail-cancel");
	makeProject(availCancel, []);
	makeCatalog(process.env.HOME, { items: [{ id: "pkg-avail-cancel", kind: "package", source: availCancelDir }], profiles: [] });
	const cancelController = new AbortController();
	let abortAfterInstall = false;
	const availCancelCtx = makeCtx(availCancel, () => {
		if (abortAfterInstall) {
			const data = JSON.parse(settings(availCancel));
			if (Array.isArray(data.packages) && data.packages.length > 0) cancelController.abort();
		}
		return true;
	});
	const availCancelCaptured = await openDashboard(availCancel, availCancelCtx);
	const availCancelParent = parentOfValue(availCancelCaptured, "extensions/x.ts");
	const availCancelChildren = childrenByValue(availCancelCaptured, availCancelParent.id);
	const availCancelResult = await submit(availCancelCaptured, [availCancelParent.id, ...availCancelChildren.map((c) => c.id)], availCancelChildren.map((c) => c.id), () => {
		abortAfterInstall = true;
	}, cancelController);
	assert.equal(availCancelResult.title, "Installed without reviewed filters", JSON.stringify(availCancelResult));
	assert(availCancelResult.lines.some((line) => line.includes("cancelled before reviewed filters")), JSON.stringify(availCancelResult));
	assert.equal(availCancelResult.confirmAction, "reload", "install requires reload");
	const availCancelSettings = JSON.parse(settings(availCancel));
	assert.equal(availCancelSettings.packages.length, 1, "install must have happened");
	assert.equal(typeof availCancelSettings.packages[0] === "string" ? undefined : availCancelSettings.packages[0].extensions, undefined, "no filters written after cancellation");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log("dashboard-submit-safety smoke ok");
