import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths } from "./types.js";
import { deriveId } from "./catalog.js";
import { readJson, writeJson } from "./json.js";
import {
	backupProjectSettingsIfPresent,
	chooseDeclaredSource,
	getPackages,
	parseProjectConstruct,
	uniqueManagedId,
	upsertConstructItem,
	removeMatchingPackageDeclaration,
	setMatchingPackageResourcesDisabled,
} from "./project-settings.js";
import { rememberKnownProject } from "./projects.js";
import { isObject } from "./json.js";

function updateConstructItemEnabled(constructRead: Awaited<ReturnType<typeof readJson>>, id: string, enabled: boolean) {
	const root = parseProjectConstruct(constructRead);
	const items = isObject(root.items) ? root.items : {};
	const item = isObject(items[id]) ? items[id] : {};
	return {
		...root,
		version: 1,
		managedBy: "the-construct",
		items: {
			...items,
			[id]: {
				...item,
				enabled,
				updatedAt: new Date().toISOString(),
			},
		},
	};
}

export interface LoadPackageResult {
	ok: boolean;
	itemId?: string;
	declaredSource?: string;
	backupPath?: string;
	changedProjectSettings?: boolean;
	needsReload?: boolean;
	error?: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	metadataOnlyFailure?: boolean;
}

export async function loadPackageIntoProject(
	pi: ExtensionAPI,
	paths: ConstructPaths,
	input: { source: string; item?: CatalogItem },
): Promise<LoadPackageResult> {
	const constructRead = await readJson(paths.projectConstructPath);
	try {
		parseProjectConstruct(constructRead);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const beforePackages = getPackages(await readJson(paths.projectSettingsPath));
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		return { ok: false, error: `Could not back up .pi/settings.json; aborting load.\n${error instanceof Error ? error.message : String(error)}` };
	}

	const install = await pi.exec("pi", ["install", input.source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
	if (install.code !== 0) {
		return { ok: false, backupPath, exitCode: install.code, stdout: install.stdout, stderr: install.stderr };
	}

	const afterPackages = getPackages(await readJson(paths.projectSettingsPath));
	const declaredSource = chooseDeclaredSource(beforePackages, afterPackages, input.source);
	let itemId: string | undefined;
	try {
		const freshConstructRead = await readJson(paths.projectConstructPath);
		itemId = input.item?.managed ? input.item.id : uniqueManagedId(input.item?.id ?? deriveId(input.source), freshConstructRead, declaredSource);
		const construct = upsertConstructItem(parseProjectConstruct(freshConstructRead), itemId, declaredSource, input.source, paths);
		await writeJson(paths.projectConstructPath, construct);
		await rememberKnownProject({ cwd: paths.cwd });
	} catch (error) {
		return {
			ok: false,
			backupPath,
			changedProjectSettings: true,
			needsReload: true,
			declaredSource,
			itemId,
			metadataOnlyFailure: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	return { ok: true, itemId, declaredSource, backupPath, changedProjectSettings: true, needsReload: true };
}

export interface DisablePackageResult {
	ok: boolean;
	backupPath?: string;
	changedProjectSettings?: boolean;
	needsReload?: boolean;
	error?: string;
	metadataOnlyFailure?: boolean;
}

export async function disablePackageResourcesInProject(paths: ConstructPaths, input: { source: string; id?: string }): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setMatchingPackageResourcesDisabled(paths, input.source, true);
		backupPath = updated.backupPath;
		if (!updated.updated) return { ok: false, backupPath, error: updated.settingsMissing ? ".pi/settings.json is missing." : `No matching package declaration found for ${input.source}.` };
	} catch (error) {
		return { ok: false, backupPath, error: `Construct disable failed during settings edit.\n${error instanceof Error ? error.message : String(error)}` };
	}

	if (input.id) {
		try {
			const construct = await readJson(paths.projectConstructPath);
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, input.id, false));
			await rememberKnownProject({ cwd: paths.cwd });
		} catch (error) {
			return { ok: false, backupPath, changedProjectSettings: true, needsReload: true, metadataOnlyFailure: true, error: error instanceof Error ? error.message : String(error) };
		}
	}

	return { ok: true, backupPath, changedProjectSettings: true, needsReload: true };
}

export async function enablePackageResourcesInProject(paths: ConstructPaths, input: { source: string; id?: string }): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setMatchingPackageResourcesDisabled(paths, input.source, false);
		backupPath = updated.backupPath;
		if (!updated.updated) return { ok: false, backupPath, error: updated.settingsMissing ? ".pi/settings.json is missing." : `No matching package declaration found for ${input.source}.` };
	} catch (error) {
		return { ok: false, backupPath, error: `Construct enable failed during settings edit.\n${error instanceof Error ? error.message : String(error)}` };
	}

	if (input.id) {
		try {
			const construct = await readJson(paths.projectConstructPath);
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, input.id, true));
			await rememberKnownProject({ cwd: paths.cwd });
		} catch (error) {
			return { ok: false, backupPath, changedProjectSettings: true, needsReload: true, metadataOnlyFailure: true, error: error instanceof Error ? error.message : String(error) };
		}
	}

	return { ok: true, backupPath, changedProjectSettings: true, needsReload: true };
}

export interface UnloadPackageResult {
	ok: boolean;
	backupPath?: string;
	fallbackWarning?: string;
	changedProjectSettings?: boolean;
	needsReload?: boolean;
	error?: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	metadataOnlyFailure?: boolean;
}

export async function removePackageFromProject(
	pi: ExtensionAPI,
	paths: ConstructPaths,
	input: { source: string; id?: string },
): Promise<UnloadPackageResult> {
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		return { ok: false, error: `Could not back up .pi/settings.json; aborting remove.\n${error instanceof Error ? error.message : String(error)}` };
	}

	const removal = await pi.exec("pi", ["remove", input.source, "-l", "--approve"], { timeout: 120_000, cwd: paths.cwd });
	let fallbackWarning: string | undefined;
	if (removal.code !== 0) {
		try {
			const removedByEdit = await removeMatchingPackageDeclaration(paths, input.source, { backupPath });
			if (!removedByEdit.removed) {
				return { ok: false, backupPath, exitCode: removal.code, stdout: removal.stdout, stderr: removal.stderr };
			}
			fallbackWarning = `pi remove did not match ${input.source}; removed it by editing .pi/settings.json instead.`;
		} catch (error) {
			return { ok: false, backupPath, error: `Construct remove failed during fallback settings edit.\n${error instanceof Error ? error.message : String(error)}` };
		}
	}

	try {
		if (input.id) {
			const construct = await readJson(paths.projectConstructPath);
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, input.id, false));
		}
		await rememberKnownProject({ cwd: paths.cwd });
	} catch (error) {
		return {
			ok: false,
			backupPath,
			fallbackWarning,
			changedProjectSettings: true,
			needsReload: true,
			metadataOnlyFailure: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	return { ok: true, backupPath, fallbackWarning, changedProjectSettings: true, needsReload: true };
}

export const unloadPackageFromProject = removePackageFromProject;
