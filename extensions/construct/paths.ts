import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "./types.js";

export async function getPaths(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<ConstructPaths> {
	const cwd = ctx.cwd;
	const realCwd = await realpath(cwd).catch(() => cwd);
	const agentDir = getAgentDir();
	const constructDir = join(agentDir, "construct");
	return {
		cwd,
		realCwd,
		constructDir,
		userCatalogPath: join(constructDir, "catalog.json"),
		userSettingsPath: join(constructDir, "settings.json"),
		projectSettingsPath: join(cwd, CONFIG_DIR_NAME, "settings.json"),
		projectConstructPath: join(cwd, CONFIG_DIR_NAME, "construct.json"),
	};
}
