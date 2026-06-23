import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readConstructVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const packageJsonPath = join(here, "..", "..", "package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
		return typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "unknown";
	} catch {
		return "unknown";
	}
}

export const CONSTRUCT_VERSION = readConstructVersion();
export const CONSTRUCT_TITLE = `pi-construct@${CONSTRUCT_VERSION}`;
