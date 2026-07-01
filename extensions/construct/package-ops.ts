import type { CatalogItem, ConstructPaths, DirectResourceSummary } from "./types.js";
import { deriveId } from "./catalog.js";
import { readJson, writeJson } from "./json.js";
import { installAndPersistProjectPackage, removeAndPersistProjectPackage, type ProjectPackageManagerOptions } from "./pi-adapter/package-manager.js";
import {
	backupProjectSettingsIfPresent,
	chooseDeclaredSource,
	getPackages,
	parseProjectConstruct,
	uniqueManagedId,
	upsertConstructItem,
	removeMatchingConstructPackageItems,
	readSettingsObject,
	removeMatchingPackageDeclaration,
	setDirectResourceEnabled,
	setMatchingPackageResourceFilters,
	setMatchingPackageResourcesDisabled,
	type PackageResourceFilterUpdate,
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

export type PackageOperationOptions = ProjectPackageManagerOptions;

function projectWriteOptions(options: PackageOperationOptions = {}): PackageOperationOptions {
	return { projectTrusted: options.projectTrusted };
}

function updateConstructDirectResourceEnabled(constructRead: Awaited<ReturnType<typeof readJson>>, resource: DirectResourceSummary, enabled: boolean) {
	if (resource.managedId) return updateConstructItemEnabled(constructRead, resource.managedId, enabled);
	const root = parseProjectConstruct(constructRead);
	const items = isObject(root.items) ? root.items : {};
	let matchedId: string | undefined;
	for (const [id, value] of Object.entries(items)) {
		if (isObject(value) && value.kind === resource.kind && (value.path === resource.displayPath || value.path === resource.path)) {
			matchedId = id;
			break;
		}
	}
	if (!matchedId) return root;
	return updateConstructItemEnabled(constructRead, matchedId, enabled);
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
	paths: ConstructPaths,
	input: { source: string; item?: CatalogItem },
	options: PackageOperationOptions = {},
): Promise<LoadPackageResult> {
	if (options.projectTrusted === false) return { ok: false, error: "Project is not trusted by Pi; refusing to install packages into project settings." };
	const constructRead = await readJson(paths.projectConstructPath);
	try {
		parseProjectConstruct(constructRead);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const beforeSettingsRead = await readJson(paths.projectSettingsPath);
	try {
		readSettingsObject(beforeSettingsRead);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	const beforePackages = getPackages(beforeSettingsRead);
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		return { ok: false, error: `Could not back up .pi/settings.json; aborting load.\n${error instanceof Error ? error.message : String(error)}` };
	}

	try {
		await installAndPersistProjectPackage(paths, input.source, options);
	} catch (error) {
		return { ok: false, backupPath, error: error instanceof Error ? error.message : String(error) };
	}

	const afterPackages = getPackages(await readJson(paths.projectSettingsPath));
	const declaredSource = chooseDeclaredSource(beforePackages, afterPackages, input.source);
	let itemId: string | undefined;
	try {
		const freshConstructRead = await readJson(paths.projectConstructPath);
		itemId = input.item?.managed ? input.item.id : await uniqueManagedId(input.item?.id ?? deriveId(input.source), freshConstructRead, declaredSource, input.source, paths);
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

export async function disablePackageResourcesInProject(paths: ConstructPaths, input: { source: string; id?: string }, options: PackageOperationOptions = {}): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setMatchingPackageResourcesDisabled(paths, input.source, true, projectWriteOptions(options));
		backupPath = updated.backupPath;
		if (!updated.updated) {
			return {
				ok: false,
				backupPath,
				error: updated.blockedByPartialFilters
					? `Package ${updated.blockedSource ?? input.source} already has partial Pi package filters. Construct will not replace them with whole-package disable filters; use package resource picking instead.`
					: updated.settingsMissing
						? ".pi/settings.json is missing."
						: `No matching package declaration found for ${input.source}.`,
			};
		}
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

export async function enablePackageResourcesInProject(paths: ConstructPaths, input: { source: string; id?: string }, options: PackageOperationOptions = {}): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setMatchingPackageResourcesDisabled(paths, input.source, false, projectWriteOptions(options));
		backupPath = updated.backupPath;
		if (!updated.updated) {
			return {
				ok: false,
				backupPath,
				error: updated.blockedByPartialFilters
					? `Package ${updated.blockedSource ?? input.source} already has partial Pi package filters. Construct will not clear them with whole-package enable; use package resource picking instead.`
					: updated.settingsMissing
						? ".pi/settings.json is missing."
						: `No matching package declaration found for ${input.source}.`,
			};
		}
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

export async function setPackageResourceFiltersInProject(
	paths: ConstructPaths,
	input: { source: string; id?: string; filters: PackageResourceFilterUpdate; selectedCount: number },
	options: PackageOperationOptions = {},
): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setMatchingPackageResourceFilters(paths, input.source, input.filters, projectWriteOptions(options));
		backupPath = updated.backupPath;
		if (!updated.updated) {
			return {
				ok: false,
				backupPath,
				error: updated.settingsMissing ? ".pi/settings.json is missing." : `No matching package declaration found for ${input.source}.`,
			};
		}
	} catch (error) {
		return { ok: false, backupPath, error: `Construct package resource filter update failed during settings edit.\n${error instanceof Error ? error.message : String(error)}` };
	}

	if (input.id) {
		try {
			const construct = await readJson(paths.projectConstructPath);
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, input.id, input.selectedCount > 0));
			await rememberKnownProject({ cwd: paths.cwd });
		} catch (error) {
			return { ok: false, backupPath, changedProjectSettings: true, needsReload: true, metadataOnlyFailure: true, error: error instanceof Error ? error.message : String(error) };
		}
	}

	return { ok: true, backupPath, changedProjectSettings: true, needsReload: true };
}

