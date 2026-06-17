import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConstructPaths } from "./types.js";

export async function getPaths(ctx: Pick<ExtensionCommandContext | ExtensionContext, "cwd">): Promise<ConstructPaths> {
	const cwd = ctx.cwd;
	const realCwd = await realpath(cwd).catch(() => cwd);
	const agentDir = join(homedir(), ".pi", "agent");
	const constructDir = join(agentDir, "construct");
	return {
		cwd,
		realCwd,
		constructDir,
		agentSettingsPath: join(agentDir, "settings.json"),
		userSettingsPath: join(constructDir, "settings.json"),
		userCatalogPath: join(constructDir, "catalog.json"),
		userSkipsPath: join(constructDir, "skips.json"),
		projectSettingsPath: join(cwd, ".pi", "settings.json"),
		projectConstructPath: join(cwd, ".pi", "construct.json"),
	};
}
