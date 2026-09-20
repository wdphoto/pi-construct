import assert from "node:assert/strict";
import { effectivePackageState, savedSourceDecision } from "../extensions/construct/effective-state.js";
import { withEffectivePackageStates, type ProjectInventory } from "../extensions/construct/project-inventory.js";
import type { PackageResourceInventory, PackageResourceSummary } from "../extensions/construct/package-resources.js";

function resource(overrides: Partial<PackageResourceSummary> = {}): PackageResourceSummary {
	return {
		packageSource: "npm:demo",
		packageManaged: true,
		kind: "extension",
		name: "demo",
		path: "/pkg/extensions/demo.ts",
		packageRelativePath: "extensions/demo.ts",
		enabled: true,
		...overrides,
	};
}

const target = { id: "demo", matchSources: ["npm:demo"] };

// No inventory, empty inventory, or no matching resources: unknown, never active/inactive.
assert.equal(effectivePackageState(undefined, target), "unknown");
assert.equal(effectivePackageState([], target), "unknown");
assert.equal(effectivePackageState([resource()], { matchSources: ["npm:other"] }), "unknown");

// Any enabled matching resource: active. Matching resources all off: inactive.
assert.equal(effectivePackageState([resource({ enabled: true })], target), "active");
assert.equal(effectivePackageState([resource({ enabled: false })], target), "inactive");
assert.equal(
	effectivePackageState([resource({ enabled: false }), resource({ packageRelativePath: "extensions/second.ts", enabled: true })], target),
	"active",
);

const resourceInventory: PackageResourceInventory = {
	resources: [
		resource(),
		resource({ packageSource: "npm:off", packageManagedId: "off", packageRelativePath: "extensions/off.ts", enabled: false }),
	],
	warnings: [],
	skillRepositories: [],
	skillInspections: [],
};

const inventory = {
	managedPackages: [
		{ metadata: { id: "demo" }, matchSources: ["npm:demo"], declared: true, projectOverride: false, disabledByFilters: false, state: "active" },
		{ metadata: { id: "off" }, matchSources: ["npm:off"], declared: true, projectOverride: false, disabledByFilters: false, state: "active", filterState: "partially-filtered" },
		{ metadata: { id: "missing" }, matchSources: ["npm:missing"], declared: true, projectOverride: false, disabledByFilters: false, state: "active" },
	],
	unloadedPackageDeclarations: [{ matchSources: ["npm:demo"], disabledByFilters: false, source: "npm:demo" }],
} as unknown as ProjectInventory;

const patched = withEffectivePackageStates(inventory, resourceInventory);
assert.equal(patched.managedPackages[0]?.effectiveState, "active");
assert.equal(patched.managedPackages[1]?.effectiveState, "inactive");
assert.equal(patched.managedPackages[2]?.effectiveState, "unknown");
assert.equal(patched.unloadedPackageDeclarations[0]?.effectiveState, "active");

// Declaration policy fields must remain untouched so whole-package enable/disable survives.
assert.equal(patched.managedPackages[1]?.state, "active");
assert.equal(patched.managedPackages[1]?.filterState, "partially-filtered");
assert.equal(patched.managedPackages[2]?.state, "active");

