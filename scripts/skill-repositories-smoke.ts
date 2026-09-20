// Coverage for adapting Agent Skills repositories that expose zero native Pi package resources.
// Uses a fake managed Git checkout at the path Pi's package manager resolves, real isolated
// settings writes, and the dashboard picker injection seam (no mocks of Pi internals).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { collectProjectInventory, withEffectivePackageStates } from "../extensions/construct/project-inventory.js";
import { collectProjectPackageResources, collectTemporaryPackageResourcesForSources, packageResourceMatches, type PackageResourceSummary } from "../extensions/construct/package-resources.js";
import { savedSourceDecision } from "../extensions/construct/effective-state.js";
import { removePackageFromProject } from "../extensions/construct/package-ops.js";
import { runConstructOperationSteps } from "../extensions/construct/operation-runner.js";
import { buildStatus } from "../extensions/construct/status.js";
import {
	catalogAgentSkillsInventory,
	removePackageSkillLinks,
	skillRepositoryState,
	togglePackageSkillRepositoryLinks,
	type PackageSkillRepository,
} from "../extensions/construct/skill-repositories.js";
import { handleDashboard, type DashboardPicker } from "../extensions/construct/commands/dashboard.js";
import { packageSubmitBlockedBySkillCarrier } from "../extensions/construct/picker-actions.js";
import { loadProjectResourcesIntoConstruct, handleLoad } from "../extensions/construct/commands/load.js";
import { handleSavedLoadoutCommand } from "../extensions/construct/commands/saved-loadouts.js";
import { addSourcesToCatalog } from "../extensions/construct/catalog.js";
import { getPaths } from "../extensions/construct/paths.js";
import { packageSourceMatchValues } from "../extensions/construct/sources.js";
import { createProjectPackageManager } from "../extensions/construct/pi-adapter/package-manager.js";
import type { CheckboxPickerItem, CheckboxPickerOptions } from "../extensions/construct/ui.js";

const fakePi = { getCommands: () => [], getAllTools: () => [], getActiveTools: () => [] } as unknown as ExtensionAPI;

