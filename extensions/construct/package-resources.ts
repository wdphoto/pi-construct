import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DirectResourceKind } from "./types.js";
import type { ProjectInventory } from "./project-inventory.js";
import { resolveProjectPackageResources, resolveTemporaryPackageResourcesForSources, type ResolvedPackageResources } from "./pi-adapter/package-manager.js";
import { directResourceKinds, directResourceName, resourcePlural } from "./resources.js";
import { normalizeSourceForLibrary, packageSourceIdentityKey, packageSourceMatchValues } from "./sources.js";

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
	packageIdentityKey?: string;
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
			for (const match of await packageSourceMatchValues(source, settingsDir)) ids.set(match, item.metadata.id);
		}
	}
	return ids;
}

function packageRelativePath(resource: ResolvedResource): string {
	if (!resource.metadata.baseDir) return toPosixPath(resource.path);
	return relativeIfInside(resource.metadata.baseDir, resource.path) ?? toPosixPath(resource.path);
}

async function resolvedResourcesForInventory(input: {
	inventory: ProjectInventory;
	resolved: ResolvedPackageResources;
	scope: "project" | "temporary";
}): Promise<PackageResourceSummary[]> {
	const managedIds = await managedPackageIdsBySource(input.inventory);
	const settingsDir = dirname(input.inventory.paths.projectSettingsPath);
	const resources: PackageResourceSummary[] = [];
	for (const kind of directResourceKinds) {
		for (const entry of input.resolved[resolvedResourceKeys[kind]]) {
			if (entry.metadata.origin !== "package" || entry.metadata.scope !== input.scope) continue;
			const normalizedSource = await normalizeSourceForLibrary(entry.metadata.source, settingsDir);
			const sourceMatches = await packageSourceMatchValues(entry.metadata.source, settingsDir);
			if (sourceMatches.some((source) => input.inventory.packageSources.projectOverrideSources.has(source))) continue;
			const identityKey = packageSourceIdentityKey(entry.metadata.source, normalizedSource);
			const managedId = managedIds.get(entry.metadata.source) ?? managedIds.get(normalizedSource) ?? (identityKey ? managedIds.get(identityKey) : undefined);
			const relativePath = packageRelativePath(entry);
			resources.push({
				packageSource: entry.metadata.source,
				packageNormalizedSource: normalizedSource === entry.metadata.source ? undefined : normalizedSource,
				packageIdentityKey: identityKey,
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
	return resources;
}

function resourceMatchesManagedPackage(resource: PackageResourceSummary, item: ProjectInventory["managedPackages"][number]): boolean {
	return (
		resource.packageManagedId === item.metadata.id ||
		item.matchSources.includes(resource.packageSource) ||
		(resource.packageNormalizedSource !== undefined && item.matchSources.includes(resource.packageNormalizedSource)) ||
		(resource.packageIdentityKey !== undefined && item.matchSources.includes(resource.packageIdentityKey))
	);
}

function projectGitPackageRoot(cwd: string, source: string): string | undefined {
	const identity = packageSourceIdentityKey(source);
	if (!identity?.startsWith("git:")) return undefined;
	const path = identity.slice("git:".length);
	if (!path.includes("/")) return undefined;
	return join(cwd, ".pi", "git", ...path.split("/"));
}

function findNonPiSkillFiles(root: string): string[] {
	const found: string[] = [];
	const visit = (dir: string, depth: number) => {
		if (depth > 4 || found.length >= 6) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry === ".git" || entry === "node_modules" || entry === "skills") continue;
			const path = join(dir, entry);
			let stat;
			try {
				stat = statSync(path);
			} catch {
				continue;
			}
			if (stat.isDirectory()) visit(path, depth + 1);
			else if (entry === "SKILL.md") {
				const rel = relativeIfInside(root, path);
				if (rel) found.push(rel);
			}
		}
	};
	if (existsSync(root)) visit(root, 0);
	return found;
}

function zeroResourcePackageWarning(inventory: ProjectInventory, item: ProjectInventory["managedPackages"][number]): string {
	const root = projectGitPackageRoot(inventory.paths.cwd, item.source);
	const skillFiles = root ? findNonPiSkillFiles(root) : [];
	const candidates = skillFiles.length > 0 ? ` Found non-Pi skill files: ${skillFiles.slice(0, 3).join(", ")}${skillFiles.length > 3 ? ", …" : ""}.` : "";
	return (
		`${item.metadata.id}: package is declared in this project, but Pi resolved no package resources from ${item.source}.` +
		candidates +
		" Do not patch .pi/git; pi update --extensions can reset it. Keep the upstream package declared for updates and add project-local direct skill entries or a wrapper manifest; re-check paths after updates."
	);
}

function declaredManagedPackageResourceWarnings(inventory: ProjectInventory, resources: PackageResourceSummary[]): string[] {
	const warnings: string[] = [];
	for (const item of inventory.managedPackages) {
		if (!item.declared) continue;
		if (resources.some((resource) => resourceMatchesManagedPackage(resource, item))) continue;
		warnings.push(zeroResourcePackageWarning(inventory, item));
	}
	return warnings;
}

export async function collectProjectPackageResources(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, inventory: ProjectInventory): Promise<PackageResourceInventory> {
	const warnings: string[] = [];
	if (!ctx.isProjectTrusted() && inventory.packageDeclarations.length > 0) {
		return { resources: [], warnings: ["Project package resources were not inspected because the project is not trusted by Pi."] };
	}
	let resolved: ResolvedPackageResources;
	try {
		const result = await resolveProjectPackageResources(inventory.paths, ctx.isProjectTrusted());
		resolved = result.resolved;
		warnings.push(...result.settingsErrors.map((error) => `Pi settings were not fully loaded for package resource inventory: ${error}`));
	} catch (error) {
		return { resources: [], warnings: [`Could not inspect project package resources: ${error instanceof Error ? error.message : String(error)}`] };
	}

	const resources = await resolvedResourcesForInventory({ inventory, resolved, scope: "project" });
	warnings.push(...declaredManagedPackageResourceWarnings(inventory, resources));
	return { resources, warnings };
}

export async function collectTemporaryPackageResourcesForSources(
	ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">,
	inventory: ProjectInventory,
	sources: string[],
	options: { cacheOnly?: boolean } = {},
): Promise<PackageResourceInventory> {
	const uniqueSources = [...new Set(sources.filter((source) => source.trim().length > 0))];
	if (uniqueSources.length === 0) return { resources: [], warnings: [] };
	if (!ctx.isProjectTrusted()) {
		return { resources: [], warnings: ["Available package resources were not inspected because the project is not trusted by Pi."] };
	}

	const warnings: string[] = [];
	let resolved: ResolvedPackageResources;
	try {
		const result = await resolveTemporaryPackageResourcesForSources(inventory.paths, ctx.isProjectTrusted(), uniqueSources, options);
		resolved = result.resolved;
		warnings.push(...result.settingsErrors.map((error) => `Pi settings were not fully loaded for available package resource inventory: ${error}`));
	} catch (error) {
		return { resources: [], warnings: [`Could not inspect available package resources: ${error instanceof Error ? error.message : String(error)}`] };
	}

	return { resources: await resolvedResourcesForInventory({ inventory, resolved, scope: "temporary" }), warnings };
}
