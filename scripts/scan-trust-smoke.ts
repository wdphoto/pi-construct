// Cross-project scan reconcile trust-freshness coverage.
// Uses the small ScanPicker injection seam to capture the REAL showScanChecklist onSubmit
// callback and run it against isolated fixture projects plus isolated-HOME native trust-store
// files. Fixture-file conditions and a native trust-read wrapper drive the scenarios; no copied
// orchestration and no live trust state.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir, ProjectTrustStore, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildScanResult, showScanChecklist, type ScanPicker } from "../extensions/construct/commands/scan.js";
import { loadDirectResourcesIntoConstruct, loadSourcesIntoConstruct } from "../extensions/construct/commands/load.js";
import { getPaths } from "../extensions/construct/paths.js";
import { TrustRefusedError, targetTrustDecision } from "../extensions/construct/target-trust.js";
import type { CheckboxPickerApplyResult, CheckboxPickerItem } from "../extensions/construct/ui.js";
import type { DirectResourceSummary } from "../extensions/construct/types.js";

const tmp = mkdtempSync(join(tmpdir(), "construct-scan-trust-"));
process.env.HOME = join(tmp, "home");
mkdirSync(process.env.HOME, { recursive: true });

type ScanResult = Awaited<ReturnType<typeof buildScanResult>>;

// Native trust-read wrapper: fixture-file conditions only, no call-count timing.
const originalGet = ProjectTrustStore.prototype.get;
let trustWrapper: ((cwd: string, base: boolean | null) => boolean | null) | undefined;
ProjectTrustStore.prototype.get = function (this: unknown, cwd: string) {
	const base = originalGet.call(this, cwd);
	return trustWrapper ? trustWrapper(cwd, base) : base;
};

function trustFile(): string {
	return join(getAgentDir(), "trust.json");
}

function catalogPath(): string {
	return join(getAgentDir(), "construct", "catalog.json");
}

function userProjectsPath(): string {
	return join(getAgentDir(), "construct", "projects.json");
}

function writeTrust(entries: Record<string, boolean>): void {
	mkdirSync(dirname(trustFile()), { recursive: true });
	writeFileSync(trustFile(), `${JSON.stringify(entries, null, 2)}\n`);
}

function writeMalformedTrust(): void {
	mkdirSync(dirname(trustFile()), { recursive: true });
	writeFileSync(trustFile(), "{ not json\n");
}

function clearTrust(): void {
	rmSync(trustFile(), { force: true });
}

function resetUserState(): void {
	rmSync(join(getAgentDir(), "construct"), { recursive: true, force: true });
}

