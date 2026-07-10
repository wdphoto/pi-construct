import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disablePackageResourcesInProject, loadPackageIntoProject, removePackageFromProject, setPackageResourceFiltersInProject } from "../extensions/construct/package-ops.js";
import { getPaths } from "../extensions/construct/paths.js";
import { applyDirectResourceDrift, collectPackageSourceSets, getPackages, matchingPiProjectOverride } from "../extensions/construct/project-settings.js";
import { readJson } from "../extensions/construct/json.js";

const tmp = mkdtempSync(join(tmpdir(), "construct-project-overrides-"));
try {
	const home = join(tmp, "home");
	const cwd = join(tmp, "project");
	process.env.HOME = home;
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
		packages: [{
			source: "npm:shared-tools",
			autoload: false,
			skills: ["-skills/review/SKILL.md"],
		}],
	}, null, 2));

	const paths = await getPaths({ cwd });
	const declarations = getPackages(await readJson(paths.projectSettingsPath));
	assert.equal(declarations.length, 1);
	assert.equal(declarations[0]?.projectOverride, true);
	assert.equal(declarations[0]?.autoload, false);
	assert.equal(declarations[0]?.disabledByFilters, false);
	assert.match(declarations[0]?.filterDescription ?? "", /Pi project override/);

	const sets = await collectPackageSourceSets(declarations, join(cwd, ".pi"));
	assert.equal(sets.declaredSources.size, 0);
	assert.equal(sets.activeSources.size, 0);
	assert(sets.projectOverrideSources.size > 0);
	assert.equal(await matchingPiProjectOverride(paths, "npm:shared-tools"), "npm:shared-tools");

	const options = { projectTrusted: true };
	const install = await loadPackageIntoProject(paths, { source: "npm:shared-tools" }, options);
	assert.equal(install.ok, false);
	assert.match(install.error ?? "", /pi config -l/);
	const disable = await disablePackageResourcesInProject(paths, { source: "npm:shared-tools" }, options);
	assert.equal(disable.ok, false);
	assert.match(disable.error ?? "", /autoload: false/);
	const filter = await setPackageResourceFiltersInProject(paths, { source: "npm:shared-tools", filters: { skills: [] }, selectedCount: 0 }, options);
	assert.equal(filter.ok, false);
	assert.match(filter.error ?? "", /pi config -l/);
	const remove = await removePackageFromProject(paths, { source: "npm:shared-tools" }, options);
	assert.equal(remove.ok, false);
	assert.match(remove.error ?? "", /pi config -l/);

	const drifted = applyDirectResourceDrift(
		[{ id: "skill:gone", kind: "skill", source: ".pi/skills/gone/SKILL.md", enabled: true }],
		[],
	);
	assert.match(drifted[0]?.drift ?? "", /missing from Pi's resolved project resources/);

	console.log("project overrides smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
