import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";

// Fresh, target-scoped Pi trust lookup. Pi remains the trust authority; Construct only
// asks for the current decision and never grants, saves, or models trust itself.
export type TargetTrust = "trusted" | "untrusted" | "unknown";

export interface TargetTrustContext {
	cwd: string;
	isProjectTrusted: () => boolean;
}

async function canonicalProjectPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

async function isSameProject(ctx: TargetTrustContext, targetDir: string): Promise<boolean> {
	const [ctxPath, targetPath] = await Promise.all([canonicalProjectPath(ctx.cwd), canonicalProjectPath(targetDir)]);
	return ctxPath === targetPath;
}

// The current project uses Pi's session decision exclusively (session-only grants are not in
// trust.json, and an explicit current decision is never overridden by a saved parent entry).
// Any other target uses Pi's native saved trust store, including inherited and nearer entries.
export async function targetTrustDecision(ctx: TargetTrustContext | undefined, targetDir: string): Promise<TargetTrust> {
	if (ctx && (await isSameProject(ctx, targetDir))) {
		// Session-only grants live in the ctx decision, so an unreadable current lookup refuses rather
		// than silently falling back to a saved entry.
		try {
			return ctx.isProjectTrusted() ? "trusted" : "untrusted";
		} catch {
			return "unknown";
		}
	}
	try {
		return new ProjectTrustStore(getAgentDir()).get(targetDir) === true ? "trusted" : "untrusted";
	} catch {
		// Malformed or unreadable trust store: refuse rather than assume trusted.
		return "unknown";
	}
}

export class TrustRefusedError extends Error {
	readonly targetDir: string;
	readonly reason: "untrusted" | "unknown";

	constructor(targetDir: string, reason: "untrusted" | "unknown") {
		super(
			reason === "unknown"
				? `Could not read Pi trust state for ${targetDir}; refused to write project files.`
				: `${targetDir} is not trusted by Pi; refused to write project files.`,
		);
		this.name = "TrustRefusedError";
		this.targetDir = targetDir;
		this.reason = reason;
	}
}
