import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths, DirectResourceSummary } from "./types.js";
import { deriveId } from "./catalog.js";
import { readJson, writeJson } from "./json.js";
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

export interface PackageOperationOptions {
	projectTrusted?: boolean;
	quietPackageInstallOutput?: boolean;
}

function projectWriteOptions(options: PackageOperationOptions = {}): PackageOperationOptions {
	return { projectTrusted: options.projectTrusted };
}

function formatSettingsErrors(errors: ReturnType<SettingsManager["drainErrors"]>): string {
	return errors.map((error) => `${error.scope}: ${error.error.message}`).join("\n");
}

const maxQuietCommandOutput = 12_000;

type QuietCommandOptions = { cwd?: string } | undefined;
type QuietCommandHost = { runCommand?: (command: string, args: string[], options?: QuietCommandOptions) => Promise<void> };

function appendBoundedOutput(current: string, chunk: Buffer | string): string {
	const next = current + chunk.toString();
	return next.length > maxQuietCommandOutput ? next.slice(-maxQuietCommandOutput) : next;
}

function redactCommandOutput(text: string): string {
	return text.replace(/(https?:\/\/)([^\s/@]+(?::[^\s/@]*)?@)/gi, "$1[redacted]@").trim();
}

function quietCommandFailureMessage(command: string, args: string[], code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): string {
	const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
	const output = redactCommandOutput([stderr, stdout].filter((part) => part.trim().length > 0).join("\n"));
	const outputNote = output ? `\n${output}` : "";
	const packageManagerName = command.split(/[\\/]/).pop() || command;
	const subcommand = args[0] ? ` ${args[0]}` : "";
	return `${packageManagerName}${subcommand} failed with ${exitStatus}.${outputNote}`;
}

function packageCommandEnv(): NodeJS.ProcessEnv {
	if (process.platform !== "linux" || Object.keys(process.env).length > 0) return process.env;
	try {
		const env: NodeJS.ProcessEnv = {};
		for (const entry of readFileSync("/proc/self/environ", "utf-8").split("\0")) {
			const separator = entry.indexOf("=");
			if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1);
		}
		return env;
	} catch {
		return process.env;
	}
}

function runQuietCommand(command: string, args: string[], options?: QuietCommandOptions): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(command, args, {
			cwd: options?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: packageCommandEnv(),
		});
		child.stdout?.on("data", (chunk) => {
			stdout = appendBoundedOutput(stdout, chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = appendBoundedOutput(stderr, chunk);
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(new Error(quietCommandFailureMessage(command, args, code, signal, stdout, stderr)));
		});
	});
}

function capturePackageManagerCommandOutput(manager: DefaultPackageManager): void {
	// Pi's package manager intentionally inherits git/npm stdio for native CLI installs.
	// Construct TUI progress panels need those child streams captured/drained instead.
	// Keep this shim narrow and remove it if Pi exposes a public quiet install option.
	const host = manager as unknown as QuietCommandHost;
	if (typeof host.runCommand !== "function") return;
	host.runCommand = runQuietCommand;
}

function createProjectPackageManager(paths: ConstructPaths, options: PackageOperationOptions = {}): { manager: DefaultPackageManager; settings: SettingsManager } {
	const agentDir = getAgentDir();
	const settings = SettingsManager.create(paths.cwd, agentDir, { projectTrusted: options.projectTrusted ?? true });
	const loadErrors = settings.drainErrors();
	if (loadErrors.length > 0) throw new Error(`Pi SettingsManager could not read settings.\n${formatSettingsErrors(loadErrors)}`);
	const manager = new DefaultPackageManager({ cwd: paths.cwd, agentDir, settingsManager: settings });
	if (options.quietPackageInstallOutput) capturePackageManagerCommandOutput(manager);
	return { manager, settings };
}

async function flushNativePackageSettings(settings: SettingsManager, action: string): Promise<void> {
	await settings.flush();
	const errors = settings.drainErrors();
	if (errors.length > 0) throw new Error(`Pi SettingsManager could not ${action}.\n${formatSettingsErrors(errors)}`);
}

async function installAndPersistProjectPackage(paths: ConstructPaths, source: string, options: PackageOperationOptions = {}): Promise<void> {
	const { manager, settings } = createProjectPackageManager(paths, options);
	await manager.installAndPersist(source, { local: true });
	await flushNativePackageSettings(settings, "write project package settings");
}

async function removeAndPersistProjectPackage(paths: ConstructPaths, source: string, options: PackageOperationOptions = {}): Promise<boolean> {
	const { manager, settings } = createProjectPackageManager(paths, options);
	const removed = await manager.removeAndPersist(source, { local: true });
	await flushNativePackageSettings(settings, "write project package settings");
	return removed;
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