function makePackage(dir: string, name: string): void {
	mkdirSync(join(dir, "extensions"), { recursive: true });
	writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name, version: "0.0.0", pi: { extensions: ["extensions/index.ts"] } }, null, 2)}\n`);
	writeFileSync(join(dir, "extensions", "index.ts"), "export default function noop() {}\n");
}

function makeProject(root: string, source: string): void {
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), `${JSON.stringify({ packages: [source] }, null, 2)}\n`);
	resetProject(root);
}

function resetProject(root: string): void {
	writeFileSync(join(root, ".pi", "construct.json"), `${JSON.stringify({ version: 1, managedBy: "the-construct", items: {} }, null, 2)}\n`);
}

function addStaleItem(root: string, source: string): void {
	const path = join(root, ".pi", "construct.json");
	const data = JSON.parse(readFileSync(path, "utf8")) as { items?: Record<string, unknown> };
	data.items = { ...(data.items ?? {}), "stale-pkg": { kind: "package", source, enabled: true } };
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function constructText(root: string): string {
	return readFileSync(join(root, ".pi", "construct.json"), "utf8");
}

function settingsText(root: string): string {
	return readFileSync(join(root, ".pi", "settings.json"), "utf8");
}

function seedCatalogWithUnrelated(): void {
	mkdirSync(join(getAgentDir(), "construct"), { recursive: true });
	writeFileSync(
		catalogPath(),
		`${JSON.stringify({ version: 1, items: [{ id: "keep-item", kind: "package", source: "keep-source" }], profiles: [{ id: "keep-profile", sources: ["keep-source"] }] }, null, 2)}\n`,
	);
}

function catalogKeepsUnrelated(): boolean {
	const data = readJsonFile(catalogPath()) as { items?: Array<{ source?: string }>; profiles?: Array<{ id?: string }> } | undefined;
	return Boolean(data && (data.items ?? []).some((item) => item.source === "keep-source") && (data.profiles ?? []).some((profile) => profile.id === "keep-profile"));
}

function canonicalOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function constructHas(root: string, needle: string): boolean {
	const text = constructText(root);
	return text.includes(needle) || text.includes(canonicalOrSelf(needle));
}

function projectItems(root: string): Record<string, unknown> {
	const data = JSON.parse(constructText(root)) as { items?: Record<string, unknown> };
	return data.items ?? {};
}

function catalogHas(source: string): boolean {
	const wanted = canonicalOrSelf(source);
	try {
		const data = JSON.parse(readFileSync(catalogPath(), "utf8")) as { items?: Array<{ source?: string }> };
		return (data.items ?? []).some((item) => item.source === wanted || item.source === source);
	} catch {
		return false;
	}
}

function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function makeCtx(cwd: string, trusted: () => boolean, extra: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: trusted,
		waitForIdle: async () => {},
		reload: async () => {},
		ui: { notify: () => {}, setStatus: () => {} },
		...extra,
	} as unknown as ExtensionCommandContext;
}

async function reconcile(
	ctx: ExtensionCommandContext,
	result: ScanResult,
	select: (items: CheckboxPickerItem[]) => string[],
	controller = new AbortController(),
	update: (title: string, lines: string[]) => void = () => {},
): Promise<CheckboxPickerApplyResult> {
	let apply: CheckboxPickerApplyResult | undefined;
	const pick: ScanPicker = async (_ctx, _title, items, options) => {
		const ids = select(items);
		assert(options.onSubmit, "onSubmit missing on scan picker options");
		apply = await options.onSubmit(ids, update, controller.signal, "confirm", []);
		return { selectedIds: ids, closeAction: "confirm" };
	};
	await showScanChecklist(ctx, result, pick);
	assert(apply, "scan picker did not capture an apply result");
	return apply;
}

function allPackageIds(items: CheckboxPickerItem[]): string[] {
	return items.filter((item) => item.id.startsWith("package:")).map((item) => item.id);
}

function driftOnlyIds(items: CheckboxPickerItem[]): string[] {
	return items.filter((item) => item.id.startsWith("drift:")).map((item) => item.id);
}

function packageAndDriftIds(items: CheckboxPickerItem[]): string[] {
	return items.filter((item) => item.id.startsWith("package:") || item.id.startsWith("drift:")).map((item) => item.id);
}

try {
	const driver = join(tmp, "driver");
	mkdirSync(driver, { recursive: true });
	const scanRoot = join(tmp, "scanroot");
	const pkgA = join(tmp, "pkg-a");
	const pkgB = join(tmp, "pkg-b");
	makePackage(pkgA, "pkg-a");
	makePackage(pkgB, "pkg-b");
	const projA = join(scanRoot, "a");
	const projB = join(scanRoot, "b");
	makeProject(projA, pkgA);
	makeProject(projB, pkgB);
	const realA = realpathSync(projA);
	const realB = realpathSync(projB);
	const ctxDriver = makeCtx(driver, () => false);

	// 1) Continuously trusted cross-project target: catalog, project metadata, and known-projects are written.
	clearTrust();
	resetUserState();
	resetProject(projA);
	seedCatalogWithUnrelated();
	const settingsBeforeTrusted = settingsText(projA);
	writeTrust({ [realA]: true });
	const resultTrusted = await buildScanResult(ctxDriver, scanRoot);
	assert(resultTrusted.projects.some((project) => realpathSync(project.path) === realA), "trusted target was not discovered");
	const appliedTrusted = await reconcile(ctxDriver, resultTrusted, allPackageIds);
	const trustedLines = appliedTrusted.lines.join("\n");
	assert(trustedLines.includes("Packages armed: 1"), `expected one armed package:\n${trustedLines}`);
	assert(trustedLines.includes("Library sources added: 1"), trustedLines);
	assert(trustedLines.includes("Refused projects: 0"), trustedLines);
	assert(Object.keys(projectItems(projA)).length > 0, "trusted target metadata was not written");
	assert(catalogHas(pkgA), "catalog was not written for a trusted target");
	assert(catalogKeepsUnrelated(), "unrelated catalog item/profile were not preserved");
	assert.equal(settingsText(projA), settingsBeforeTrusted, "trusted load edited .pi/settings.json");
	assert(readJsonFile(userProjectsPath()), "known-projects was not written for a trusted target");

	// 2) Trust revoked after discovery and before apply: no catalog/metadata/known-projects writes.
	clearTrust();
	resetUserState();
	resetProject(projA);
	seedCatalogWithUnrelated();
	const settingsBeforeRevoked = settingsText(projA);
	writeTrust({ [realA]: true });
	const resultRevoked = await buildScanResult(ctxDriver, scanRoot);
	clearTrust();
	const appliedRevoked = await reconcile(ctxDriver, resultRevoked, allPackageIds);
	const revokedLines = appliedRevoked.lines.join("\n");
	assert(revokedLines.includes("Refused projects: 1"), revokedLines);
	assert(Object.keys(projectItems(projA)).length === 0, "revoked target project metadata was written");
	assert(!catalogHas(pkgA), "catalog was written for a revoked target");
	assert(catalogKeepsUnrelated(), "unrelated catalog item/profile were not preserved on refusal");
	assert.equal(settingsText(projA), settingsBeforeRevoked, "refused load edited .pi/settings.json");
	assert(readJsonFile(userProjectsPath()) === undefined, "known-projects was written for a revoked target");

	// 3) Malformed trust store before apply: unknown refusal, never treated as trusted.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	const resultMalformed = await buildScanResult(ctxDriver, scanRoot);
	writeMalformedTrust();
	const appliedMalformed = await reconcile(ctxDriver, resultMalformed, allPackageIds);
	const malformedLines = appliedMalformed.lines.join("\n");
	assert(malformedLines.includes("Refused projects: 1"), malformedLines);
	assert(malformedLines.includes("could not be read"), malformedLines);
	assert(Object.keys(projectItems(projA)).length === 0, "malformed trust store wrote project metadata");

	// 4) Trust latched at known-projects: catalog + metadata survive, known-projects does not resume.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	const resultKnownRefusal = await buildScanResult(ctxDriver, scanRoot);
	trustWrapper = (_cwd, base) => (constructHas(projA, pkgA) ? false : base);
	const appliedKnownRefusal = await reconcile(ctxDriver, resultKnownRefusal, allPackageIds);
	trustWrapper = undefined;
	const knownRefusalLines = appliedKnownRefusal.lines.join("\n");
	assert(knownRefusalLines.includes("Packages armed: 1"), knownRefusalLines);
	assert(knownRefusalLines.includes("Library sources added: 1"), knownRefusalLines);
	assert(knownRefusalLines.includes("Refused projects: 1"), knownRefusalLines);
	assert(constructHas(projA, pkgA), "metadata written before the refusal was lost");
	assert(catalogHas(pkgA), "catalog written before the refusal was lost");
	assert(readJsonFile(userProjectsPath()) === undefined, "known-projects resumed after a refusal");

	// 5) Load success then repair refusal: earlier completed load totals are preserved.
	clearTrust();
	resetUserState();
	resetProject(projA);
	addStaleItem(projA, join(tmp, "gone-package"));
	writeTrust({ [realA]: true });
	const resultRepairRefusal = await buildScanResult(ctxDriver, scanRoot);
	trustWrapper = (_cwd, base) => (existsSync(userProjectsPath()) ? false : base);
	const appliedRepairRefusal = await reconcile(ctxDriver, resultRepairRefusal, packageAndDriftIds);
	trustWrapper = undefined;
	const repairRefusalLines = appliedRepairRefusal.lines.join("\n");
	assert(repairRefusalLines.includes("Packages armed: 1"), repairRefusalLines);
	assert(repairRefusalLines.includes("Refused projects: 1"), repairRefusalLines);
	assert(repairRefusalLines.includes("Stale metadata removed: 0"), repairRefusalLines);
	assert(Object.keys(projectItems(projA)).length > 0, "completed load metadata was reported but not written");

	// 6) Load success then repair throw: earlier completed load totals and lines are preserved.
	clearTrust();
	resetUserState();
	resetProject(projA);
	addStaleItem(projA, join(tmp, "gone-package"));
	writeTrust({ [realA]: true });
	const resultRepairThrow = await buildScanResult(ctxDriver, scanRoot);
	trustWrapper = (_cwd, base) => {
		if (existsSync(userProjectsPath())) {
			writeFileSync(join(projA, ".pi", "construct.json"), "{ invalid json");
			return true;
		}
		return base;
	};
	const appliedRepairThrow = await reconcile(ctxDriver, resultRepairThrow, packageAndDriftIds);
	trustWrapper = undefined;
	const repairThrowLines = appliedRepairThrow.lines.join("\n");
	assert(repairThrowLines.includes("Packages armed: 1"), repairThrowLines);
	assert(repairThrowLines.includes("Drift repair failed"), repairThrowLines);

	// 7) Cancellation during the native prewrite await (catalog written, metadata not): report catalog-only progress.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	const resultCancelMetadata = await buildScanResult(ctxDriver, scanRoot);
	const controllerMetadata = new AbortController();
	trustWrapper = (_cwd, base) => {
		if (catalogHas(pkgA)) controllerMetadata.abort();
		return base;
	};
	const appliedCancelMetadata = await reconcile(ctxDriver, resultCancelMetadata, allPackageIds, controllerMetadata);
	trustWrapper = undefined;
	const cancelMetadataLines = appliedCancelMetadata.lines.join("\n");
	assert.equal(appliedCancelMetadata.title, "Construct scan reconcile cancelled");
	assert(cancelMetadataLines.includes("Library sources added: 1"), cancelMetadataLines);
	assert(cancelMetadataLines.includes("Packages armed: 0"), cancelMetadataLines);
	assert(catalogHas(pkgA), "cancelled load did not persist its completed catalog addition");
	assert(!constructHas(projA, pkgA), "cancelled load wrote project metadata after the abort");
	assert(readJsonFile(userProjectsPath()) === undefined, "cancelled load wrote known-projects after the abort");

	// 8) Cancellation after a completed load: completed metadata counts are reported.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	const resultCancelAfterLoad = await buildScanResult(ctxDriver, scanRoot);
	const controllerAfterLoad = new AbortController();
	trustWrapper = (_cwd, base) => {
		if (constructHas(projA, pkgA)) controllerAfterLoad.abort();
		return base;
	};
	const appliedCancelAfterLoad = await reconcile(ctxDriver, resultCancelAfterLoad, allPackageIds, controllerAfterLoad);
	trustWrapper = undefined;
	const cancelAfterLoadLines = appliedCancelAfterLoad.lines.join("\n");
	assert.equal(appliedCancelAfterLoad.title, "Construct scan reconcile cancelled");
	assert(cancelAfterLoadLines.includes("Packages armed: 1"), cancelAfterLoadLines);
	assert(catalogHas(pkgA), "cancelled load lost its completed catalog addition");
	assert(constructHas(projA, pkgA), "completed load metadata was not preserved on cancellation");
	assert(readJsonFile(userProjectsPath()) === undefined, "known-projects was written despite the post-load abort");

	// 9) Revocation of a later target AFTER the first target completed its writes.
	clearTrust();
	resetUserState();
	resetProject(projA);
	resetProject(projB);
	writeTrust({ [realA]: true, [realB]: true });
	const resultLaterRevoke = await buildScanResult(ctxDriver, scanRoot);
	assert.equal(resultLaterRevoke.projects.length, 2, "expected both targets discovered");
	trustWrapper = (cwd, base) => (canonicalOrSelf(cwd) === realB && constructHas(projA, pkgA) ? false : base);
	const appliedLaterRevoke = await reconcile(ctxDriver, resultLaterRevoke, allPackageIds);
	trustWrapper = undefined;
	const laterRevokeLines = appliedLaterRevoke.lines.join("\n");
	assert(laterRevokeLines.includes("Packages armed: 1"), laterRevokeLines);
	assert(laterRevokeLines.includes("Refused projects: 1"), laterRevokeLines);
	assert(Object.keys(projectItems(projA)).length > 0, "earlier target was not written");
	assert(Object.keys(projectItems(projB)).length === 0, "later revoked target was written");

	// 10) Non-idle wait with revocation during the wait.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	const ctxWaits = makeCtx(driver, () => false, {
		isIdle: () => false,
		waitForIdle: async () => {
			writeTrust({ [realA]: false });
		},
	} as Partial<ExtensionCommandContext>);
	// Discovery uses the saved store directly; build before the wait flips it.
	trustWrapper = undefined;
	const resultWait = await (async () => {
		writeTrust({ [realA]: true });
		return buildScanResult(ctxDriver, scanRoot);
	})();
	writeTrust({ [realA]: true });
	const appliedWait = await reconcile(ctxWaits, resultWait, allPackageIds);
	const waitLines = appliedWait.lines.join("\n");
	assert(waitLines.includes("Refused projects: 1"), waitLines);
	assert(Object.keys(projectItems(projA)).length === 0, "revocation during the idle wait did not block writes");

	// 11) Current target uses ctx exclusively: ctx=true discovers, then flipping to false refuses
	// even though the saved store says true.
	clearTrust();
	resetUserState();
	resetProject(projA);
	writeTrust({ [realA]: true });
	let currentTrusted = true;
	const ctxCurrent = makeCtx(realA, () => currentTrusted);
	const resultCurrent = await buildScanResult(ctxCurrent, scanRoot);
	assert(resultCurrent.projects.some((project) => realpathSync(project.path) === realA), "current target was not discovered");
	currentTrusted = false;
	const appliedCurrent = await reconcile(ctxCurrent, resultCurrent, allPackageIds);
	const currentLines = appliedCurrent.lines.join("\n");
	assert(currentLines.includes("Refused projects: 1"), currentLines);
	assert(Object.keys(projectItems(projA)).length === 0, "current ctx=false was overridden by saved trust");

	// 12) Negative discovery: current ctx=false is not rescued by a saved store grant.
	clearTrust();
	resetUserState();
	writeTrust({ [realA]: true });
	const ctxCurrentFalse = makeCtx(realA, () => false);
	const resultNegative = await buildScanResult(ctxCurrentFalse, scanRoot);
	assert(!resultNegative.projects.some((project) => realpathSync(project.path) === realA), "untrusted current project was discovered via saved trust");

	// 13) Session-only grant: ctx=true with no saved entry discovers the current project.
	clearTrust();
	resetUserState();
	const ctxSession = makeCtx(realA, () => true);
	const resultSession = await buildScanResult(ctxSession, scanRoot);
	assert(resultSession.projects.some((project) => realpathSync(project.path) === realA), "session-only current grant was ignored");

	// 14) Canonical alias: a symlinked current cwd still matches the target for ctx exclusivity,
	// and a saved entry keyed by the real path is found through an aliased arbitrary target.
	const linkA = join(tmp, "link-a");
	symlinkSync(projA, linkA);
	clearTrust();
	writeTrust({ [realA]: false });
	const ctxAliasCurrent = makeCtx(linkA, () => true);
	assert.equal(await targetTrustDecision(ctxAliasCurrent, projA), "trusted", "aliased current cwd should use ctx exclusively");
	clearTrust();
	writeTrust({ [realA]: true });
	assert.equal(await targetTrustDecision(ctxDriver, linkA), "trusted", "aliased target should resolve the saved entry");

	// 15) Current ctx trust lookup error is unknown, not trusted.
	clearTrust();
	const ctxError = makeCtx(realA, () => {
		throw new Error("trust lookup failed");
	});
	assert.equal(await targetTrustDecision(ctxError, projA), "unknown", "current lookup error should be unknown");

	// 16) Helper-level: catalog-written -> metadata refused keeps the catalog addition and stops known-projects.
	const helperPkg = join(tmp, "pkg-helper");
	makePackage(helperPkg, "pkg-helper");
	const projHelper = join(tmp, "helper-project");
	makeProject(projHelper, helperPkg);
	clearTrust();
	resetUserState();
	resetProject(projHelper);
	const helperPaths = await getPaths({ cwd: projHelper });
	const metadataRefusal = await loadSourcesIntoConstruct({ cwd: projHelper }, helperPaths, [helperPkg], {
		prewrite: async () => {
			if (catalogHas(helperPkg)) throw new TrustRefusedError(projHelper, "untrusted");
		},
	});
	assert.equal(metadataRefusal.metadataChanged, 0, "refused metadata write was counted");
	assert.equal(metadataRefusal.refused, "untrusted");
	assert(catalogHas(helperPkg), "catalog addition should survive metadata refusal");
	assert(!constructHas(projHelper, helperPkg), "refused metadata write still wrote the project file");
	assert(readJsonFile(userProjectsPath()) === undefined, "known-projects resumed after metadata refusal");

	// 17) Helper-level: metadata-written -> known-projects refused latches and does not count the index.
	clearTrust();
	resetUserState();
	resetProject(projHelper);
	const knownRefusal = await loadSourcesIntoConstruct({ cwd: projHelper }, helperPaths, [helperPkg], {
		prewrite: async () => {
			if (constructHas(projHelper, helperPkg)) throw new TrustRefusedError(projHelper, "untrusted");
		},
	});
	assert.equal(knownRefusal.metadataChanged, 1, "metadata write should succeed before the refusal");
	assert.equal(knownRefusal.refused, "untrusted");
	assert(constructHas(projHelper, helperPkg), "metadata written before refusal was lost");
	assert(readJsonFile(userProjectsPath()) === undefined, "known-projects wrote after a latched refusal");

	// 18) Direct metadata failure and refusal both count zero adopted resources.
	const resource: DirectResourceSummary = {
		id: "extension:direct-x",
		kind: "extension",
		name: "direct-x",
		path: "direct-x.ts",
		displayPath: "direct-x.ts",
		scope: "project",
		origin: "top-level",
		source: "project",
		enabled: true,
		managed: false,
	};
	resetProject(projHelper);
	const directFailure = await loadDirectResourcesIntoConstruct({ cwd: projHelper }, helperPaths, [resource], async () => {
		throw new Error("write failed");
	});
	assert.equal(directFailure.metadataChanged, 0, "failed direct write was counted as adopted");
	resetProject(projHelper);
	const directRefusal = await loadDirectResourcesIntoConstruct({ cwd: projHelper }, helperPaths, [resource], async () => {
		throw new TrustRefusedError(projHelper, "untrusted");
	});
	assert.equal(directRefusal.metadataChanged, 0, "refused direct write was counted as adopted");
	assert.equal(directRefusal.refused, "untrusted");
	assert(!constructHas(projHelper, "direct-x.ts"), "refused direct write still wrote metadata");

	// 19) Continuous-trusted drift-only repair still applies (no package query involved).
	clearTrust();
	resetUserState();
	resetProject(projA);
	addStaleItem(projA, join(tmp, "gone-package"));
	writeTrust({ [realA]: true });
	const resultDriftOk = await buildScanResult(ctxDriver, scanRoot);
	const settingsBeforeDriftOk = settingsText(projA);
	const appliedDriftOk = await reconcile(ctxDriver, resultDriftOk, driftOnlyIds);
	const driftOkLines = appliedDriftOk.lines.join("\n");
	assert.equal(appliedDriftOk.title, "Construct scan reconcile complete");
	assert(driftOkLines.includes("Stale metadata removed: 1"), driftOkLines);
	assert(!constructHas(projA, "gone-package"), "drift repair did not remove the stale item");
	assert.equal(settingsText(projA), settingsBeforeDriftOk, "drift repair edited .pi/settings.json");

	// 20) Drift-only cancellation at the FINAL prewrite trust lookup (post-await guard) only:
	// abort is armed by the real progress notification immediately before that lookup, so the
	// initial repair trust check and the pre-await check cannot satisfy this fixture.
	clearTrust();
	resetUserState();
	resetProject(projA);
	addStaleItem(projA, join(tmp, "gone-package"));
	writeTrust({ [realA]: true });
	const resultDriftCancel = await buildScanResult(ctxDriver, scanRoot);
	const constructBeforeDriftCancel = constructText(projA);
	const settingsBeforeDriftCancel = settingsText(projA);
	let sawFinalTrustProgress = false;
	let abortNextTrust = false;
	const controllerDrift = new AbortController();
	trustWrapper = (_cwd, base) => {
		if (abortNextTrust) {
			abortNextTrust = false;
			controllerDrift.abort();
		}
		return base;
	};
	const appliedDriftCancel = await reconcile(
		ctxDriver,
		resultDriftCancel,
		driftOnlyIds,
		controllerDrift,
		(_title, lines) => {
			if (lines.some((line) => line.includes("checking trust before writing drift metadata"))) {
				sawFinalTrustProgress = true;
				abortNextTrust = true;
			}
		},
	);
	trustWrapper = undefined;
	assert(sawFinalTrustProgress, "final prewrite trust progress point was not reached");
	assert.equal(appliedDriftCancel.title, "Construct scan reconcile cancelled");
	assert.equal(constructText(projA), constructBeforeDriftCancel, "cancelled drift repair changed .pi/construct.json");
	assert.equal(settingsText(projA), settingsBeforeDriftCancel, "cancelled drift repair changed .pi/settings.json");

	// 21) Native trust boundary (restored acceptance coverage): inherited, nearer deny, missing, malformed.
	const ancestor = join(tmp, "ancestor");
	mkdirSync(join(ancestor, "nested"), { recursive: true });
	const nested = join(ancestor, "nested");
	const realAncestor = realpathSync(ancestor);
	const realNested = realpathSync(nested);
	clearTrust();
	writeTrust({ [realAncestor]: true });
	assert.equal(await targetTrustDecision(ctxDriver, nested), "trusted", "inherited ancestor trust should apply");
	writeTrust({ [realAncestor]: true, [realNested]: false });
	assert.equal(await targetTrustDecision(ctxDriver, nested), "untrusted", "nearer explicit deny should win over inherited trust");
	clearTrust();
	assert.equal(await targetTrustDecision(ctxDriver, nested), "untrusted", "missing trust store should be untrusted");
	writeMalformedTrust();
	assert.equal(await targetTrustDecision(ctxDriver, nested), "unknown", "malformed trust store should be unknown");

	console.log("scan-trust smoke ok");
} finally {
	trustWrapper = undefined;
	ProjectTrustStore.prototype.get = originalGet;
	rmSync(tmp, { recursive: true, force: true });
}