// Agent Skills carriers use the same effective-state path even when Pi resolves no package resources,
// so save/run planning classifies a linked carrier Active instead of unresolved.
const carrierResourceInventory: PackageResourceInventory = {
	resources: [],
	warnings: [],
	skillRepositories: [
		{
			source: "git:github.com/example/skills",
			packageRoot: "/tmp/skills",
			diagnostics: [],
			skills: [
				{ name: "active-skill", description: "", packageRelativeRoot: "a", packageRelativeFile: "a/SKILL.md", absoluteRoot: "/tmp/skills/a", absoluteFile: "/tmp/skills/a/SKILL.md", settingsPath: "git/example/skills/a", linked: true, enabled: true },
			],
		},
	],
	skillInspections: [{ source: "git:github.com/example/skills", matchSources: ["git:github.com/example/skills"], inspected: true, adapter: true }],
};
const carrierInventory = {
	managedPackages: [
		{ metadata: { id: "carrier" }, matchSources: ["git:github.com/example/skills"], declared: true, projectOverride: false, disabledByFilters: false, state: "active" },
	],
	unloadedPackageDeclarations: [],
} as unknown as ProjectInventory;
const carrierPatched = withEffectivePackageStates(carrierInventory, carrierResourceInventory);
assert.equal(carrierPatched.managedPackages[0]?.effectiveState, "active");
assert.equal(carrierPatched.managedPackages[0]?.skillCarrier, true, "discovered carrier is flagged on the shared inventory row");
assert.equal(savedSourceDecision({ section: "Disabled", wholePackageDisabled: false, effectiveState: carrierPatched.managedPackages[0]?.effectiveState }), "active");
const unlinkedCarrier = withEffectivePackageStates(carrierInventory, {
	...carrierResourceInventory,
	skillRepositories: [{ ...carrierResourceInventory.skillRepositories[0], skills: [{ ...carrierResourceInventory.skillRepositories[0].skills[0], linked: false, enabled: false }] }],
});
assert.equal(unlinkedCarrier.managedPackages[0]?.effectiveState, "inactive", "an unlinked/discovered carrier is inactive, not unknown/unresolved");
assert.equal(unlinkedCarrier.managedPackages[0]?.skillCarrier, true);
assert.equal(savedSourceDecision({ section: "Disabled", wholePackageDisabled: false, effectiveState: unlinkedCarrier.managedPackages[0]?.effectiveState }), "all-off");
// An unadopted (unloaded) discovered carrier must also be inactive + flagged, not unknown, so
// save/run give Agent Skills guidance instead of generic pi config wording or double-counting unresolved.
const unloadedCarrierInventory = {
	managedPackages: [],
	unloadedPackageDeclarations: [{ source: "git:github.com/example/skills", matchSources: ["git:github.com/example/skills"], disabledByFilters: false, effectiveState: "unknown" }],
} as unknown as ProjectInventory;
const unloadedCarrier = withEffectivePackageStates(unloadedCarrierInventory, {
	...carrierResourceInventory,
	skillRepositories: [{ ...carrierResourceInventory.skillRepositories[0], skills: [{ ...carrierResourceInventory.skillRepositories[0].skills[0], linked: false, enabled: false }] }],
});
assert.equal(unloadedCarrier.unloadedPackageDeclarations[0]?.effectiveState, "inactive", "an unlinked unloaded carrier is inactive, not unknown");
assert.equal(unloadedCarrier.unloadedPackageDeclarations[0]?.skillCarrier, true);
assert.equal(savedSourceDecision({ section: "Unloaded", wholePackageDisabled: false, effectiveState: unloadedCarrier.unloadedPackageDeclarations[0]?.effectiveState }), "all-off");
const unloadedNonCarrier = withEffectivePackageStates(unloadedCarrierInventory, { resources: [], warnings: [], skillRepositories: [], skillInspections: [] });
assert.equal(unloadedNonCarrier.unloadedPackageDeclarations[0]?.effectiveState, "unknown", "a non-carrier unloaded zero-resource declaration stays unknown");
assert.equal(savedSourceDecision({ section: "Unloaded", wholePackageDisabled: false, effectiveState: "unknown" }), "unresolved");

// Shared saved-source decision (dashboard saved-row Enter and /construct run use the same function).
assert.equal(savedSourceDecision({ section: "Available", wholePackageDisabled: false, effectiveState: "unknown" }), "install");
assert.equal(savedSourceDecision({ section: "Disabled", wholePackageDisabled: true, effectiveState: "unknown" }), "enable");
assert.equal(savedSourceDecision({ section: "Active", wholePackageDisabled: false, effectiveState: "active" }), "active");
assert.equal(savedSourceDecision({ section: "Disabled", wholePackageDisabled: false, effectiveState: "inactive" }), "all-off");
assert.equal(savedSourceDecision({ section: "Unresolved", wholePackageDisabled: false, effectiveState: "unknown" }), "unresolved");
// Boundary: an autoload:false Overrides row is read-only even when its filter shape looks whole-disabled/all-off.
assert.equal(savedSourceDecision({ section: "Overrides", wholePackageDisabled: true, effectiveState: "inactive" }), "override");
assert.equal(savedSourceDecision({ section: "Overrides", wholePackageDisabled: false, effectiveState: "active" }), "override");
// A partly-active partial stays active/eligible, never all-off.
assert.equal(
	savedSourceDecision({ section: "Active", wholePackageDisabled: false, effectiveState: effectivePackageState([resource({ enabled: true }), resource({ packageRelativePath: "extensions/second.ts", enabled: false })], target) }),
	"active",
);

console.log("effective-state smoke ok");