function writeSkill(dir: string, name: string, description: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
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

interface Captured {
	items: CheckboxPickerItem[];
	options: CheckboxPickerOptions;
}

async function openDashboard(cwd: string): Promise<Captured> {
	let captured: Captured | undefined;
	const pick: DashboardPicker = async (_ctx, _title, items, options) => {
		captured = { items, options };
		return undefined;
	};
	await handleDashboard(undefined as never, makeCtx(cwd, () => true), pick);
	assert(captured, "dashboard did not reach the picker");
	return captured;
}

const tmp = mkdtempSync(join(tmpdir(), "construct-skill-repos-"));
process.env.HOME = join(tmp, "home");
mkdirSync(process.env.HOME, { recursive: true });

try {
	const project = join(tmp, "project");
	const settingsPath = join(project, ".pi", "settings.json");
	const source = "git:github.com/spf13/go-skills";
	const checkout = join(project, ".pi", "git", "github.com", "spf13", "go-skills");

	// A repo shaped like spf13/go-skills: a Claude Code marketplace with plugin roots that
	// each contain SKILL.md, plus a template skill that is deliberately not published.
	mkdirSync(join(checkout, ".claude-plugin"), { recursive: true });
	writeFileSync(
		join(checkout, ".claude-plugin", "marketplace.json"),
		JSON.stringify({ name: "go-skills", plugins: [{ name: "go-release", source: "./go-release" }, { name: "cobra-viper", source: "./cobra-viper" }] }, null, 2),
	);
	writeSkill(join(checkout, "go-release"), "go-release", "Release engineering for Go modules.");
	writeSkill(join(checkout, "cobra-viper"), "cobra-viper", "Idiomatic Go CLIs with Cobra and Viper.");
	writeSkill(join(checkout, "templates", "skill"), "template-skill", "Template skill that is not published.");

	mkdirSync(join(project, ".pi"), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify({ packages: [source] }, null, 2) + "\n");
	writeFileSync(
		join(project, ".pi", "construct.json"),
		JSON.stringify({ version: 1, managedBy: "the-construct", items: { "go-skills": { kind: "package", source, enabled: true } } }, null, 2) + "\n",
	);

	const ctx = makeCtx(project, () => true);
	const paths = await getPaths(ctx);

	// 1) Discovery: zero native package resources, marketplace roots only, all unlinked.
	const inventory = await collectProjectInventory(ctx);
	const resources = await collectProjectPackageResources(ctx, inventory);
	assert.equal(resources.resources.length, 0, "carrier must resolve zero native package resources");
	assert.equal(resources.skillRepositories.length, 1);
	const repository = resources.skillRepositories[0];
	assert(repository);
	assert.deepEqual(repository.skills.map((skill) => skill.name), ["cobra-viper", "go-release"]);
	assert.equal(repository.skills.some((skill) => skill.name === "template-skill"), false, "unpublished template must be excluded");
	assert.equal(skillRepositoryState(repository), "inactive", "unlinked carrier is Disabled/inactive, never unresolved");
	assert.equal(repository.skills.every((skill) => !skill.linked), true);

	// 2) Link a skill root through the project top-level skills array, with a backup.
	const link = await togglePackageSkillRepositoryLinks(paths, repository, new Set(["go-release"]), { projectTrusted: true });
	assert.equal(link.updated, true, link.reason);
	assert(link.backupPath && existsSync(link.backupPath), "settings backup missing");
	let settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills, ["git/github.com/spf13/go-skills/go-release"]);

	// 3) Re-read: the skill is linked, enabled, active, and appears as a direct project skill.
	const linkedInventory = await collectProjectInventory(ctx);
	const linkedResources = await collectProjectPackageResources(ctx, linkedInventory);
	const linkedRepository = linkedResources.skillRepositories[0];
	assert(linkedRepository);
	const goRelease = linkedRepository.skills.find((skill) => skill.name === "go-release");
	assert.equal(goRelease?.linked, true);
	assert.equal(goRelease?.enabled, true);
	assert.equal(skillRepositoryState(linkedRepository), "active");
	assert(linkedInventory.directResources.resources.some((resource) => resource.kind === "skill" && resource.name === "go-release" && resource.enabled));

	// 3a) Shared effective-state path: a linked carrier is Active for save/run planning, not unresolved.
	const effectiveInventory = withEffectivePackageStates(linkedInventory, linkedResources);
	const effectiveCarrier = effectiveInventory.managedPackages.find((item) => item.metadata.id === "go-skills");
	assert.equal(effectiveCarrier?.effectiveState, "active");
	assert.equal(savedSourceDecision({ section: "Disabled", wholePackageDisabled: false, effectiveState: effectiveCarrier?.effectiveState ?? "unknown" }), "active");

	// 3c) status full summarizes the carrier instead of only reporting zero package resources.
	const statusText = await buildStatus(fakePi, ctx, "full");
	assert.match(statusText, /Agent Skills repositories: 1/);
	assert.match(statusText, /go-skills: 2 found · 1 linked · 1 enabled · active/);
	assert.match(statusText, /skill go-release \(linked, enabled\)/);
	assert.match(statusText, /Carrier-managed skills hidden here: 1/);
	assert.match(statusText, /Direct project resources: 0/);
	assert.doesNotMatch(statusText, /skill go-release \(enabled, local, unloaded\)/);

	// 3b) Toggling one linked skill leaves unselected linked skills in their current form.
	await togglePackageSkillRepositoryLinks(paths, linkedRepository, new Set(["cobra-viper"]), { projectTrusted: true });
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills.slice().sort(), ["git/github.com/spf13/go-skills/cobra-viper", "git/github.com/spf13/go-skills/go-release"]);
	const toggleInventory = await collectProjectInventory(ctx);
	const toggleResources = await collectProjectPackageResources(ctx, toggleInventory);
	const toggleRepository = toggleResources.skillRepositories[0];
	assert(toggleRepository);
	const unlinkGoRelease = await togglePackageSkillRepositoryLinks(paths, toggleRepository, new Set(["go-release"]), { projectTrusted: true });
	assert.equal(unlinkGoRelease.updated, true, unlinkGoRelease.reason);
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills, ["git/github.com/spf13/go-skills/cobra-viper"]);

	// 4) A broader skill path covering the checkout is never silently rewritten.
	writeFileSync(settingsPath, JSON.stringify({ packages: [source], skills: ["git/github.com/spf13/go-skills"] }, null, 2) + "\n");
	const broadInventory = await collectProjectInventory(ctx);
	const broadResources = await collectProjectPackageResources(ctx, broadInventory);
	const broadRepository = broadResources.skillRepositories[0];
	assert(broadRepository);
	assert.equal(broadRepository.skills.every((skill) => skill.linked), true, "broad directory path should link every skill");
	const broadToggle = await togglePackageSkillRepositoryLinks(paths, broadRepository, new Set(["cobra-viper"]), { projectTrusted: true });
	assert.equal(broadToggle.updated, false);
	assert.match(broadToggle.reason ?? "", /broader skill path/);

	// 5) Untrusted projects refuse the write.
	const untrusted = await togglePackageSkillRepositoryLinks(paths, repository, new Set(["go-release"]), { projectTrusted: false });
	assert.equal(untrusted.updated, false);
	assert.match(untrusted.reason ?? "", /not trusted/);

	// 6) Removal clears entries under the managed checkout, including a broad package-root path.
	const removal = await removePackageSkillLinks(paths, source, { projectTrusted: true });
	assert.equal(removal.updated, true, removal.reason);
	assert.equal(removal.removed, 1);
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills ?? [], []);

	// 6b) Wildcard cleanup: carrier-owned globs are removed; broader ancestor globs refuse removal.
	writeFileSync(settingsPath, JSON.stringify({ packages: [source], skills: ["git/github.com/spf13/go-skills/**"] }, null, 2) + "\n");
	const carrierGlobRemoval = await removePackageSkillLinks(paths, source, { projectTrusted: true });
	assert.equal(carrierGlobRemoval.updated, true, carrierGlobRemoval.reason);
	assert.equal(carrierGlobRemoval.removed, 1);
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills ?? [], []);

	writeFileSync(settingsPath, JSON.stringify({ packages: [source], skills: ["git/**"] }, null, 2) + "\n");
	const broadGlobRemoval = await removePackageSkillLinks(paths, source, { projectTrusted: true });
	assert.equal(broadGlobRemoval.updated, false);
	assert.match(broadGlobRemoval.reason ?? "", /pi config -l/);
	const broadPatternRemoval = await removePackageFromProject(paths, { source, id: "go-skills" }, { projectTrusted: true });
	assert.equal(broadPatternRemoval.ok, false);
	assert.match(broadPatternRemoval.error ?? "", /pi config -l/);
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.packages, [source]);
	assert.deepEqual(settings.skills, ["git/**"]);

	// 6c) /construct load must not offer/adopt carrier-owned skills as direct resources, but a
	// genuinely independent direct skill stays adoptable.
	writeFileSync(settingsPath, JSON.stringify({ packages: [source] }, null, 2) + "\n");
	const loadInventory = await collectProjectInventory(ctx);
	const loadRepository = (await collectProjectPackageResources(ctx, loadInventory)).skillRepositories[0];
	assert(loadRepository);
	await togglePackageSkillRepositoryLinks(paths, loadRepository, new Set(["go-release"]), { projectTrusted: true });
	writeSkill(join(project, ".pi", "skills", "standalone"), "standalone", "An independent project skill.");
	const loadTrust = { ctx: { cwd: project, isProjectTrusted: () => true } };
	const carrierLoad = await loadProjectResourcesIntoConstruct(project, ["skill:go-release"], loadTrust);
	assert.equal(carrierLoad.directMetadataChanged, 0);
	assert(carrierLoad.warnings.some((warning) => /Not an unloaded project resource: skill:go-release/.test(warning)), JSON.stringify(carrierLoad.warnings));
	const standaloneLoad = await loadProjectResourcesIntoConstruct(project, ["skill:standalone"], loadTrust);
	assert.equal(standaloneLoad.directMetadataChanged, 1, JSON.stringify(standaloneLoad));
	let constructAfterLoad = JSON.parse(readFileSync(join(project, ".pi", "construct.json"), "utf8")) as { items: Record<string, { kind?: string; path?: string }> };
	assert.equal(Object.values(constructAfterLoad.items).some((item) => item.kind === "skill" && String(item.path ?? "").includes("go-skills/go-release")), false, "carrier skill must not be adopted as a direct resource");
	assert(Object.values(constructAfterLoad.items).some((item) => item.kind === "skill" && String(item.path ?? "").includes("standalone")), "independent direct skill should be adopted");
	// Simulate legacy duplicate adoption of the carrier skill that pre-fix load could have written.
	constructAfterLoad.items["legacy-carrier-skill"] = { kind: "skill", path: ".pi/git/github.com/spf13/go-skills/go-release/SKILL.md" };
	writeFileSync(join(project, ".pi", "construct.json"), JSON.stringify(constructAfterLoad, null, 2) + "\n");

	// 7) Dashboard: the unlinked declared carrier is Disabled (never Unresolved), collapsed, with
	// inline skill children, and a child submit links a root.
	writeFileSync(settingsPath, JSON.stringify({ packages: [source] }, null, 2) + "\n");
	const dashboard = await openDashboard(project);
	const carrier = dashboard.items.find((item) => !item.parentId && item.section === "Disabled" && item.expandable);
	assert(carrier, `no Disabled carrier row: ${JSON.stringify(dashboard.items.map((item) => [item.label, item.section, item.parentId]))}`);
	assert.equal(dashboard.items.some((item) => !item.parentId && item.section === "Unresolved"), false, "a discovered carrier must never be Unresolved");
	assert.equal(carrier.expandable, true, "Agent Skills carrier must stay inspectable through the shared package-child affordance");
	assert.notEqual(carrier.expandedByDefault, true, "carrier must start collapsed like ordinary package resource groups");
	assert.equal(carrier.aggregateChildIds?.length, 2, "carrier parent must aggregate its skill children for presets");
	assert.match(carrier.description ?? "", /no Agent Skills linked yet/);
	assert.match(carrier.description ?? "", /2 Agent Skills available · Right Arrow to review\./);
	assert.doesNotMatch(carrier.description ?? "", /Pi resource entries/);
	const children = dashboard.items.filter((item) => item.parentId === carrier.id);
	assert.deepEqual(children.map((child) => child.value), ["cobra-viper/", "go-release/"]);
	assert.equal(children.every((child) => child.stateText === "+"), true, "unlinked carrier skills are available/plus");
	assert.equal(dashboard.items.some((item) => !item.parentId && item.label === "skill:go-release"), false, "duplicate direct skill row must be hidden");

	const child = children.find((candidate) => candidate.value === "go-release/");
	assert(child);
	const confirmation = dashboard.options.submitConfirmation?.([child.id], "confirm", [child.id]);
	assert(confirmation, "missing Agent Skill confirmation");
	assert.match(confirmation.title, /Agent Skill links/);
	if (dashboard.options.onSubmit) {
		const applied = await dashboard.options.onSubmit([child.id], () => {}, new AbortController().signal, "confirm", [child.id]);
		assert.match(applied.title, /Agent Skill links applied/);
	}
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills, ["git/github.com/spf13/go-skills/go-release"]);

	// 7b) A genuine zero-resource declared package with no adapter stays Unresolved, and the
	// carrier whole-toggle guard only suppresses managed carriers.
	assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Disabled", true), true);
	assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Active", true), true);
	assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Available", true), false, "Available carrier parent Enter must still install");
	assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Available", false), false);
	const plainProject = join(tmp, "plain-zero-resource");
	const plainSource = "git:github.com/example/plain-zero";
	const plainCheckout = join(plainProject, ".pi", "git", "github.com", "example", "plain-zero");
	mkdirSync(join(plainCheckout, "docs"), { recursive: true });
	writeFileSync(join(plainCheckout, "README.md"), "# nothing to adapt\n");
	mkdirSync(join(plainProject, ".pi"), { recursive: true });
	writeFileSync(join(plainProject, ".pi", "settings.json"), JSON.stringify({ packages: [plainSource] }, null, 2) + "\n");
	writeFileSync(join(plainProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "plain-zero": { kind: "package", source: plainSource, enabled: true } } }, null, 2) + "\n");
	const plainDashboard = await openDashboard(plainProject);
	assert(plainDashboard.items.some((item) => !item.parentId && item.section === "Unresolved"), "genuine zero-resource package must stay Unresolved");
	assert.equal(plainDashboard.items.some((item) => !item.parentId && item.expandable), false, "no adapter means no fabricated children");

	// 7c) Available Agent Skills inventory is advisory-only (a validated catalog snapshot).
	// Construct never inspects a project checkout for an Available row: Pi's temporary resolver
	// and the project install path inspect different scopes, and native Pi resources always win.
	const availableProject = join(tmp, "available-carrier");
	const availableSource = "git:github.com/example/available-carrier";
	const rememberedSource = "git:github.com/example/remembered-carrier";
	const orphanNativeSource = "git:github.com/example/orphan-native";
	const unknownSource = "git:github.com/example/unknown-carrier";
	const availableCheckout = join(availableProject, ".pi", "git", "github.com", "example", "available-carrier");
	mkdirSync(join(availableCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(availableCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./alpha" }, { source: "./beta" }] }));
	writeSkill(join(availableCheckout, "alpha"), "alpha-skill", "Alpha skill.");
	writeSkill(join(availableCheckout, "beta"), "beta-skill", "Beta skill.");
	// (a) Orphan project checkout with a conventional native `skills/` dir must not be adapted
	// on an Available row.
	const orphanNativeCheckout = join(availableProject, ".pi", "git", "github.com", "example", "orphan-native");
	writeSkill(join(orphanNativeCheckout, "skills", "native-skill"), "native-skill", "Native skill under skills/.");
	mkdirSync(join(availableProject, ".pi"), { recursive: true });
	writeFileSync(join(availableProject, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	const availablePaths = await getPaths(makeCtx(availableProject, () => true));
	mkdirSync(join(availablePaths.constructDir), { recursive: true });
	// (b) Native temporary resources plus a stale snapshot: a local package with two native
	// skills and a remembered `phantom` skill that must never appear alongside real resources.
	const nativeLocalSource = join(availableProject, "native-local-package");
	writeSkill(join(nativeLocalSource, "skills", "native-a"), "native-a", "Native A.");
	writeSkill(join(nativeLocalSource, "skills", "native-b"), "native-b", "Native B.");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [
			{ id: "available-carrier", kind: "package", source: availableSource },
			{
				id: "remembered-carrier",
				kind: "package",
				source: rememberedSource,
				agentSkills: { skills: [{ name: "remembered-one", description: "Remembered skill.", root: "one" }] },
			},
			{ id: "orphan-native", kind: "package", source: orphanNativeSource },
			{
				id: "native-local",
				kind: "package",
				source: nativeLocalSource,
				agentSkills: { skills: [{ name: "phantom", description: "Stale snapshot skill.", root: "phantom" }] },
			},
			{
				id: "equiv-native",
				kind: "package",
				source: "https://github.com/example/equiv-native",
				agentSkills: { skills: [{ name: "equiv", description: "Equivalent-source snapshot.", root: "equiv" }] },
			},
			{ id: "unknown-carrier", kind: "package", source: unknownSource },
		],
	}, null, 2) + "\n");
	assert.equal(existsSync(availableCheckout), true);
	const availableDashboard = await openDashboard(availableProject);
	// (a) Existing project checkouts (including conventional native skills/) are never adapted.
	const availableCarrier = availableDashboard.items.find((item) => !item.parentId && item.label === "available-carrier");
	assert(availableCarrier, `no Available carrier row: ${JSON.stringify(availableDashboard.items.map((item) => [item.label, item.section]))}`);
	assert.notEqual(availableCarrier.expandable, true, "an orphan project checkout must not create Available Agent Skill children");
	const orphanNativeRow = availableDashboard.items.find((item) => !item.parentId && item.label === "orphan-native");
	assert(orphanNativeRow, "orphan-native Available row missing");
	assert.notEqual(orphanNativeRow.expandable, true, "a conventional native skills/ checkout must not be adapted on an Available row");
	// (b) Native temporary resources win over a stale snapshot; no phantom children.
	const nativeLocalRow = availableDashboard.items.find((item) => !item.parentId && item.label === "native-local");
	assert(nativeLocalRow, "native-local Available row missing");
	const nativeLocalChildren = availableDashboard.items.filter((item) => item.parentId === nativeLocalRow.id).map((item) => item.value);
	assert(nativeLocalChildren.length > 0, "native resources should surface their own cached children");
	assert.equal(nativeLocalChildren.some((value) => value.includes("phantom")), false, "stale snapshot children must not mix with native resources");
	assert.doesNotMatch(nativeLocalRow.description ?? "", /catalog or cached Agent Skill inventory|phantom/);
	// Equivalent source spellings resolve to the same canonical identity. The Available
	// suppression uses these canonical match values; verify the matcher catches an equivalent
	// resource spelling and not only an exact string.
	const equivRow = availableDashboard.items.find((item) => !item.parentId && item.label === "equiv-native");
	assert(equivRow?.expandable, "equiv-native snapshot should be shown when no native resource matches");
	const equivMatches = await packageSourceMatchValues("https://github.com/example/equiv-native", join(availableProject, ".pi"));
	assert(equivMatches.includes("git:github.com/example/equiv-native"), `match values must include the canonical identity: ${JSON.stringify(equivMatches)}`);
	const equivNativeResource: PackageResourceSummary = {
		packageSource: "github.com/example/equiv-native",
		packageIdentityKey: "git:github.com/example/equiv-native",
		packageManaged: false,
		kind: "skill",
		name: "equiv-native",
		path: "/x",
		packageRelativePath: "skills/equiv-native/SKILL.md",
		enabled: true,
	};
	assert.equal(packageResourceMatches(equivNativeResource, { matchSources: equivMatches }), true, "canonical match values must catch an equivalent source spelling");
	// Snapshot-only Available rows keep a read-only tree; never-inspected sources have none.
	const rememberedRow = availableDashboard.items.find((item) => !item.parentId && item.label === "remembered-carrier");
	assert(rememberedRow?.expandable, "remembered Available carrier must retain its tree without a checkout");
	assert.match(rememberedRow.description ?? "", /catalog or cached Agent Skill inventory/);
	const rememberedChildren = availableDashboard.items.filter((item) => item.parentId === rememberedRow.id);
	assert.deepEqual(rememberedChildren.map((item) => item.value), ["one/"]);
	assert.equal(rememberedChildren.every((item) => item.disabled === true), true);
	assert.equal(rememberedRow.disabled ?? false, false, "remembered Available carrier parent stays selectable for install");
	assert.equal(availableDashboard.options.submitConfirmation?.([rememberedRow.id], "confirm", []), undefined, "Available carrier parent must not be blocked by a child-plan confirmation");
	const unknownRow = availableDashboard.items.find((item) => !item.parentId && item.label === "unknown-carrier");
	assert(unknownRow, "unknown Available row missing");
	assert.notEqual(unknownRow.expandable, true, "never-inspected Available must not fabricate children");
	assert.match(unknownRow.description ?? "", /inventory becomes available after install/);

	// Explicit load captures only relative inventory in the catalog. After the declaration and
	// checkout disappear, the Available tree survives without package files or absolute paths.
	const snapshotProject = join(tmp, "snapshot-carrier");
	const snapshotSource = "git:github.com/example/snapshot-carrier";
	const snapshotCheckout = join(snapshotProject, ".pi", "git", "github.com", "example", "snapshot-carrier");
	mkdirSync(join(snapshotCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(snapshotCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./snap" }] }));
	writeSkill(join(snapshotCheckout, "snap"), "snapshot-skill", "Snapshot skill.");
	mkdirSync(join(snapshotProject, ".pi"), { recursive: true });
	writeFileSync(join(snapshotProject, ".pi", "settings.json"), JSON.stringify({ packages: [snapshotSource] }, null, 2) + "\n");
	const snapshotLoad = await loadProjectResourcesIntoConstruct(snapshotProject, [snapshotSource], { ctx: { cwd: snapshotProject, isProjectTrusted: () => true } });
	assert.equal(snapshotLoad.selectedSources, 1, JSON.stringify(snapshotLoad));
	const snapshotPaths = await getPaths(makeCtx(snapshotProject, () => true));
	const catalogAfterSnapshot = JSON.parse(readFileSync(snapshotPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: { skills: Array<{ root: string }> } }> };
	const snapshotCatalogItem = catalogAfterSnapshot.items.find((item) => item.source === snapshotSource);
	assert.deepEqual(snapshotCatalogItem?.agentSkills?.skills.map((skill) => skill.root), ["snap"]);
	assert.doesNotMatch(JSON.stringify(snapshotCatalogItem), new RegExp(snapshotProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "catalog snapshot must not contain checkout paths");
	writeFileSync(join(snapshotProject, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	writeFileSync(join(snapshotProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: {} }, null, 2) + "\n");
	rmSync(snapshotCheckout, { recursive: true, force: true });
	const snapshotDashboard = await openDashboard(snapshotProject);
	const snapshotRow = snapshotDashboard.items.find((item) => !item.parentId && item.label === "snapshot-carrier");
	assert(snapshotRow?.expandable, "catalog snapshot must preserve the Available tree after checkout removal");
	assert.deepEqual(snapshotDashboard.items.filter((item) => item.parentId === snapshotRow.id).map((item) => item.value), ["snap/"]);

	// Reopen after adopt/install: the source is now declared and Construct-managed, so it becomes
	// Disabled with editable skill children.
	writeFileSync(join(availableProject, ".pi", "settings.json"), JSON.stringify({ packages: [availableSource] }, null, 2) + "\n");
	writeFileSync(join(availableProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "available-carrier": { kind: "package", source: availableSource, enabled: true } } }, null, 2) + "\n");
	const declaredDashboard = await openDashboard(availableProject);
	const declaredCarrier = declaredDashboard.items.find((item) => !item.parentId && item.section === "Disabled" && item.expandable);
	assert(declaredCarrier, "declared carrier should be Disabled after install/reopen");
	const declaredChildren = declaredDashboard.items.filter((item) => item.parentId === declaredCarrier.id);
	assert.deepEqual(declaredChildren.map((child) => child.value), ["alpha/", "beta/"]);
	assert.equal(declaredChildren.every((child) => child.disabled !== true), true, "declared carrier children must be editable");
	assert(declaredDashboard.options.onSubmit);
	const removeCarrier = await declaredDashboard.options.onSubmit([declaredCarrier.id], () => {}, new AbortController().signal, "remove", []);
	assert.match(removeCarrier.title, /changes applied/);
	const catalogAfterRemoval = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: { skills: Array<{ root: string }> } }> };
	assert.deepEqual(catalogAfterRemoval.items.find((item) => item.source === availableSource)?.agentSkills?.skills.map((skill) => skill.root), ["alpha", "beta"], "dashboard removal must preserve relative carrier inventory");
	rmSync(availableCheckout, { recursive: true, force: true });
	const removedDashboard = await openDashboard(availableProject);
	const removedAvailableCarrier = removedDashboard.items.find((item) => !item.parentId && item.label === "available-carrier");
	assert(removedAvailableCarrier?.expandable, "removed carrier must remain expandable as Available without its checkout");

	// 7c-2) Dashboard removal never creates a new global catalog entry for an uncataloged carrier.
	const uncatalogedProject = join(tmp, "uncataloged-carrier");
	const uncatalogedSource = "git:github.com/example/uncataloged-carrier";
	const uncatalogedCheckout = join(uncatalogedProject, ".pi", "git", "github.com", "example", "uncataloged-carrier");
	writeSkill(join(uncatalogedCheckout, "only"), "only-skill", "Only skill.");
	mkdirSync(join(uncatalogedProject, ".pi"), { recursive: true });
	writeFileSync(join(uncatalogedProject, ".pi", "settings.json"), JSON.stringify({ packages: [uncatalogedSource] }, null, 2) + "\n");
	writeFileSync(join(uncatalogedProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "uncataloged-carrier": { kind: "package", source: uncatalogedSource, enabled: true } } }, null, 2) + "\n");
	const uncatalogedPaths = await getPaths(makeCtx(uncatalogedProject, () => true));
	assert.equal(JSON.parse(readFileSync(uncatalogedPaths.userCatalogPath, "utf8")).items.some((item: { source: string }) => item.source === uncatalogedSource), false);
	const uncatalogedDashboard = await openDashboard(uncatalogedProject);
	const uncatalogedCarrier = uncatalogedDashboard.items.find((item) => !item.parentId && item.section === "Disabled" && item.expandable);
	assert(uncatalogedCarrier, "uncataloged declared carrier should be Disabled");
	assert(uncatalogedDashboard.options.onSubmit);
	const uncatalogedRemoval = await uncatalogedDashboard.options.onSubmit([uncatalogedCarrier.id], () => {}, new AbortController().signal, "remove", []);
	assert.match(uncatalogedRemoval.title, /removed|applied/i);
	const catalogAfterUncataloged = JSON.parse(readFileSync(uncatalogedPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string }> };
	assert.equal(catalogAfterUncataloged.items.some((item) => item.source === uncatalogedSource), false, "removal must not create a new global catalog entry");

	// 7d) Pi-resolved native resources are the only gate: the temporary resolver surfaces native
	// resources and never returns adapted Agent Skills repositories.
	const nativeProject = join(tmp, "native-resources");
	mkdirSync(join(nativeProject, ".pi"), { recursive: true });
	writeFileSync(join(nativeProject, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	const nativeSource = join(nativeProject, "native-package");
	writeSkill(join(nativeSource, "skills", "native-skill"), "native-skill", "A native Pi skill resource.");
	const nativeCtx = makeCtx(nativeProject, () => true);
	const nativeInventory = await collectProjectInventory(nativeCtx);
	const nativeTemporary = await collectTemporaryPackageResourcesForSources(nativeCtx, nativeInventory, [nativeSource], { cacheOnly: true });
	assert(nativeTemporary.resources.length > 0, "local native package must resolve native resources");
	assert.equal(nativeTemporary.skillRepositories.length, 0, "native resolved resources must suppress temporary adapter discovery");

	// 7e) Saved-loadout run planning gives discovered carriers a carrier-specific skip message
	// instead of the misleading generic all-off Pi filters wording (recipes stay source-only).
	const runProject = join(tmp, "run-carrier");
	const runSource = "git:github.com/example/run-carrier";
	const runCheckout = join(runProject, ".pi", "git", "github.com", "example", "run-carrier");
	mkdirSync(join(runCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(runCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./one" }] }));
	writeSkill(join(runCheckout, "one"), "run-skill", "A run carrier skill.");
	mkdirSync(join(runProject, ".pi"), { recursive: true });
	writeFileSync(join(runProject, ".pi", "settings.json"), JSON.stringify({ packages: [runSource] }, null, 2) + "\n");
	writeFileSync(join(runProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "run-carrier": { kind: "package", source: runSource, enabled: true } } }, null, 2) + "\n");
	const runPaths = await getPaths(makeCtx(runProject, () => true));
	writeFileSync(runPaths.userCatalogPath, JSON.stringify({ version: 1, items: [], profiles: [{ id: "carrier-recipe", kind: "profile", sources: [runSource] }] }, null, 2) + "\n");
	const captured: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => { captured.push(args.map((value) => String(value)).join(" ")); };
	try {
		await handleSavedLoadoutCommand(fakePi, "run carrier-recipe", { ...makeCtx(runProject, () => true), mode: "print", hasUI: false } as unknown as ExtensionCommandContext);
	} finally {
		console.log = originalLog;
	}
	const runOutput = captured.join("\n");
	assert.match(runOutput, /Agent Skills are not active in this project/);
	assert.doesNotMatch(runOutput, /all resolved resources are off/, "carrier skip must not use the generic Pi-filters message");

	// 7e-2) Unadopted (unloaded) carrier: run/save give Agent Skills guidance (not generic pi
	// config wording) and it is not double-counted as an unresolved declaration.
	const unloadedRunProject = join(tmp, "unloaded-run-carrier");
	const unloadedRunSource = "git:github.com/example/unloaded-run-carrier";
	const unloadedRunCheckout = join(unloadedRunProject, ".pi", "git", "github.com", "example", "unloaded-run-carrier");
	mkdirSync(join(unloadedRunCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(unloadedRunCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./uno" }] }));
	writeSkill(join(unloadedRunCheckout, "uno"), "uno-skill", "Uno skill.");
	mkdirSync(join(unloadedRunProject, ".pi"), { recursive: true });
	// Declared but deliberately NOT in .pi/construct.json (unloaded/unadopted).
	writeFileSync(join(unloadedRunProject, ".pi", "settings.json"), JSON.stringify({ packages: [unloadedRunSource] }, null, 2) + "\n");
	const unloadedRunPaths = await getPaths(makeCtx(unloadedRunProject, () => true));
	writeFileSync(unloadedRunPaths.userCatalogPath, JSON.stringify({ version: 1, items: [], profiles: [{ id: "unloaded-recipe", kind: "profile", sources: [unloadedRunSource] }] }, null, 2) + "\n");
	const unloadedCaptured: string[] = [];
	console.log = (...args: unknown[]) => { unloadedCaptured.push(args.map((value) => String(value)).join(" ")); };
	try {
		await handleSavedLoadoutCommand(fakePi, "run unloaded-recipe", { ...makeCtx(unloadedRunProject, () => true), mode: "print", hasUI: false } as unknown as ExtensionCommandContext);
		await handleSavedLoadoutCommand(fakePi, "save unloaded-recipe", { ...makeCtx(unloadedRunProject, () => true), mode: "print", hasUI: false } as unknown as ExtensionCommandContext);
	} finally {
		console.log = originalLog;
	}
	const unloadedOutput = unloadedCaptured.join("\n");
	assert.match(unloadedOutput, /Agent Skills are not active in this project/, "unloaded carrier run must use Agent Skills guidance");
	assert.doesNotMatch(unloadedOutput, /inspect the declaration with pi config -l/, "unloaded carrier must not use generic unresolved wording");
	assert.match(unloadedOutput, /Declared Agent Skills carriers not linked\/enabled: 1/);
	assert.doesNotMatch(unloadedOutput, /Declared packages with no resolved resources/, "unloaded carrier must not be double-counted as unresolved");

	// 8) Dashboard removal: whole-package-disabled filters do not hide active linked skills, and
	// the confirmation names linked skills while removal clears both the links and the declaration.
	writeFileSync(
		settingsPath,
		JSON.stringify({ packages: [{ source, extensions: [], skills: [], prompts: [], themes: [] }], skills: ["git/github.com/spf13/go-skills/go-release"] }, null, 2) + "\n",
	);
	const removalDashboard = await openDashboard(project);
	const removalCarrier = removalDashboard.items.find((item) => !item.parentId && item.section === "Active" && item.expandable);
	assert(removalCarrier, "carrier should be Active after linking even with whole-package-disabled filters");
	assert.notEqual(removalCarrier.expandedByDefault, true, "Active carrier must also start collapsed");
	assert.match(removalCarrier.description ?? "", /linked project skill paths are active/);
	assert.doesNotMatch(removalCarrier.description ?? "", /Enter disables the whole package/);
	const removalChildren = removalDashboard.items.filter((item) => item.parentId === removalCarrier.id);
	assert.equal(removalChildren.find((item) => item.value === "go-release/")?.stateText, "✓");
	const removeConfirmation = removalDashboard.options.removeConfirmation?.([removalCarrier.id]);
	assert(removeConfirmation);
	assert(removeConfirmation.lines.some((line) => /Agent Skill path/.test(line)), "removal must warn about linked Agent Skill paths");
	if (removalDashboard.options.onSubmit) {
		const removed = await removalDashboard.options.onSubmit([removalCarrier.id], () => {}, new AbortController().signal, "remove", []);
		assert.match(removed.title, /removed|applied/i);
	}
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.skills ?? [], []);
	assert.deepEqual(settings.packages ?? [], []);
	// 8b) Carrier removal prunes legacy duplicate direct skill metadata under the checkout but
	// preserves unrelated direct metadata and never deletes files.
	const constructAfterRemoval = JSON.parse(readFileSync(join(project, ".pi", "construct.json"), "utf8")) as { items: Record<string, { kind?: string; path?: string }> };
	const removalItems = Object.entries(constructAfterRemoval.items);
	assert.equal(removalItems.some(([id]) => id === "legacy-carrier-skill"), false, "legacy carrier direct metadata must be pruned");
	assert.equal(removalItems.some(([, item]) => item.kind === "package"), false, "carrier package metadata must be removed");
	assert(removalItems.some(([, item]) => item.kind === "skill" && String(item.path ?? "").includes("standalone")), "unrelated direct skill metadata must survive");
	assert(existsSync(join(project, ".pi", "skills", "standalone", "SKILL.md")), "metadata pruning must not delete files");

	// 9) A package whose root itself contains SKILL.md adapts with packageRelativeRoot ".".
	const rootProject = join(tmp, "root-carrier");
	const rootSettingsPath = join(rootProject, ".pi", "settings.json");
	const rootSource = "git:github.com/example/root-skill";
	const rootCheckout = join(rootProject, ".pi", "git", "github.com", "example", "root-skill");
	writeSkill(rootCheckout, "root-skill", "A skill at the package root.");
	mkdirSync(join(rootProject, ".pi"), { recursive: true });
	writeFileSync(rootSettingsPath, JSON.stringify({ packages: [rootSource] }, null, 2) + "\n");
	writeFileSync(join(rootProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "root-skill": { kind: "package", source: rootSource, enabled: true } } }, null, 2) + "\n");
	const rootCtx = makeCtx(rootProject, () => true);
	const rootPaths = await getPaths(rootCtx);
	const rootResources = await collectProjectPackageResources(rootCtx, await collectProjectInventory(rootCtx));
	assert.equal(rootResources.skillRepositories.length, 1);
	const rootRepository = rootResources.skillRepositories[0];
	assert(rootRepository);
	assert.equal(rootRepository.skills.length, 1);
	assert.equal(rootRepository.skills[0].packageRelativeRoot, ".");
	assert.equal(rootRepository.skills[0].packageRelativeFile, "SKILL.md");
	assert.equal(rootRepository.skills[0].settingsPath, "git/github.com/example/root-skill");
	const rootLink = await togglePackageSkillRepositoryLinks(rootPaths, rootRepository, new Set(["."]), { projectTrusted: true });
	assert.equal(rootLink.updated, true, rootLink.reason);
	assert.deepEqual(JSON.parse(readFileSync(rootSettingsPath, "utf8")).skills, ["git/github.com/example/root-skill"]);
	const rootDashboard = await openDashboard(rootProject);
	const rootCarrier = rootDashboard.items.find((item) => !item.parentId && item.section === "Active" && item.expandable);
	assert(rootCarrier, "single-skill carrier must stay inspectable through the shared child affordance");
	assert.notEqual(rootCarrier.expandedByDefault, true, "single-skill carrier must also start collapsed");
	assert.match(rootCarrier.description ?? "", /1 Agent Skill available · Right Arrow to review\./);
	const rootChildren = rootDashboard.items.filter((item) => item.parentId === rootCarrier.id);
	assert.deepEqual(rootChildren.map((child) => child.value), ["./"]);
	assert.equal(rootChildren[0]?.stateText, "✓", "linked+enabled carrier skill is active/check");
	const rootRemoval = await removePackageSkillLinks(rootPaths, rootSource, { projectTrusted: true });
	assert.equal(rootRemoval.updated, true, rootRemoval.reason);
	assert.equal(rootRemoval.removed, 1);

	// 10) A malformed marketplace manifest refuses the adapter instead of publishing every SKILL.md.
	const badProject = join(tmp, "bad-marketplace");
	const badSource = "git:github.com/example/bad-marketplace";
	const badCheckout = join(badProject, ".pi", "git", "github.com", "example", "bad-marketplace");
	mkdirSync(join(badCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(badCheckout, ".claude-plugin", "marketplace.json"), "{ not valid json");
	writeSkill(join(badCheckout, "published"), "published-skill", "A published plugin skill.");
	writeSkill(join(badCheckout, "templates", "skill"), "template-skill", "A template skill that must not be published.");
	mkdirSync(join(badProject, ".pi"), { recursive: true });
	writeFileSync(join(badProject, ".pi", "settings.json"), JSON.stringify({ packages: [badSource] }, null, 2) + "\n");
	writeFileSync(join(badProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "bad-marketplace": { kind: "package", source: badSource, enabled: true } } }, null, 2) + "\n");
	const badCtx = makeCtx(badProject, () => true);
	const badResources = await collectProjectPackageResources(badCtx, await collectProjectInventory(badCtx));
	assert.equal(badResources.skillRepositories.length, 0, "malformed marketplace must not fall back to native discovery");
	assert(badResources.warnings.some((warning) => /marketplace\.json could not be parsed/.test(warning)), JSON.stringify(badResources.warnings));
	writeFileSync(join(badCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "no-plugins" }));
	const badStructuralResources = await collectProjectPackageResources(badCtx, await collectProjectInventory(badCtx));
	assert.equal(badStructuralResources.skillRepositories.length, 0);
	assert(badStructuralResources.warnings.some((warning) => /not a plugin marketplace/.test(warning)), JSON.stringify(badStructuralResources.warnings));

	// 11) Partial removal honesty: skill links are removed, then declaration removal fails.
	const partialProject = join(tmp, "partial-removal");
	const partialSource = "git:github.com/example/partial";
	const partialCheckout = join(partialProject, ".pi", "git", "github.com", "example", "partial");
	writeSkill(join(partialCheckout, "partial-skill"), "partial-skill", "A skill that gets linked.");
	mkdirSync(join(partialProject, ".pi"), { recursive: true });
	writeFileSync(join(partialProject, ".pi", "settings.json"), JSON.stringify({ packages: [partialSource], skills: ["git/github.com/example/partial/partial-skill"] }, null, 2) + "\n");
	writeFileSync(join(partialProject, ".pi", "construct.json"), "{ this is not valid json");
	const partialCtx = makeCtx(partialProject, () => true);
	const partialPaths = await getPaths(partialCtx);
	const partialResult = await removePackageFromProject(partialPaths, { source: partialSource, id: "partial" }, { projectTrusted: true });
	assert.equal(partialResult.ok, false);
	assert.equal(partialResult.removedSkillLinks, 1);
	assert.equal(partialResult.changedProjectSettings, true);
	assert.equal(partialResult.needsReload, true);
	assert.equal(partialResult.metadataOnlyFailure, true);
	const partialSettings = JSON.parse(readFileSync(join(partialProject, ".pi", "settings.json"), "utf8"));
	assert.deepEqual(partialSettings.skills ?? [], []);
	assert.deepEqual(partialSettings.packages ?? [], []);

	// 11b) The operation runner reports that failure as a partial runtime change so the dashboard offers reload.
	const runnerProject = join(tmp, "partial-runner");
	const runnerSource = "git:github.com/example/partial-runner";
	const runnerCheckout = join(runnerProject, ".pi", "git", "github.com", "example", "partial-runner");
	writeSkill(join(runnerCheckout, "runner-skill"), "runner-skill", "A skill that gets linked.");
	mkdirSync(join(runnerProject, ".pi"), { recursive: true });
	writeFileSync(join(runnerProject, ".pi", "settings.json"), JSON.stringify({ packages: [runnerSource], skills: ["git/github.com/example/partial-runner/runner-skill"] }, null, 2) + "\n");
	writeFileSync(join(runnerProject, ".pi", "construct.json"), "{ this is not valid json");
	const runnerCtx = makeCtx(runnerProject, () => true);
	const runnerPaths = await getPaths(runnerCtx);
	const outcome = await runConstructOperationSteps({
		ctx: runnerCtx,
		paths: runnerPaths,
		steps: [{ action: "Remove", item: { id: "partial-runner", label: "partial-runner", source: runnerSource, displaySource: runnerSource }, state: "pending" }],
		progressTitle: "Test partial removal",
		completeLabel: "changes",
	});
	assert.equal(outcome.partialRuntimeChanges.length, 1, JSON.stringify(outcome));
	assert.equal(outcome.failures.length, 0);
	assert.equal(outcome.needsReload, true);

	// 12) Advisory snapshot parsing is bounded and canonical: oversized inventories and entries
	// are rejected, roots are canonicalized before validation, duplicate roots reject the snapshot,
	// and unknown inventory/per-skill fields are dropped.
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [
			{ id: "too-many", kind: "package", source: "git:github.com/example/too-many", agentSkills: { skills: Array.from({ length: 65 }, (_, index) => ({ name: `s-${index}`, description: "d", root: `r${index}` })) } },
			{ id: "oversized", kind: "package", source: "git:github.com/example/oversized", agentSkills: { skills: [{ name: "n".repeat(65), description: "d", root: "r" }, { name: "ok", description: "d".repeat(1025), root: "r" }, { name: "ok2", description: "d", root: "x".repeat(513) }] } },
			{ id: "whitespace-absolute", kind: "package", source: "git:github.com/example/ws-abs", agentSkills: { skills: [{ name: "ws", description: "d", root: " /etc" }] } },
			{ id: "drive-absolute", kind: "package", source: "git:github.com/example/drive", agentSkills: { skills: [{ name: "drive", description: "d", root: "C:\\skills" }] } },
			{ id: "backslash", kind: "package", source: "git:github.com/example/bs", agentSkills: { skills: [{ name: "bs", description: "d", root: "a\\b" }] } },
			{ id: "dotdot", kind: "package", source: "git:github.com/example/dd", agentSkills: { skills: [{ name: "dd", description: "d", root: "a/../b" }] } },
			{ id: "duplicate", kind: "package", source: "git:github.com/example/dup", agentSkills: { skills: [{ name: "one", description: "d", root: "same" }, { name: "two", description: "d", root: "same" }] } },
			{ id: "extra", kind: "package", source: "git:github.com/example/extra", agentSkills: { secret: "leak", skills: [{ name: "extra-skill", description: "Extra.", root: "extra", absoluteRoot: "/etc", enabled: true }] } },
		],
	}, null, 2) + "\n");
	const mixedInventory = await collectProjectInventory(makeCtx(availableProject, () => true));
	const mixedWarnings = mixedInventory.catalog.warnings.join("\n");
	assert.match(mixedWarnings, /Catalog item too-many agentSkills has 65 entries \(max 64\)/);
	assert.match(mixedWarnings, /Catalog item oversized agentSkills entry 0 is invalid/);
	assert.match(mixedWarnings, /Catalog item whitespace-absolute agentSkills entry 0 is invalid/);
	assert.match(mixedWarnings, /Catalog item drive-absolute agentSkills entry 0 is invalid/);
	assert.match(mixedWarnings, /Catalog item backslash agentSkills entry 0 is invalid/);
	assert.match(mixedWarnings, /Catalog item dotdot agentSkills entry 0 is invalid/);
	assert.match(mixedWarnings, /Catalog item duplicate agentSkills entry 1 repeats root same/);
	const mixedById = new Map(mixedInventory.catalog.data.items.map((item) => [item.id, item]));
	assert.equal(mixedById.get("whitespace-absolute")?.agentSkills, undefined, "whitespace-prefixed absolute root must not survive as an absolute root");
	assert.equal(mixedById.get("duplicate")?.agentSkills, undefined, "duplicate canonical roots must reject the snapshot");
	const extraItem = mixedById.get("extra");
	assert(extraItem?.agentSkills);
	assert.deepEqual(extraItem.agentSkills.skills, [{ name: "extra-skill", description: "Extra.", root: "extra" }]);
	const extraSnapshotJson = JSON.stringify(extraItem.agentSkills);
	assert.equal(extraSnapshotJson.includes("absoluteRoot") || extraSnapshotJson.includes("secret") || extraSnapshotJson.includes("enabled"), false, "unknown snapshot fields must be dropped");

	// 12b) Writer-side bound: a discovered carrier with 65 valid skills records no advisory
	// snapshot (it must never emit parser-invalid catalog data) and surfaces a warning.
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
	const bigProject = join(tmp, "big-carrier");
	const bigSource = "git:github.com/example/big-carrier";
	const bigCheckout = join(bigProject, ".pi", "git", "github.com", "example", "big-carrier");
	for (let index = 0; index < 65; index += 1) writeSkill(join(bigCheckout, `p${index}`), `big-skill-${index}`, `Big skill ${index}.`);
	mkdirSync(join(bigProject, ".pi"), { recursive: true });
	writeFileSync(join(bigProject, ".pi", "settings.json"), JSON.stringify({ packages: [bigSource] }, null, 2) + "\n");
	const bigLoad = await loadProjectResourcesIntoConstruct(bigProject, [bigSource], { ctx: { cwd: bigProject, isProjectTrusted: () => true } });
	assert.equal(bigLoad.selectedSources, 1, JSON.stringify(bigLoad));
	assert(bigLoad.warnings.some((warning) => /could not be recorded \(too many, duplicate, or invalid skill roots\)/.test(warning)), JSON.stringify(bigLoad.warnings));
	const bigPaths = await getPaths(makeCtx(bigProject, () => true));
	const bigCatalog = JSON.parse(readFileSync(bigPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(bigCatalog.items.find((item) => item.source === bigSource)?.agentSkills, undefined, "oversized carrier must not write a parser-invalid snapshot");
	// Writer also refuses duplicate canonical roots rather than emitting ambiguous rows.
	const duplicateRepository: PackageSkillRepository = { source: bigSource, diagnostics: [], skills: [{ name: "one", description: "d", packageRelativeRoot: "same", packageRelativeFile: "same/SKILL.md", linked: false, enabled: false }, { name: "two", description: "d", packageRelativeRoot: "same", packageRelativeFile: "same/SKILL.md", linked: false, enabled: false }] };
	assert.equal(catalogAgentSkillsInventory(duplicateRepository), undefined, "writer must not emit duplicate canonical roots");

	// 13) Authoritative /construct load clears a stale advisory snapshot when the declaration is
	// currently a native/non-carrier, preserving unrelated entries and no-opinion adds.
	const nativeLoadProject = join(tmp, "native-load-clear");
	const nativeLoadSource = "git:github.com/example/native-load-clear";
	const unrelatedSource = "git:github.com/example/unrelated-snapshot";
	const nativeLoadCheckout = join(nativeLoadProject, ".pi", "git", "github.com", "example", "native-load-clear");
	writeSkill(join(nativeLoadCheckout, "skills", "native-load-skill"), "native-load-skill", "Native load skill.");
	mkdirSync(join(nativeLoadProject, ".pi"), { recursive: true });
	writeFileSync(join(nativeLoadProject, ".pi", "settings.json"), JSON.stringify({ packages: [nativeLoadSource] }, null, 2) + "\n");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [
			{ id: "native-load-clear", kind: "package", source: nativeLoadSource, agentSkills: { skills: [{ name: "stale", description: "Stale.", root: "stale" }] } },
			{ id: "unrelated-snapshot", kind: "package", source: unrelatedSource, agentSkills: { skills: [{ name: "keep", description: "Keep.", root: "keep" }] } },
		],
	}, null, 2) + "\n");
	const nativeLoadResult = await loadProjectResourcesIntoConstruct(nativeLoadProject, [nativeLoadSource], { ctx: { cwd: nativeLoadProject, isProjectTrusted: () => true } });
	assert.equal(nativeLoadResult.selectedSources, 1, JSON.stringify(nativeLoadResult));
	const catalogAfterNativeLoad = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(catalogAfterNativeLoad.items.find((item) => item.source === nativeLoadSource)?.agentSkills, undefined, "stale snapshot must be cleared for a currently native declaration");
	assert(catalogAfterNativeLoad.items.find((item) => item.source === unrelatedSource)?.agentSkills !== undefined, "unrelated snapshots must be preserved");
	// No-opinion add (saved-loadout/import flow) preserves existing snapshots.
	await addSourcesToCatalog(makeCtx(nativeLoadProject, () => true), [unrelatedSource]);
	const catalogAfterNoOpinionAdd = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert(catalogAfterNoOpinionAdd.items.find((item) => item.source === unrelatedSource)?.agentSkills !== undefined, "no-opinion add must preserve snapshots");
	// After checkout removal the cleared source must not regain an Agent Skills arrow.
	rmSync(nativeLoadCheckout, { recursive: true, force: true });
	const nativeLoadDashboard = await openDashboard(nativeLoadProject);
	const nativeLoadRow = nativeLoadDashboard.items.find((item) => !item.parentId && item.label === "native-load-clear");
	assert(nativeLoadRow, "native-load-clear row missing");
	assert.notEqual(nativeLoadRow.expandable, true, "cleared native source must not show an Agent Skills arrow");
	assert.equal(nativeLoadDashboard.items.filter((item) => item.parentId === nativeLoadRow.id).some((child) => child.value === "stale/"), false, "cleared snapshot must not resurface");

	// 14) Successful dashboard removal of a currently native/non-carrier package clears its stale
	// advisory snapshot on the existing catalog entry only.
	const nativeRemoveProject = join(tmp, "native-remove-clear");
	const nativeRemoveSource = "git:github.com/example/native-remove-clear";
	const nativeRemoveCheckout = join(nativeRemoveProject, ".pi", "git", "github.com", "example", "native-remove-clear");
	writeSkill(join(nativeRemoveCheckout, "skills", "native-remove-skill"), "native-remove-skill", "Native remove skill.");
	mkdirSync(join(nativeRemoveProject, ".pi"), { recursive: true });
	writeFileSync(join(nativeRemoveProject, ".pi", "settings.json"), JSON.stringify({ packages: [nativeRemoveSource] }, null, 2) + "\n");
	writeFileSync(join(nativeRemoveProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "native-remove-clear": { kind: "package", source: nativeRemoveSource, enabled: true } } }, null, 2) + "\n");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [{ id: "native-remove-clear", kind: "package", source: nativeRemoveSource, agentSkills: { skills: [{ name: "stale", description: "Stale.", root: "stale" }] } }],
	}, null, 2) + "\n");
	const nativeRemoveDashboard = await openDashboard(nativeRemoveProject);
	const nativeRemoveRow = nativeRemoveDashboard.items.find((item) => !item.parentId && item.section === "Active");
	assert(nativeRemoveRow, `native remove row missing: ${JSON.stringify(nativeRemoveDashboard.items.map((item) => [item.label, item.section, item.value]))}`);
	assert(nativeRemoveDashboard.options.onSubmit);
	const nativeRemoveResult = await nativeRemoveDashboard.options.onSubmit([nativeRemoveRow.id], () => {}, new AbortController().signal, "remove", []);
	assert.match(nativeRemoveResult.title, /removed|applied/i);
	const catalogAfterNativeRemove = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(catalogAfterNativeRemove.items.find((item) => item.source === nativeRemoveSource)?.agentSkills, undefined, "stale snapshot must be cleared on native package removal");
	rmSync(nativeRemoveCheckout, { recursive: true, force: true });
	const nativeRemoveDashboard2 = await openDashboard(nativeRemoveProject);
	const nativeRemoveRow2 = nativeRemoveDashboard2.items.find((item) => !item.parentId && item.label === "native-remove-clear");
	if (nativeRemoveRow2) assert.notEqual(nativeRemoveRow2.expandable, true, "cleared snapshot must not resurface after removal");
	assert.equal(nativeRemoveDashboard2.items.some((item) => item.value === "stale/"), false, "cleared snapshot must not resurface after removal");

	// 15) Uninspected sources (no checkout / resolver failure) are no opinion: /construct load and
	// removal must preserve the existing snapshot rather than clearing it.
	const uninspectedProject = join(tmp, "uninspected-clear");
	const uninspectedSource = "git:github.com/example/uninspected-clear";
	mkdirSync(join(uninspectedProject, ".pi"), { recursive: true });
	writeFileSync(join(uninspectedProject, ".pi", "settings.json"), JSON.stringify({ packages: [uninspectedSource] }, null, 2) + "\n");
	// No construct.json yet, so /construct load treats it as adoptable, and no checkout exists at
	// .pi/git/... so discovery cannot inspect it (no opinion).
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [{ id: "uninspected-clear", kind: "package", source: uninspectedSource, agentSkills: { skills: [{ name: "keep", description: "Keep.", root: "keep" }] } }],
	}, null, 2) + "\n");
	const uninspectedLoad = await loadProjectResourcesIntoConstruct(uninspectedProject, [uninspectedSource], { ctx: { cwd: uninspectedProject, isProjectTrusted: () => true } });
	assert.equal(uninspectedLoad.selectedSources, 1, JSON.stringify(uninspectedLoad));
	assert(uninspectedLoad.warnings.some((warning) => /checkout could not be inspected/.test(warning)), JSON.stringify(uninspectedLoad.warnings));
	const catalogAfterUninspectedLoad = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert(catalogAfterUninspectedLoad.items.find((item) => item.source === uninspectedSource)?.agentSkills !== undefined, "uninspected load must preserve the snapshot");
	// Removal of the unresolved/no-checkout row must also preserve it.
	const uninspectedDashboard = await openDashboard(uninspectedProject);
	const uninspectedRow = uninspectedDashboard.items.find((item) => !item.parentId && item.section === "Unresolved");
	assert(uninspectedRow, `uninspected row missing: ${JSON.stringify(uninspectedDashboard.items.map((item) => [item.label, item.section]))}`);
	assert(uninspectedDashboard.options.onSubmit);
	const uninspectedRemoval = await uninspectedDashboard.options.onSubmit([uninspectedRow.id], () => {}, new AbortController().signal, "remove", []);
	assert.match(uninspectedRemoval.title, /removed|applied/i);
	const catalogAfterUninspectedRemoval = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert(catalogAfterUninspectedRemoval.items.find((item) => item.source === uninspectedSource)?.agentSkills !== undefined, "uninspected removal must preserve the snapshot");

	// 16) A successfully inspected checkout with no adapter clears the snapshot (authoritative
	// no-adapter), unlike the uninspected/missing checkout above.
	const emptyProject = join(tmp, "inspected-empty");
	const emptySource = "git:github.com/example/inspected-empty";
	const emptyCheckout = join(emptyProject, ".pi", "git", "github.com", "example", "inspected-empty");
	mkdirSync(join(emptyCheckout, "docs"), { recursive: true });
	writeFileSync(join(emptyCheckout, "README.md"), "# no skills here\n");
	mkdirSync(join(emptyProject, ".pi"), { recursive: true });
	writeFileSync(join(emptyProject, ".pi", "settings.json"), JSON.stringify({ packages: [emptySource] }, null, 2) + "\n");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({
		version: 1,
		items: [{ id: "inspected-empty", kind: "package", source: emptySource, agentSkills: { skills: [{ name: "stale", description: "Stale.", root: "stale" }] } }],
	}, null, 2) + "\n");
	const emptyLoad = await loadProjectResourcesIntoConstruct(emptyProject, [emptySource], { ctx: { cwd: emptyProject, isProjectTrusted: () => true } });
	assert.equal(emptyLoad.selectedSources, 1, JSON.stringify(emptyLoad));
	const catalogAfterEmptyLoad = JSON.parse(readFileSync(availablePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(catalogAfterEmptyLoad.items.find((item) => item.source === emptySource)?.agentSkills, undefined, "inspected empty checkout must clear the stale snapshot");

	// 17) /construct load surfaces packageResources warnings (declared no-adapter / carrier
	// diagnostics), not only direct-resource warnings.
	const managedWarnProject = join(tmp, "managed-warning");
	const managedWarnSource = "git:github.com/example/managed-warning";
	const managedWarnOther = "git:github.com/example/managed-warning-other";
	mkdirSync(join(managedWarnProject, ".pi"), { recursive: true });
	writeFileSync(join(managedWarnProject, ".pi", "settings.json"), JSON.stringify({ packages: [managedWarnSource, managedWarnOther] }, null, 2) + "\n");
	writeFileSync(join(managedWarnProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "managed-warning": { kind: "package", source: managedWarnSource, enabled: true } } }, null, 2) + "\n");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
	const managedWarnLoad = await loadProjectResourcesIntoConstruct(managedWarnProject, [managedWarnOther], { ctx: { cwd: managedWarnProject, isProjectTrusted: () => true } });
	assert.equal(managedWarnLoad.selectedSources, 1, JSON.stringify(managedWarnLoad));
	assert(managedWarnLoad.warnings.some((warning) => /package is declared in this project, but Pi resolved no package resources/.test(warning)), JSON.stringify(managedWarnLoad.warnings));

	// 18) Regression (spf13/go-skills shape): a carrier adopted before the snapshot feature existed
	// is already Construct-managed and already in the catalog with no agentSkills. /construct load
	// must refresh its advisory snapshot so the library entry keeps its collapsed arrow even after the
	// project declaration and checkout disappear.
	const adoptedProject = join(tmp, "already-adopted-carrier");
	const adoptedSource = "https://github.com/example/already-adopted";
	const adoptedCheckout = join(adoptedProject, ".pi", "git", "github.com", "example", "already-adopted");
	mkdirSync(join(adoptedCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(adoptedCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./kept" }] }));
	writeSkill(join(adoptedCheckout, "kept"), "kept-skill", "Kept skill.");
	mkdirSync(join(adoptedProject, ".pi"), { recursive: true });
	writeFileSync(join(adoptedProject, ".pi", "settings.json"), JSON.stringify({ packages: [adoptedSource], skills: ["git/github.com/example/already-adopted/kept"] }, null, 2) + "\n");
	writeFileSync(join(adoptedProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "already-adopted": { kind: "package", source: adoptedSource, enabled: true } } }, null, 2) + "\n");
	writeFileSync(availablePaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "already-adopted", kind: "package", source: adoptedSource }] }, null, 2) + "\n");
	const adoptedPaths = await getPaths(makeCtx(adoptedProject, () => true));
	const adoptedLoad = await loadProjectResourcesIntoConstruct(adoptedProject, [], { ctx: { cwd: adoptedProject, isProjectTrusted: () => true } });
	assert.equal(adoptedLoad.selectedSources, 0, JSON.stringify(adoptedLoad));
	const catalogAfterAdoptedLoad = JSON.parse(readFileSync(adoptedPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: { skills: Array<{ root: string }> } }> };
	assert.deepEqual(catalogAfterAdoptedLoad.items.find((item) => item.source === adoptedSource)?.agentSkills?.skills.map((skill) => skill.root), ["kept"], "already-managed carrier must refresh its advisory snapshot on load");
	// Drop the declaration and checkout: the Available library row must keep its collapsed arrow.
	writeFileSync(join(adoptedProject, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	writeFileSync(join(adoptedProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: {} }, null, 2) + "\n");
	rmSync(adoptedCheckout, { recursive: true, force: true });
	const adoptedDashboard = await openDashboard(adoptedProject);
	const adoptedRow = adoptedDashboard.items.find((item) => !item.parentId && item.label === "already-adopted");
	assert(adoptedRow?.expandable, "refreshed snapshot must keep the Available carrier expandable without its checkout");
	assert.deepEqual(adoptedDashboard.items.filter((item) => item.parentId === adoptedRow.id).map((item) => item.value), ["kept/"]);

	// 19) Trust loss before an already-managed carrier snapshot refresh must refuse the catalog
	// write. This exercises the interactive handleLoad path (querying an already-managed carrier),
	// where the refresh writer now runs a fresh current-project trust prewrite after the earlier
	// reads. The guard is the last trust read in this branch, so the second run revokes trust there.
	const trustLossProject = join(tmp, "trust-loss-refresh");
	const trustLossSource = "git:github.com/example/trust-loss";
	const trustLossCheckout = join(trustLossProject, ".pi", "git", "github.com", "example", "trust-loss");
	mkdirSync(join(trustLossCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(trustLossCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./tl" }] }));
	writeSkill(join(trustLossCheckout, "tl"), "tl-skill", "Trust loss skill.");
	mkdirSync(join(trustLossProject, ".pi"), { recursive: true });
	writeFileSync(join(trustLossProject, ".pi", "settings.json"), JSON.stringify({ packages: [trustLossSource] }, null, 2) + "\n");
	writeFileSync(join(trustLossProject, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "trust-loss": { kind: "package", source: trustLossSource, enabled: true } } }, null, 2) + "\n");
	const trustLossPaths = await getPaths(makeCtx(trustLossProject, () => true));
	mkdirSync(trustLossPaths.constructDir, { recursive: true });
	const seedTrustLossCatalog = (): void => {
		writeFileSync(trustLossPaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "trust-loss", kind: "package", source: trustLossSource }] }, null, 2) + "\n");
	};
	const notifications: string[] = [];
	const trustLossCtx = (trusted: () => boolean): ExtensionCommandContext => ({
		cwd: trustLossProject,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: trusted,
		waitForIdle: async () => {},
		reload: async () => {},
		ui: { notify: (message: string) => { notifications.push(message); }, setStatus: () => {} },
	} as unknown as ExtensionCommandContext);
	// Sanity: a fully trusted refresh records the snapshot (and reveals how many trust reads run).
	seedTrustLossCatalog();
	let trustedCalls = 0;
	await handleLoad(trustLossSource, trustLossCtx(() => { trustedCalls += 1; return true; }));
	assert(trustedCalls > 0, "expected at least one current-project trust read");
	const catalogAfterTrustedRefresh = JSON.parse(readFileSync(trustLossPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert(catalogAfterTrustedRefresh.items.find((item) => item.source === trustLossSource)?.agentSkills !== undefined, "sanity: fully trusted refresh must record the snapshot");
	// Revoke trust at the write-time guard (the last trust read); the refresh must refuse and not write.
	seedTrustLossCatalog();
	let flipCalls = 0;
	await handleLoad(trustLossSource, trustLossCtx(() => { flipCalls += 1; return flipCalls < trustedCalls; }));
	assert.equal(flipCalls, trustedCalls, "write-time trust guard must still run after the earlier reads");
	const catalogAfterTrustLoss = JSON.parse(readFileSync(trustLossPaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(catalogAfterTrustLoss.items.find((item) => item.source === trustLossSource)?.agentSkills, undefined, "trust loss before the refresh must refuse the catalog write");
	assert(notifications.some((message) => /not trusted by Pi; refused to write/.test(message)), JSON.stringify(notifications));

	// 20) Exact live shape: the current project (pi-construct) has no go-skills declaration or
	// checkout, and the global catalog entry uses the exact URL spelling with no snapshot, so the
	// Available row has no arrow. The carrier project (hascamera shape: declaration, managed checkout,
	// six linked skills) is a separate trusted project. Its load records the global snapshot, after
	// which the same Available row in the current project shows the arrow. This documents the
	// product-flow dependency: Available rows are snapshot-only and no dashboard code scans another
	// project, so the snapshot must be recorded where the carrier is declared.
	const liveUrl = "https://github.com/spf13/go-skills";
	const livePlugins = ["cobra-viper", "fileflow-pathologize", "go", "go-release", "go-spec-reviewer", "wails"];
	const liveCurrent = join(tmp, "live-current-project");
	mkdirSync(join(liveCurrent, ".pi"), { recursive: true });
	writeFileSync(join(liveCurrent, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	const livePaths = await getPaths(makeCtx(liveCurrent, () => true));
	mkdirSync(livePaths.constructDir, { recursive: true });
	writeFileSync(livePaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "go-skills", kind: "package", source: liveUrl }] }, null, 2) + "\n");
	const liveBefore = await openDashboard(liveCurrent);
	const liveBeforeRow = liveBefore.items.find((item) => !item.parentId && item.label === "go-skills");
	assert(liveBeforeRow, "live Available go-skills row missing");
	assert.equal(liveBeforeRow.section, "Available", JSON.stringify(liveBeforeRow));
	assert.notEqual(liveBeforeRow.expandable, true, "Available row with no snapshot must not show an arrow (exact live failure)");
	// Carrier project: declaration + managed checkout shaped exactly like spf13/go-skills.
	const liveCarrier = join(tmp, "live-carrier-project");
	const liveCheckout = join(liveCarrier, ".pi", "git", "github.com", "spf13", "go-skills");
	mkdirSync(join(liveCheckout, ".claude-plugin"), { recursive: true });
	writeFileSync(join(liveCheckout, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "go-skills", plugins: livePlugins.map((name) => ({ name, source: `./${name}` })) }));
	for (const name of livePlugins) writeSkill(join(liveCheckout, name), name, `${name} skill.`);
	writeSkill(join(liveCheckout, "templates", "skill"), "template-skill", "Unpublished template skill.");
	mkdirSync(join(liveCarrier, ".pi"), { recursive: true });
	writeFileSync(join(liveCarrier, ".pi", "settings.json"), JSON.stringify({ packages: [liveUrl], skills: livePlugins.map((name) => `git/github.com/spf13/go-skills/${name}`) }, null, 2) + "\n");
	writeFileSync(join(liveCarrier, ".pi", "construct.json"), JSON.stringify({ version: 1, managedBy: "the-construct", items: { "go-skills": { kind: "package", source: liveUrl, enabled: true } } }, null, 2) + "\n");
	const liveLoad = await loadProjectResourcesIntoConstruct(liveCarrier, [], { ctx: { cwd: liveCarrier, isProjectTrusted: () => true } });
	assert.equal(liveLoad.selectedSources, 0, JSON.stringify(liveLoad));
	const liveCatalog = JSON.parse(readFileSync(livePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: { skills: Array<{ root: string }> } }> };
	assert.deepEqual(liveCatalog.items.find((item) => item.source === liveUrl)?.agentSkills?.skills.map((skill) => skill.root).slice().sort(), livePlugins.slice().sort(), "carrier-project load must record the six-skill snapshot");
	const liveAfter = await openDashboard(liveCurrent);
	const liveAfterRow = liveAfter.items.find((item) => !item.parentId && item.label === "go-skills");
	assert(liveAfterRow?.expandable, "Available row must show the arrow once the carrier project records the snapshot");
	assert.deepEqual(liveAfter.items.filter((item) => item.parentId === liveAfterRow.id).map((item) => item.value).slice().sort(), livePlugins.map((name) => `${name}/`).slice().sort());

	// 21) Available-only cache inspection: with no current-project declaration/checkout and no catalog
	// snapshot, an already-cached Pi temporary checkout supplies read-only children. No network,
	// install, or cross-project .pi checkout is used.
	const cacheUrl = "https://github.com/spf13/go-skills";
	const cachePlugins = ["cobra-viper", "fileflow-pathologize", "go", "go-release", "go-spec-reviewer", "wails"];
	const cacheProject = join(tmp, "cache-current-project");
	mkdirSync(join(cacheProject, ".pi"), { recursive: true });
	writeFileSync(join(cacheProject, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2) + "\n");
	const cachePaths = await getPaths(makeCtx(cacheProject, () => true));
	mkdirSync(cachePaths.constructDir, { recursive: true });
	writeFileSync(cachePaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "go-skills", kind: "package", source: cacheUrl }] }, null, 2) + "\n");
	// Exact spf13/go-skills shape placed in Pi's own temporary cache layout (getExtensionTempFolder
	// + getTemporaryDir("git-github.com", "spf13/go-skills")); computed here only for fixture setup.
	const cacheRoot = join(process.env.HOME ?? "", ".pi", "agent", "tmp", "extensions", "git-github.com", createHash("sha256").update("git-github.com-spf13/go-skills").digest("hex").slice(0, 8), "spf13", "go-skills");
	mkdirSync(join(cacheRoot, ".claude-plugin"), { recursive: true });
	writeFileSync(join(cacheRoot, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "go-skills", plugins: cachePlugins.map((name) => ({ name, source: `./${name}` })) }));
	for (const name of cachePlugins) writeSkill(join(cacheRoot, name), name, `${name} skill.`);
	writeSkill(join(cacheRoot, "templates", "skill"), "template-skill", "Unpublished template skill.");
	const cacheCtx = makeCtx(cacheProject, () => true);
	const cacheInventory = await collectProjectInventory(cacheCtx);
	const cacheAvailable = await collectTemporaryPackageResourcesForSources(cacheCtx, cacheInventory, [cacheUrl], { cacheOnly: true });
	const cachedRepository = cacheAvailable.skillRepositories.find((repository) => repository.source === cacheUrl);
	assert(cachedRepository, `cache inspection did not surface a repository: ${JSON.stringify(cacheAvailable.skillRepositories.map((repository) => [repository.source, repository.skills.length]))}`);
	assert.deepEqual(cachedRepository.skills.map((skill) => skill.name).slice().sort(), cachePlugins.slice().sort());
	assert.equal(cachedRepository.skills.some((skill) => skill.name === "template-skill"), false, "unpublished template must be excluded");
	assert.equal(cachedRepository.skills.every((skill) => skill.absoluteRoot === undefined && skill.settingsPath === undefined), true, "cache preview must not expose absolute/settings paths");
	assert.equal(cachedRepository.catalogPreview, true, "cache preview must be read-only");
	// Prove the fixture is cache-only: no current-project or user-scope checkout, and no project git dir.
	const { manager: cacheManager } = createProjectPackageManager(cachePaths, { projectTrusted: true });
	assert.equal(cacheManager.getInstalledPath(cacheUrl, "project"), undefined, "cache path must not require a current-project checkout");
	assert.equal(cacheManager.getInstalledPath(cacheUrl, "user"), undefined, "cache path must not require a user-scope checkout");
	assert.equal(existsSync(join(cacheProject, ".pi", "git")), false, "cache inspection must not create a project checkout");
	// Dashboard shows the dropdown from the cache, read-only, and does not persist a catalog snapshot.
	const cacheDashboard = await openDashboard(cacheProject);
	const cacheRow = cacheDashboard.items.find((item) => !item.parentId && item.label === "go-skills");
	assert(cacheRow, "cache Available row missing");
	assert.equal(cacheRow.section, "Available", JSON.stringify(cacheRow));
	assert(cacheRow.expandable, "cached Available row must show the dropdown");
	const cacheChildren = cacheDashboard.items.filter((item) => item.parentId === cacheRow.id);
	assert.deepEqual(cacheChildren.map((item) => item.value).slice().sort(), cachePlugins.map((name) => `${name}/`).slice().sort());
	assert.equal(cacheChildren.every((item) => item.disabled === true), true, "cache children must be read-only");
	assert.doesNotMatch(JSON.stringify(cacheChildren), /tmp[^"]*extensions/, "child rows must not leak cached absolute paths");
	const cacheCatalogAfter = JSON.parse(readFileSync(cachePaths.userCatalogPath, "utf8")) as { items: Array<{ source: string; agentSkills?: unknown }> };
	assert.equal(cacheCatalogAfter.items.find((item) => item.source === cacheUrl)?.agentSkills, undefined, "cache inspection must remain non-persistent");
	// A validated snapshot wins over a possibly-stale cache.
	writeFileSync(cachePaths.userCatalogPath, JSON.stringify({ version: 1, items: [{ id: "go-skills", kind: "package", source: cacheUrl, agentSkills: { skills: [{ name: "remembered", description: "Remembered.", root: "remembered" }] } }] }, null, 2) + "\n");
	const snapshotWins = await openDashboard(cacheProject);
	const snapshotWinsRow = snapshotWins.items.find((item) => !item.parentId && item.label === "go-skills");
	assert(snapshotWinsRow?.expandable, "validated snapshot must still provide the dropdown");
	assert.deepEqual(snapshotWins.items.filter((item) => item.parentId === snapshotWinsRow.id).map((item) => item.value), ["remembered/"], "validated snapshot must win over the stale temporary cache");

	console.log("skill-repositories smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
