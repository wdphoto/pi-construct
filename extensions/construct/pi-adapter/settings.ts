import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ProjectSettingsOptions {
	projectTrusted?: boolean;
}

export function formatSettingsErrors(errors: ReturnType<SettingsManager["drainErrors"]>): string {
	return errors.map((error) => `${error.scope}: ${error.error.message}`).join("\n");
}

export function drainSettingsErrorMessages(settings: SettingsManager): string[] {
	return settings.drainErrors().map((error) => `${error.scope}: ${error.error.message}`);
}

export function createProjectSettingsManager(cwd: string, options: ProjectSettingsOptions = {}): SettingsManager {
	const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: options.projectTrusted ?? true });
	const loadErrors = settings.drainErrors();
	if (loadErrors.length > 0) throw new Error(`Pi SettingsManager could not read settings.\n${formatSettingsErrors(loadErrors)}`);
	return settings;
}

export function createProjectSettingsManagerForInspection(cwd: string, options: ProjectSettingsOptions = {}): SettingsManager {
	return SettingsManager.create(cwd, getAgentDir(), { projectTrusted: options.projectTrusted ?? true });
}

export async function flushProjectSettings(settings: SettingsManager, action: string): Promise<void> {
	await settings.flush();
	const errors = settings.drainErrors();
	if (errors.length > 0) throw new Error(`Pi SettingsManager could not ${action}.\n${formatSettingsErrors(errors)}`);
}
