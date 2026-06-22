import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
	const targetPath = await realpath(path).catch(() => path);
	const dir = dirname(targetPath);
	await mkdir(dir, { recursive: true });
	const tempPath = join(dir, `.${basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
	const existingMode = await stat(targetPath).then((info) => info.mode).catch(() => undefined);
	const file = await open(tempPath, "wx");
	try {
		await file.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
		await file.sync();
	} catch (error) {
		await file.close().catch(() => undefined);
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw error;
	}
	await file.close();
	try {
		if (existingMode !== undefined) await chmod(tempPath, existingMode);
		await rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export function describeRead(result: JsonReadResult): string {
	if (result.state === "ok") return `present: ${result.path}`;
	if (result.state === "missing") return `missing: ${result.path}`;
	return `invalid: ${result.path} (${result.error})`;
}
