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
} from "./project-settings.js";
import { updateConstructItemEnabled } from "./metadata.js";

export interface LoadPackageResult {
	ok: boolean;
	itemId?: string;
	declaredSource?: string;
	backupPath?: string;
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
	const itemId = input.item?.managed ? input.item.id : uniqueManagedId(input.item?.id ?? deriveId(input.source), constructRead, declaredSource);
	try {
		const construct = upsertConstructItem(parseProjectConstruct(constructRead), itemId, declaredSource, input.source, paths);
		await writeJson(paths.projectConstructPath, construct);
	} catch (error) {
		return {
			ok: false,
			backupPath,
			declaredSource,
			itemId,
			metadataOnlyFailure: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	return { ok: true, itemId, declaredSource, backupPath };
}

export interface UnloadPackageResult {
	ok: boolean;
	backupPath?: string;
	fallbackWarning?: string;
	error?: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	metadataOnlyFailure?: boolean;
}

export async function unloadPackageFromProject(
	pi: ExtensionAPI,
	paths: ConstructPaths,
	input: { source: string; id?: string },
): Promise<UnloadPackageResult> {
	let backupPath: string | undefined;
	try {
		backupPath = await backupProjectSettingsIfPresent(paths);
	} catch (error) {
		return { ok: false, error: `Could not back up .pi/settings.json; aborting unload.\n${error instanceof Error ? error.message : String(error)}` };
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
			return { ok: false, backupPath, error: `Construct unload failed during fallback settings edit.\n${error instanceof Error ? error.message : String(error)}` };
		}
	}

	if (input.id) {
		try {
			const construct = await readJson(paths.projectConstructPath);
			await writeJson(paths.projectConstructPath, updateConstructItemEnabled(construct, input.id, false));
		} catch (error) {
			return {
				ok: false,
				backupPath,
				fallbackWarning,
				metadataOnlyFailure: true,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	return { ok: true, backupPath, fallbackWarning };
}
