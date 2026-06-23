import assert from "node:assert/strict";
import { packageResourceSelectionKey, planPackageResourceFilters } from "../extensions/construct/package-resource-plans.js";

const resources = [
	{ kind: "extension", packageRelativePath: "shared/path.md" },
	{ kind: "prompt", packageRelativePath: "shared/path.md" },
	{ kind: "skill", packageRelativePath: "skills/helper/SKILL.md" },
	{ kind: "theme", packageRelativePath: "themes/simple.json" },
] as const;

const promptOnly = planPackageResourceFilters(resources, new Set([packageResourceSelectionKey("prompt", "shared/path.md")]));
assert.deepEqual(promptOnly.filters, {
	extensions: [],
	skills: [],
	prompts: ["shared/path.md"],
	themes: [],
});
assert.equal(promptOnly.selectedCount, 1);

const allEmpty = planPackageResourceFilters(resources, new Set());
assert.deepEqual(allEmpty.filters, { extensions: [], skills: [], prompts: [], themes: [] });
assert.equal(allEmpty.selectedCount, 0);

const mixed = planPackageResourceFilters(resources, new Set([
	packageResourceSelectionKey("extension", "shared/path.md"),
	packageResourceSelectionKey("prompt", "shared/path.md"),
	packageResourceSelectionKey("skill", "skills/helper/SKILL.md"),
]));
assert.deepEqual(mixed.filters, {
	extensions: ["shared/path.md"],
	skills: ["skills/helper/SKILL.md"],
	prompts: ["shared/path.md"],
	themes: [],
});
assert.equal(mixed.selectedCount, 3);

console.log("package-resource-plans smoke ok");