async function setDirectResourceStateInProject(paths: ConstructPaths, resource: DirectResourceSummary, enabled: boolean, options: PackageOperationOptions = {}): Promise<DisablePackageResult> {
	let backupPath: string | undefined;
	try {
		const updated = await setDirectResourceEnabled(paths, resource, enabled, projectWriteOptions(options));
		backupPath = updated.backupPath;
		if (!updated.updated) return { ok: false, backupPath, error: updated.reason ?? `No matching project resource found for ${resource.displayPath}.` };
	} catch (error) {
		return { ok: false, backupPath, error: `Construct ${enabled ? "enable" : "disable"} failed during settings edit.\n${error instanceof Error ? error.message : String(error)}` };
	}

	try {
		const construct = await readJson(paths.projectConstructPath);
		await writeJson(paths.projectConstructPath, updateConstructDirectResourceEnabled(construct, resource, enabled));
		await rememberKnownProject({ cwd: paths.cwd });
	} catch (error) {
		return { ok: false, backupPath, changedProjectSettings: true, needsReload: true, metadataOnlyFailure: true, error: error instanceof Error ? error.message : String(error) };
	}

	return { ok: true, backupPath, changedProjectSettings: true, needsReload: true };
}

export async function disableDirectResourceInProject(paths: ConstructPaths, resource: DirectResourceSummary, options: PackageOperationOptions = {}): Promise<DisablePackageResult> {
	return setDirectResourceStateInProject(paths, resource, false, options);
}

export async function enableDirectResourceInProject(paths: ConstructPaths, resource: DirectResourceSummary, options: PackageOperationOptions = {}): Promise<DisablePackageResult> {
	return setDirectResourceStateInProject(paths, resource, true, options);
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
	paths: ConstructPaths,
	input: { source: string; id?: string },
	options: PackageOperationOptions = {},
): Promise<UnloadPackageResult> {
	if (options.projectTrusted === false) return { ok: false, error: "Project is not trusted by Pi; refusing to remove packages from project settings." };
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		return { ok: false, error: `Could not back up .pi/settings.json; aborting remove.\n${error instanceof Error ? error.message : String(error)}` };
	}

	let fallbackWarning: string | undefined;
	try {
		const removed = await removeAndPersistProjectPackage(paths, input.source, options);
		if (!removed) {
			const removedByEdit = await removeMatchingPackageDeclaration(paths, input.source, { backupPath, projectTrusted: options.projectTrusted });
			if (!removedByEdit.removed) {
				return { ok: false, backupPath, error: `No matching package declaration found for ${input.source}.` };
			}
			fallbackWarning = `Pi package manager did not match ${input.source}; removed it by editing .pi/settings.json instead.`;
		}
	} catch (error) {
		try {
			const removedByEdit = await removeMatchingPackageDeclaration(paths, input.source, { backupPath, projectTrusted: options.projectTrusted });
			if (!removedByEdit.removed) {
				return { ok: false, backupPath, error: error instanceof Error ? error.message : String(error) };
			}
			fallbackWarning = `Pi package manager remove failed for ${input.source}; removed it by editing .pi/settings.json instead. ${error instanceof Error ? error.message : String(error)}`;
		} catch (fallbackError) {
			return { ok: false, backupPath, error: `Construct remove failed during fallback settings edit.\n${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}` };
		}
	}

	try {
		const construct = await readJson(paths.projectConstructPath);
		const removedMetadata = await removeMatchingConstructPackageItems(construct, paths, input.source, { id: input.id });
		if (removedMetadata.removed > 0) await writeJson(paths.projectConstructPath, removedMetadata.construct);
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
