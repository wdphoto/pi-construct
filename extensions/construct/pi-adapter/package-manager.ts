import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { DefaultPackageManager, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "../types.js";
import { createProjectSettingsManager, createProjectSettingsManagerForInspection, drainSettingsErrorMessages, flushProjectSettings, type ProjectSettingsOptions } from "./settings.js";

export interface ProjectPackageManagerOptions extends ProjectSettingsOptions {
	quietPackageInstallOutput?: boolean;
}

export type ResolvedPackageResources = Awaited<ReturnType<DefaultPackageManager["resolve"]>>;

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

export function createProjectPackageManager(
	paths: ConstructPaths,
	options: ProjectPackageManagerOptions = {},
): { manager: DefaultPackageManager; settings: SettingsManager } {
	const settings = createProjectSettingsManager(paths.cwd, options);
	const manager = new DefaultPackageManager({ cwd: paths.cwd, agentDir: getAgentDir(), settingsManager: settings });
	if (options.quietPackageInstallOutput) capturePackageManagerCommandOutput(manager);
	return { manager, settings };
}

export async function installAndPersistProjectPackage(paths: ConstructPaths, source: string, options: ProjectPackageManagerOptions = {}): Promise<void> {
	const { manager, settings } = createProjectPackageManager(paths, options);
	await manager.installAndPersist(source, { local: true });
	await flushProjectSettings(settings, "write project package settings");
}

export async function removeAndPersistProjectPackage(paths: ConstructPaths, source: string, options: ProjectPackageManagerOptions = {}): Promise<boolean> {
	const { manager, settings } = createProjectPackageManager(paths, options);
	const removed = await manager.removeAndPersist(source, { local: true });
	await flushProjectSettings(settings, "write project package settings");
	return removed;
}

export async function resolveProjectPackageResources(paths: ConstructPaths, projectTrusted: boolean): Promise<{ resolved: ResolvedPackageResources; settingsErrors: string[] }> {
	const settings = createProjectSettingsManagerForInspection(paths.cwd, { projectTrusted });
	const manager = new DefaultPackageManager({ cwd: paths.cwd, agentDir: getAgentDir(), settingsManager: settings });
	const resolved = await manager.resolve(async () => "skip");
	return { resolved, settingsErrors: drainSettingsErrorMessages(settings) };
}

async function withPiOffline<T>(enabled: boolean, operation: () => Promise<T>): Promise<T> {
	if (!enabled) return operation();
	const previous = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	try {
		return await operation();
	} finally {
		if (previous === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = previous;
	}
}

export async function resolveTemporaryPackageResourcesForSources(
	paths: ConstructPaths,
	projectTrusted: boolean,
	sources: string[],
	options: { cacheOnly?: boolean } = {},
): Promise<{ resolved: ResolvedPackageResources; settingsErrors: string[] }> {
	const settings = createProjectSettingsManagerForInspection(paths.cwd, { projectTrusted });
	const manager = new DefaultPackageManager({ cwd: paths.cwd, agentDir: getAgentDir(), settingsManager: settings });
	const resolved = await withPiOffline(options.cacheOnly === true, () => manager.resolveExtensionSources(sources, { temporary: true }));
	return { resolved, settingsErrors: drainSettingsErrorMessages(settings) };
}
