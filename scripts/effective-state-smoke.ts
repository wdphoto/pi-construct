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
