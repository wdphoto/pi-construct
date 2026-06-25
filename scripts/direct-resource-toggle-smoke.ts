import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPaths } from "../extensions/construct/paths.js";
import { readJson } from "../extensions/construct/json.js";
import { collectDirectProjectResources } from "../extensions/construct/resources.js";
import { disableDirectResourceInProject, enableDirectResourceInProject } from "../extensions/construct/package-ops.js";

const tmp = mkdtempSync(join(tmpdir(), "construct-direct-toggle-"));
try {
	const home = join(tmp, "home");
	const cwd = join(tmp, "project");
	process.env.HOME = home;
	mkdirSync(join(cwd, ".pi", "themes"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "themes", "tokyo.json"), '{"name":"tokyo"}\n');
	writeFileSync(join(cwd, ".pi", "construct.json"), JSON.stringify({
		version: 1,
		managedBy: "the-construct",
		items: {
			"theme:tokyo": { kind: "theme", path: ".pi/themes/tokyo.json", enabled: true },
		},
	}, null, 2));

	const ctx = { cwd, isProjectTrusted: () => true };
	const paths = await getPaths(ctx);
	const before = await collectDirectProjectResources(ctx, paths, await readJson(paths.projectConstructPath));
	const theme = before.resources.find((resource) => resource.kind === "theme" && resource.name === "tokyo");
	assert(theme, JSON.stringify(before));
	assert.equal(theme.enabled, true);
	assert.equal(theme.managed, true);
	assert.equal(theme.settingsPath, "themes/tokyo.json");

	const disabled = await disableDirectResourceInProject(paths, theme, { projectTrusted: true });
	assert.equal(disabled.ok, true, disabled.error);
	let settings = JSON.parse(readFileSync(paths.projectSettingsPath, "utf8"));
	assert.deepEqual(settings.themes, ["-themes/tokyo.json"]);

	const afterDisable = await collectDirectProjectResources(ctx, paths, await readJson(paths.projectConstructPath));
	const disabledTheme = afterDisable.resources.find((resource) => resource.kind === "theme" && resource.name === "tokyo");
	assert(disabledTheme, JSON.stringify(afterDisable));
	assert.equal(disabledTheme.enabled, false);

	const enabled = await enableDirectResourceInProject(paths, disabledTheme, { projectTrusted: true });
	assert.equal(enabled.ok, true, enabled.error);
	settings = JSON.parse(readFileSync(paths.projectSettingsPath, "utf8"));
	assert.deepEqual(settings.themes, ["+themes/tokyo.json"]);

	console.log("direct-resource-toggle smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
