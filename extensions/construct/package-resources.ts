import { dirname, isAbsolute, relative, sep } from "node:path";
import { DefaultPackageManager, getAgentDir, SettingsManager, type ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DirectResourceKind } from "./types.js";
import type { ProjectInventory } from "./project-inventory.js";
import { directResourceKinds, directResourceName, resourcePlural } from "./resources.js";
import { normalizeSourceForLibrary } from "./sources.js";

const resolvedResourceKeys = {
	extension: "extensions",
	skill: "skills",
	prompt: "prompts",
	theme: "themes",
} as const;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function relativeIfInside(base: string, path: string): string | undefined {
	const rel = relative(base, path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return toPosixPath(rel);
}

export interface PackageResourceSummary {
	packageSource: string;
	packageNormalizedSource?: string;
	packageManagedId?: string;
	packageManaged: boolean;
	kind: DirectResourceKind;
	name: string;
	path: string;
	packageRelativePath: string;
	enabled: boolean;
}

export interface PackageResourceInventory {
	resources: PackageResourceSummary[];
	warnings: string[];
}

async function managedPackageIdsBySource(inventory: ProjectInventory): Promise<Map<string, string>> {
	const ids = new Map<string, string>();
	const settingsDir = dirname(inventory.paths.projectSettingsPath);
	for (const item of inventory.managedPackages) {
		for (const source of item.matchSources) {
			ids.set(source, item.metadata.id);
			ids.set(await normalizeSourceForLibrary(source, settingsDir), item.metadata.id);
		}
	}
	return ids;
}

function packageRelativePath(resource: ResolvedResource): string {
	if (!resource.metadata.baseDir) return toPosixPath(resource.path);
	return relativeIfInside(resource.metadata.baseDir, resource.path) ?? toPosixPath(resource.path);
}

export async function collectProjectPackageResources(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, inventory: ProjectInventory): Promise<PackageResourceInventory> {
	const warnings: string[] = [];
	if (!ctx.isProjectTrusted() && inventory.packageDeclarations.length > 0) {
		return { resources: [], warnings: ["Project package resources were not inspected because the project is not trusted by Pi."] };
	}
	const managedIds = await managedPackageIdsBySource(inventory);
	let resolved: Awaited<ReturnType<DefaultPackageManager["resolve"]>>;
	try {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(inventory.paths.cwd, agentDir, { projectTrusted: ctx.isProjectTrusted() });
		const packageManager = new DefaultPackageManager({ cwd: inventory.paths.cwd, agentDir, settingsManager });
		resolved = await packageManager.resolve(async () => "skip");
		const errors = settingsManager.drainErrors();
		warnings.push(...errors.map((error) => `Pi ${error.scope} settings were not fully loaded for package resource inventory: ${error.error.message}`));
	} catch (error) {
		return { resources: [], warnings: [`Could not inspect project package resources: ${error instanceof Error ? error.message : String(error)}`] };
	}

	const settingsDir = dirname(inventory.paths.projectSettingsPath);
	const resources: PackageResourceSummary[] = [];
	for (const kind of directResourceKinds) {
		for (const entry of resolved[resolvedResourceKeys[kind]]) {
			if (entry.metadata.origin !== "package" || entry.metadata.scope !== "project") continue;
			const normalizedSource = await normalizeSourceForLibrary(entry.metadata.source, settingsDir);
			const managedId = managedIds.get(entry.metadata.source) ?? managedIds.get(normalizedSource);
			const relativePath = packageRelativePath(entry);
			resources.push({
				packageSource: entry.metadata.source,
				packageNormalizedSource: normalizedSource === entry.metadata.source ? undefined : normalizedSource,
				packageManagedId: managedId,
				packageManaged: managedId !== undefined,
				kind,
				name: directResourceName(kind, relativePath),
				path: toPosixPath(entry.path),
				packageRelativePath: relativePath,
				enabled: entry.enabled,
			});
		}
	}
	resources.sort(
		(a, b) =>
			a.packageSource.localeCompare(b.packageSource) ||
			resourcePlural(a.kind).localeCompare(resourcePlural(b.kind)) ||
			a.name.localeCompare(b.name) ||
			a.packageRelativePath.localeCompare(b.packageRelativePath),
	);
	return { resources, warnings };
}
