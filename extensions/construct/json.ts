import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JsonObject, JsonReadResult } from "./types.js";

export function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(path: string): Promise<JsonReadResult> {
	if (!existsSync(path)) return { state: "missing", path };
	try {
		const text = await readFile(path, "utf8");
		return { state: "ok", path, data: JSON.parse(text) as unknown };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { state: "invalid", path, error: message };
	}
}

export async function writeJson(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function describeRead(result: JsonReadResult): string {
	if (result.state === "ok") return `present: ${result.path}`;
	if (result.state === "missing") return `missing: ${result.path}`;
	return `invalid: ${result.path} (${result.error})`;
}
