import type { ConstructPaths, JsonObject, JsonReadResult } from "./types.js";
import { isObject, readJson, writeJson } from "./json.js";

export function getAutoload(settings: JsonReadResult): { enabled: boolean; note: string } {
	if (settings.state === "missing") return { enabled: false, note: "off (default; settings file missing)" };
	if (settings.state === "invalid") return { enabled: false, note: "off (settings file invalid)" };
	if (!isObject(settings.data)) return { enabled: false, note: "off (settings file is not an object)" };
	return settings.data.autoload === true ? { enabled: true, note: "on" } : { enabled: false, note: "off" };
}

export function getAutosync(settings: JsonReadResult): { enabled: boolean; note: string } {
	if (settings.state === "missing") return { enabled: false, note: "off (default; settings file missing)" };
	if (settings.state === "invalid") return { enabled: false, note: "off (settings file invalid)" };
	if (!isObject(settings.data)) return { enabled: false, note: "off (settings file is not an object)" };
	return settings.data.autosync === true ? { enabled: true, note: "on" } : { enabled: false, note: "off" };
}

export function getSkippedHere(skips: JsonReadResult, cwd: string, realCwd: string): boolean {
	if (skips.state !== "ok" || !isObject(skips.data) || !isObject(skips.data.projects)) return false;
	return isObject(skips.data.projects[cwd]) || isObject(skips.data.projects[realCwd]);
}

export function readUserSettings(settings: JsonReadResult): JsonObject {
	if (settings.state === "missing") return { version: 1 };
	if (settings.state === "invalid") throw new Error(`Cannot update invalid Construct settings: ${settings.error}`);
	if (!isObject(settings.data)) throw new Error("Cannot update Construct settings because settings.json is not an object.");
	return { ...settings.data };
}

export async function writeAutoload(paths: ConstructPaths, enabled: boolean): Promise<void> {
	const settings = readUserSettings(await readJson(paths.userSettingsPath));
	await writeJson(paths.userSettingsPath, { ...settings, version: 1, autoload: enabled });
}

export async function writeAutosync(paths: ConstructPaths, enabled: boolean): Promise<void> {
	const settings = readUserSettings(await readJson(paths.userSettingsPath));
	await writeJson(paths.userSettingsPath, { ...settings, version: 1, autosync: enabled });
}

export async function addSkip(paths: ConstructPaths): Promise<void> {
	const read = await readJson(paths.userSkipsPath);
	let root: JsonObject;
	if (read.state === "missing") root = { version: 1, projects: {} };
	else if (read.state === "invalid") throw new Error(`Cannot update invalid Construct skips: ${read.error}`);
	else if (isObject(read.data)) root = { ...read.data };
	else throw new Error("Cannot update Construct skips because skips.json is not an object.");

	const projects = isObject(root.projects) ? root.projects : {};
	await writeJson(paths.userSkipsPath, {
		...root,
		version: 1,
		projects: {
			...projects,
			[paths.realCwd]: {
				skippedAt: new Date().toISOString(),
				reason: "dont-ask",
			},
		},
	});
}
