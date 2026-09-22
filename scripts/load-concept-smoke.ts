// Coverage for the direct library-only add concept: `/construct load <explicit-source>` remembers
// an undeclared package source in the global Construct library, and the thin top-level `/load`
// command is always library-only. Uses isolated HOME/PI_OFFLINE and real writes; never installs or
// touches live configuration.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import constructExtension from "../extensions/construct/index.js";
import { handleLoad, handleDirectLoad, partitionLoadQueries } from "../extensions/construct/commands/load.js";
import { isExplicitPackageSource } from "../extensions/construct/sources.js";
import { getPaths } from "../extensions/construct/paths.js";

process.env.HOME = join(mkdtempSync(join(tmpdir(), "construct-load-concept-")), "home");
process.env.PI_OFFLINE = "1";
const tmp = process.env.HOME.replace(/\/home$/, "");
mkdirSync(process.env.HOME, { recursive: true });

function makeCtx(cwd: string, options: { trusted?: boolean; mode?: "tui" | "print" } = {}): { ctx: ExtensionCommandContext; notes: string[] } {
	const notes: string[] = [];
	const ctx = {
		cwd,
		mode: options.mode ?? "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: () => options.trusted ?? true,
		waitForIdle: async () => {},
		reload: async () => {},
		ui: {
			notify: (message: string) => {
				notes.push(message);
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notes };
}

interface StoredCatalog {
	items: Array<{ id: string; source: string }>;
}

function readCatalog(path: string): StoredCatalog {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as StoredCatalog;
	} catch {
		return { items: [] };
	}
}

function writeSkill(dir: string, name: string, description: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

try {
	const project = join(tmp, "project");
	mkdirSync(join(project, ".pi"), { recursive: true });
	const settingsPath = join(project, ".pi", "settings.json");
	const constructPath = join(project, ".pi", "construct.json");
	const settingsBefore = JSON.stringify({ packages: [] }, null, 2) + "\n";
	writeFileSync(settingsPath, settingsBefore);
	const paths = await getPaths({ cwd: project } as never);

	// 0) Conservative explicit-source predicate.
	assert.equal(isExplicitPackageSource("git:github.com/spf13/go-skills"), true);
	assert.equal(isExplicitPackageSource("npm:@scope/pkg"), true);
	assert.equal(isExplicitPackageSource("npm:construct-demo"), true);
	assert.equal(isExplicitPackageSource("https://github.com/spf13/go-skills"), true);
	assert.equal(isExplicitPackageSource("ssh://git@github.com/spf13/go-skills"), true);
	assert.equal(isExplicitPackageSource("git@github.com:spf13/go-skills"), true);
	assert.equal(isExplicitPackageSource("my-resource"), false);
	assert.equal(isExplicitPackageSource("./local-package"), true);
	assert.equal(isExplicitPackageSource("../sibling"), true);
	assert.equal(isExplicitPackageSource("~/packages/foo"), true);
	assert.equal(isExplicitPackageSource("/absolute/path"), true);
	assert.equal(isExplicitPackageSource("~"), false, "bare ~ is not an explicit local path");
	assert.equal(isExplicitPackageSource("."), false);
	assert.equal(isExplicitPackageSource(".."), false);
	assert.equal(isExplicitPackageSource("/"), false, "bare root is not an explicit local path");
	assert.equal(isExplicitPackageSource("git:"), false);
	assert.equal(isExplicitPackageSource("https://"), false);
	assert.equal(isExplicitPackageSource("github.com/spf13/go-skills"), false, "bare host/path is not explicit");
	const partition = partitionLoadQueries(["https://github.com/a/b", "./relative-pkg", "my-resource"]);
	assert.deepEqual(partition.sources, ["https://github.com/a/b", "./relative-pkg"]);
	assert.deepEqual(partition.queries, ["my-resource"]);
	assert.deepEqual(partition.refused, []);

	// 1) Direct add via /construct load: explicit source with no project declaration -> library only.
	{
		const { ctx, notes } = makeCtx(project);
		await handleLoad("https://github.com/spf13/go-skills", ctx);
		const text = notes.join("\n");
		assert.match(text, /library only/i, text);
		assert.match(text, /did not install packages or change project files/, text);
		const catalog = readCatalog(paths.userCatalogPath);
		assert(catalog.items.some((item) => item.source === "https://github.com/spf13/go-skills"), JSON.stringify(catalog));
		assert.equal(existsSync(constructPath), false, "library-only add must not create .pi/construct.json");
		assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore, "library-only add must not edit .pi/settings.json");
		assert.equal(existsSync(join(project, ".pi", "git")), false, "must not install or create a project checkout");
	}

	// 2) Duplicate/equivalent source: the git: spelling matches the existing https:// item.
	{
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("git:github.com/spf13/go-skills", ctx);
		assert.match(notes.join("\n"), /already known 1/);
		const catalog = readCatalog(paths.userCatalogPath);
		assert.equal(catalog.items.filter((item) => /go-skills/.test(item.source)).length, 1, JSON.stringify(catalog));
	}

	// 3) Malformed/ambiguous input is never remembered.
	{
		const { ctx, notes } = makeCtx(project);
		await handleLoad("my-resource-name", ctx);
		assert.match(notes.join("\n"), /Not an unloaded project resource/);
		assert.equal(readCatalog(paths.userCatalogPath).items.some((item) => item.source === "my-resource-name"), false);
	}
	{
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("my-resource-name", ctx);
		assert.match(notes.join("\n"), /Not an explicit package source/);
	}
	{
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("git:", ctx);
		assert.match(notes.join("\n"), /Not an explicit package source/);
	}

	// 4) Secret-like URLs and generated Pi cache paths are refused like /construct import.
	{
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("https://user:secret@github.com/spf13/go-skills", ctx);
		assert.match(notes.join("\n"), /looks like it contains credentials or secrets/);
	}
	{
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("/tmp/construct-fixture/.pi/agent/git/github.com/spf13/go-skills", ctx);
		assert.match(notes.join("\n"), /generated Pi package cache path/);
	}

	// 5) Untrusted project: library-only adds still work; project queries stay refused.
	{
		const { ctx, notes } = makeCtx(project, { trusted: false });
		await handleLoad("npm:construct-demo", ctx);
		assert.match(notes.join("\n"), /library only/i);
		assert(readCatalog(paths.userCatalogPath).items.some((item) => item.source === "npm:construct-demo"));
	}
	{
		const { ctx, notes } = makeCtx(project, { trusted: false });
		await handleLoad("my-resource-name", ctx);
		assert.match(notes.join("\n"), /not trusted by Pi/);
	}

	// 6) Dispatcher: the thin top-level /load alias is registered and routed to library-only add.
	{
		const registered: Array<{ name: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }> = [];
		const pi = {
			registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
				registered.push({ name, handler: options.handler });
			},
		} as unknown as ExtensionAPI;
		constructExtension(pi);
		assert(registered.some((entry) => entry.name === "construct"), "construct command was not registered");
		const loadCommand = registered.find((entry) => entry.name === "load");
		assert(loadCommand, "/load command was not registered");
		const { ctx, notes } = makeCtx(project);
		await loadCommand.handler("npm:alias-demo", ctx);
		assert.match(notes.join("\n"), /Construct library updated \(library only\)/);
		assert(readCatalog(paths.userCatalogPath).items.some((item) => item.source === "npm:alias-demo"));
		assert.equal(existsSync(constructPath), false, "/load must not create .pi/construct.json");
		assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore, "/load must not edit .pi/settings.json");
	}

	// 7) Catalog warning/refusal blocks the write and is reported truthfully, without '+' additions.
	{
		writeFileSync(paths.userCatalogPath, JSON.stringify({ items: [] }, null, 2) + "\n");
		const { ctx, notes } = makeCtx(project);
		await handleDirectLoad("npm:blocked-demo", ctx);
		const text = notes.join("\n");
		assert.match(text, /Construct library was not changed \(library only\)/, text);
		assert.match(text, /catalog has warnings|Skipped/, text);
		assert.doesNotMatch(text, /\+ npm:blocked-demo/, text);
		const catalog = JSON.parse(readFileSync(paths.userCatalogPath, "utf8")) as { items: Array<{ source: string }> };
		assert.equal(catalog.items.some((item) => item.source === "npm:blocked-demo"), false);
	}

	// 8) Trust lost during the idle wait: the undeclared explicit source is still added (library-only
	// adds never depend on project trust), while declared-resource adoption refuses and no project or
	// known-project file is written.
	{
		const lostProject = join(tmp, "trust-lost");
		mkdirSync(join(lostProject, ".pi"), { recursive: true });
		const lostSettings = JSON.stringify({ packages: ["git:github.com/example/lost-declared"] }, null, 2) + "\n";
		writeFileSync(join(lostProject, ".pi", "settings.json"), lostSettings);
		writeFileSync(paths.userCatalogPath, JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
		const lostPaths = await getPaths({ cwd: lostProject } as never);
		let trusted = true;
		const notes: string[] = [];
		const ctx = {
			cwd: lostProject,
			mode: "print",
			hasUI: true,
			isIdle: () => false,
			isProjectTrusted: () => trusted,
			waitForIdle: async () => {
				trusted = false;
			},
			reload: async () => {},
			ui: {
				notify: (message: string) => {
					notes.push(message);
				},
				setStatus: () => {},
			},
		} as unknown as ExtensionCommandContext;
		await handleLoad("git:github.com/example/lost-declared https://github.com/example/lost-library", ctx);
		const text = notes.join("\n");
		assert.match(text, /Construct library updated \(library only\)/, text);
		assert(readCatalog(lostPaths.userCatalogPath).items.some((item) => item.source === "https://github.com/example/lost-library"), text);
		assert.doesNotMatch(text, /\+ [^\n]*lost-declared/, "declared adoption must not be reported as added when trust is lost");
		assert.match(text, /not trusted by Pi|refused/i, text);
		assert.equal(existsSync(join(lostProject, ".pi", "construct.json")), false, "lost trust must not create .pi/construct.json");
		assert.equal(readFileSync(join(lostProject, ".pi", "settings.json"), "utf8"), lostSettings, "lost trust must not edit .pi/settings.json");
		assert.equal(existsSync(join(lostPaths.constructDir, "projects.json")), false, "lost trust must not record a known project");
	}

	// 9) Local package sources: normalization, dedupe, file/dir, /construct fallback, missing, cache.
	{
		writeFileSync(paths.userCatalogPath, JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
		const localDir = join(project, "local-pkg");
		const localFile = join(project, "single-extension.ts");
		mkdirSync(localDir, { recursive: true });
		writeFileSync(localFile, "export default function () {}\n");
		const realLocalDir = realpathSync(localDir);
		const realLocalFile = realpathSync(localFile);

		// (a) `./relative` normalizes against ctx.cwd and stores the realpath, never the relative form.
		{
			const { ctx, notes } = makeCtx(project);
			await handleDirectLoad("./local-pkg", ctx);
			const text = notes.join("\n");
			assert.match(text, /Construct library updated \(library only\)/, text);
			assert.match(text, /machine-specific/, text);
			const catalog = readCatalog(paths.userCatalogPath);
			assert(catalog.items.some((item) => item.source === realLocalDir), JSON.stringify(catalog));
			assert.equal(catalog.items.some((item) => item.source === "./local-pkg"), false, "relative form must not be stored");
		}
		// (b) Equivalent local spellings dedupe to one catalog item.
		{
			const { ctx } = makeCtx(project);
			await handleDirectLoad(`./local-pkg ${realLocalDir}`, ctx);
			const catalog = readCatalog(paths.userCatalogPath);
			assert.equal(catalog.items.filter((item) => item.source === realLocalDir).length, 1, JSON.stringify(catalog));
		}
		// (c) A file source is accepted without inventing package-structure validation.
		{
			const { ctx } = makeCtx(project);
			await handleDirectLoad("./single-extension.ts", ctx);
			assert(readCatalog(paths.userCatalogPath).items.some((item) => item.source === realLocalFile));
		}
		// (d) `/construct load ./relative` with no declaration falls back to library-only.
		{
			const { ctx, notes } = makeCtx(project);
			await handleLoad("./local-pkg", ctx);
			assert.match(notes.join("\n"), /Construct library updated \(library only\)/);
			assert.equal(existsSync(constructPath), false, "local fallback must not create .pi/construct.json");
			assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore, "local fallback must not edit .pi/settings.json");
		}
		// (e) Missing local path is refused before any write.
		{
			const before = readFileSync(paths.userCatalogPath, "utf8");
			const { ctx, notes } = makeCtx(project);
			await handleDirectLoad("./does-not-exist", ctx);
			const text = notes.join("\n");
			assert.match(text, /Construct \/load refused/, text);
			assert.match(text, /do not exist or are not readable/, text);
			assert.equal(readFileSync(paths.userCatalogPath, "utf8"), before, "missing path must not change the catalog");
		}
		// (f) Generated Pi cache paths are refused before normalization.
		{
			const { ctx, notes } = makeCtx(project);
			await handleDirectLoad("~/.pi/agent/git/github.com/spf13/go-skills", ctx);
			assert.match(notes.join("\n"), /generated Pi package cache path/);
		}
		// (g) Whitespace-separated paths are unsupported and refuse rather than guess.
		{
			const before = readFileSync(paths.userCatalogPath, "utf8");
			const { ctx, notes } = makeCtx(project);
			await handleDirectLoad("./has space", ctx);
			assert.match(notes.join("\n"), /refused/i);
			assert.equal(readFileSync(paths.userCatalogPath, "utf8"), before);
		}
		// (h) Local adds never install or create a project checkout.
		assert.equal(existsSync(join(project, ".pi", "git")), false, "local adds must not install or clone");
	}

	// 10) A declared local path is still adopted into project metadata, not only remembered.
	{
		const declProject = join(tmp, "declared-local");
		mkdirSync(join(declProject, ".pi"), { recursive: true });
		const declDir = join(declProject, "declared-pkg");
		mkdirSync(declDir, { recursive: true });
		const realDeclDir = realpathSync(declDir);
		const declSettings = JSON.stringify({ packages: [realDeclDir] }, null, 2) + "\n";
		writeFileSync(join(declProject, ".pi", "settings.json"), declSettings);
		const declPaths = await getPaths({ cwd: declProject } as never);
		writeFileSync(declPaths.userCatalogPath, JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
		const { ctx, notes } = makeCtx(declProject, { mode: "print" });
		await handleLoad(realDeclDir, ctx);
		assert.match(notes.join("\n"), /Construct load complete/i);
		const construct = JSON.parse(readFileSync(join(declProject, ".pi", "construct.json"), "utf8")) as { items: Record<string, { source?: string }> };
		assert(Object.values(construct.items).some((item) => item.source === realDeclDir), JSON.stringify(construct));
		assert.equal(readFileSync(join(declProject, ".pi", "settings.json"), "utf8"), declSettings, "adoption must not rewrite settings");
	}

	// 11) Mixed run regression: an already-managed carrier plus an unmatched explicit source must
	// still refresh the carrier's advisory snapshot while the unmatched source is added library-only.
	// The library-only early return used to bypass refreshManagedAdvisorySnapshots entirely.
	{
		const carrierProject = join(tmp, "mixed-managed-carrier");
		const carrierSource = "https://github.com/example/mixed-managed-carrier";
		const unmatchedSource = "https://github.com/example/mixed-unmatched-source";
		const carrierCheckout = join(carrierProject, ".pi", "git", "github.com", "example", "mixed-managed-carrier");
		mkdirSync(join(carrierCheckout, ".claude-plugin"), { recursive: true });
		writeFileSync(join(carrierCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./mixed-skill" }] }));
		writeSkill(join(carrierCheckout, "mixed-skill"), "mixed-skill", "Mixed-run carrier skill.");
		mkdirSync(join(carrierProject, ".pi"), { recursive: true });
		const carrierSettings = JSON.stringify({ packages: [carrierSource] }, null, 2) + "\n";
		writeFileSync(join(carrierProject, ".pi", "settings.json"), carrierSettings);
		const carrierConstruct = JSON.stringify({ version: 1, managedBy: "the-construct", items: { "mixed-managed-carrier": { kind: "package", source: carrierSource, enabled: true } } }, null, 2) + "\n";
		writeFileSync(join(carrierProject, ".pi", "construct.json"), carrierConstruct);
		const carrierPaths = await getPaths({ cwd: carrierProject } as never);
		mkdirSync(carrierPaths.constructDir, { recursive: true });
		writeFileSync(carrierPaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "mixed-managed-carrier", kind: "package", source: carrierSource }], profiles: [{ id: "keep-recipe", kind: "profile", sources: [carrierSource] }] }, null, 2) + "\n");
		// The shared Construct index may already exist from earlier scenarios; the mixed run must not
		// record this project in it, so compare bytes rather than asserting absence.
		const projectsIndexPath = join(carrierPaths.constructDir, "projects.json");
		const projectsIndexBefore = existsSync(projectsIndexPath) ? readFileSync(projectsIndexPath, "utf8") : undefined;
		const { ctx, notes } = makeCtx(carrierProject, { mode: "print" });
		await handleLoad(`${carrierSource} ${unmatchedSource}`, ctx);
		const text = notes.join("\n");
		assert.match(text, /Construct library updated \(library only\)/, text);
		assert.match(text, /Advisory Agent Skill inventory refreshed for 1 library entry/, text);
		assert.match(text, /Already Construct-managed here/, text);
		const catalog = JSON.parse(readFileSync(carrierPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: { skills: Array<{ root: string }> } }>; profiles?: Array<{ id: string }> };
		assert.deepEqual(catalog.items.find((item) => item.source === carrierSource)?.agentSkills?.skills.map((skill) => skill.root), ["mixed-skill"], JSON.stringify(catalog));
		assert(catalog.items.some((item) => item.source === unmatchedSource), JSON.stringify(catalog));
		assert.deepEqual(catalog.profiles?.map((profile) => profile.id), ["keep-recipe"], "unrelated catalog profile fields must be preserved");
		assert.equal(readFileSync(join(carrierProject, ".pi", "settings.json"), "utf8"), carrierSettings, "library-only fallback must not edit .pi/settings.json");
		assert.equal(readFileSync(join(carrierProject, ".pi", "construct.json"), "utf8"), carrierConstruct, "library-only fallback must not edit already-managed project metadata");
		assert.equal(existsSync(projectsIndexPath) ? readFileSync(projectsIndexPath, "utf8") : undefined, projectsIndexBefore, "library-only fallback must not record a known project");
	}

	// 12) Trust-boundary regression: once trust is lost after the idle wait, the write-time guard in
	// loadSourcesIntoConstruct latches a refusal that must stop later current-project advisory/direct
	// writes for a selected direct resource. Any independent unmatched explicit source in the same
	// request must still be remembered library-only, settings bytes must be preserved, and no known
	// project may be recorded. A first always-trusted pass measures which trust read is the first
	// post-wait write guard (the last read before .pi/construct.json exists); a second pass flips trust
	// exactly there.
	{
		const pkgSource = "git:github.com/example/trust-boundary-package";
		const unmatchedSource = "https://github.com/example/trust-boundary-unmatched";
		const seedBoundaryCatalog = (): void => {
			writeFileSync(paths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "trust-boundary-package", kind: "package", source: pkgSource }] }, null, 2) + "\n");
		};
		const setupBoundaryProject = async (name: string): Promise<{ project: string; settingsPath: string; settingsBefore: string; constructPath: string }> => {
			const boundaryProject = join(tmp, name);
			mkdirSync(join(boundaryProject, ".pi", "skills", "standalone"), { recursive: true });
			writeSkill(join(boundaryProject, ".pi", "skills", "standalone"), "standalone", "A direct project skill.");
			const settingsPath = join(boundaryProject, ".pi", "settings.json");
			const settingsBefore = JSON.stringify({ packages: [pkgSource] }, null, 2) + "\n";
			writeFileSync(settingsPath, settingsBefore);
			return { project: boundaryProject, settingsPath, settingsBefore, constructPath: join(boundaryProject, ".pi", "construct.json") };
		};
		const makeBoundaryCtx = (cwd: string, isProjectTrusted: () => boolean, notes: string[]): ExtensionCommandContext => ({
			cwd,
			mode: "print",
			hasUI: true,
			isIdle: () => false,
			isProjectTrusted,
			waitForIdle: async () => {},
			reload: async () => {},
			ui: { notify: (message: string) => { notes.push(message); }, setStatus: () => {} },
		} as unknown as ExtensionCommandContext);

		// Pass 1: always trusted. Record the call number of the last trust read while no project
		// Construct metadata exists yet, which is the metadata write's prewrite guard.
		seedBoundaryCatalog();
		const measure = await setupBoundaryProject("trust-boundary-measure");
		let calls = 0;
		const absentCalls: number[] = [];
		await handleLoad(`${pkgSource} skill:standalone ${unmatchedSource}`, makeBoundaryCtx(measure.project, () => {
			calls += 1;
			if (!existsSync(measure.constructPath)) absentCalls.push(calls);
			return true;
		}, []));
		assert(absentCalls.length > 0, "measurement pass expected trust reads before the first project write");
		const flipAt = absentCalls[absentCalls.length - 1]!;
		assert(flipAt < calls, "the first post-wait write guard must precede the final trust read");
		const measuredConstruct = JSON.parse(readFileSync(measure.constructPath, "utf8")) as { items: Record<string, { kind?: string }> };
		assert(Object.values(measuredConstruct.items).some((item) => item.kind === "skill"), `measurement pass must have adopted the selected direct resource: ${JSON.stringify(measuredConstruct)}`);
		assert(readCatalog(paths.userCatalogPath).items.some((item) => item.source === unmatchedSource), "measurement pass should remember the unmatched explicit source library-only");

		// Pass 2: trust flips exactly at that write guard, after the idle wait and recollect.
		seedBoundaryCatalog();
		const refuse = await setupBoundaryProject("trust-boundary-refuse");
		const projectsIndexPath = join(paths.constructDir, "projects.json");
		const projectsIndexBefore = existsSync(projectsIndexPath) ? readFileSync(projectsIndexPath, "utf8") : undefined;
		let flipCalls = 0;
		const notes: string[] = [];
		await handleLoad(`${pkgSource} skill:standalone ${unmatchedSource}`, makeBoundaryCtx(refuse.project, () => {
			flipCalls += 1;
			return flipCalls < flipAt;
		}, notes));
		const text = notes.join("\n");
		assert.equal(flipCalls, flipAt, "the write-time trust guard must be the last trust read once it refuses");
		assert.match(text, /not trusted by Pi|refused/i, text);
		assert.equal(existsSync(refuse.constructPath), false, "a latched refusal must not create project Construct metadata for the selected direct resource");
		assert.equal(readFileSync(refuse.settingsPath, "utf8"), refuse.settingsBefore, "settings bytes must be preserved after refusal");
		assert.equal(existsSync(projectsIndexPath) ? readFileSync(projectsIndexPath, "utf8") : undefined, projectsIndexBefore, "a refused run must not record a known project");
		assert(readCatalog(paths.userCatalogPath).items.some((item) => item.source === unmatchedSource), "the independent unmatched explicit source must still be remembered library-only");
		assert.match(text, /Construct library updated \(library only\)/, text);
	}

	console.log("load-concept smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
