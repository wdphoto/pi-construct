import { dirname, isAbsolute, relative, sep } from "node:path";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DirectResourceKind } from "./types.js";
import type { ProjectInventory } from "./project-inventory.js";
import { resolveProjectPackageResources, resolveTemporaryPackageResourcesForSources, type ResolvedPackageResources } from "./pi-adapter/package-manager.js";
import { directResourceKinds, directResourceName, resourcePlural } from "./resources.js";
import { normalizeSourceForLibrary, packageSourceIdentityKey, packageSourceMatchValues } from "./sources.js";
import { discoverPackageSkillRepository, discoverTemporaryPackageSkillRepository, type PackageSkillRepository } from "./skill-repositories.js";

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

export interface PackageSkillInspection {
	source: string;
	/** Canonical source match values so equivalent spellings resolve to the same inspection. */
	matchSources: string[];
	/** True when a real checkout was located and inspected (even if no adapter was found). */
	inspected: boolean;
	/** True when a discovered Agent Skills repository was produced. */
	adapter: boolean;
}

export interface PackageResourceInventory {
	resources: PackageResourceSummary[];
	warnings: string[];
	skillRepositories: PackageSkillRepository[];
	/** Per-source authoritative inspection state; absent sources are "no opinion". */
	skillInspections: PackageSkillInspection[];
}

/** Look up the authoritative Agent Skills inspection for a package source, by canonical identity. */
export function skillInspectionFor(inventory: PackageResourceInventory, target: { source: string; matchSources: Iterable<string> }): PackageSkillInspection | undefined {
	const wanted = new Set<string>([target.source, ...target.matchSources]);
	return inventory.skillInspections.find(
		(inspection) => inspection.source === target.source || wanted.has(inspection.source) || inspection.matchSources.some((match) => wanted.has(match)),
	);
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

export interface PackageResourceMatchTarget {
	id?: string;
	matchSources: Iterable<string>;
}

export function packageResourceMatches(resource: PackageResourceSummary, target: PackageResourceMatchTarget): boolean {
	const sources = target.matchSources instanceof Set ? target.matchSources : new Set(target.matchSources);
	return (
		(target.id !== undefined && resource.packageManagedId === target.id) ||
		sources.has(resource.packageSource) ||
		(resource.packageNormalizedSource !== undefined && sources.has(resource.packageNormalizedSource)) ||
		(resource.packageIdentityKey !== undefined && sources.has(resource.packageIdentityKey))
	);
}

function resourceMatchesManagedPackage(resource: PackageResourceSummary, item: ProjectInventory["managedPackages"][number]): boolean {
	return packageResourceMatches(resource, { id: item.metadata.id, matchSources: item.matchSources });
}

async function discoverSkillRepositories(inventory: ProjectInventory, resources: PackageResourceSummary[], projectTrusted: boolean): Promise<{ repositories: PackageSkillRepository[]; inspections: PackageSkillInspection[]; diagnostics: string[] }> {
	const repositories: PackageSkillRepository[] = [];
	const inspections: PackageSkillInspection[] = [];
	const diagnostics: string[] = [];
	const settingsDir = dirname(inventory.paths.projectSettingsPath);
	const record = async (source: string, discovery: Awaited<ReturnType<typeof discoverPackageSkillRepository>>): Promise<void> => {
		const matchSources = await packageSourceMatchValues(source, settingsDir);
		inspections.push({ source, matchSources, inspected: discovery.inspected, adapter: discovery.repository !== undefined });
		if (discovery.repository) repositories.push(discovery.repository);
	};
	for (const item of inventory.managedPackages) {
		if (!item.declared || item.projectOverride) continue;
		if (resources.some((resource) => resourceMatchesManagedPackage(resource, item))) continue;
		const discovery = await discoverPackageSkillRepository(inventory.paths, item.source, inventory.directResources.resources, { projectTrusted });
		await record(item.source, discovery);
		diagnostics.push(...discovery.diagnostics.map((diagnostic) => `${item.metadata.id}: ${diagnostic}`));
	}
	// /construct load must inspect not-yet-adopted declarations too. Otherwise its first adoption
	// cannot remember a carrier inventory and can misoffer linked carrier skills as direct resources.
	for (const item of inventory.unloadedPackageDeclarations) {
		if (item.projectOverride) continue;
		if (resources.some((resource) => packageResourceMatches(resource, { matchSources: item.matchSources }))) continue;
		const discovery = await discoverPackageSkillRepository(inventory.paths, item.source, inventory.directResources.resources, { projectTrusted });
		await record(item.source, discovery);
		diagnostics.push(...discovery.diagnostics.map((diagnostic) => `${item.source}: ${diagnostic}`));
	}
	return { repositories, inspections, diagnostics };
}

function declaredManagedPackageResourceWarnings(
	inventory: ProjectInventory,
	resources: PackageResourceSummary[],
	skillRepositories: PackageSkillRepository[],
): string[] {
	const warnings: string[] = [];
	for (const item of inventory.managedPackages) {
		if (!item.declared) continue;
		if (resources.some((resource) => resourceMatchesManagedPackage(resource, item))) continue;
		const repository = skillRepositories.find((candidate) => candidate.source === item.source);
		if (repository) {
			const linked = repository.skills.filter((skill) => skill.linked).length;
			warnings.push(`${item.metadata.id}: Pi resolves no native package resources, but Construct found ${repository.skills.length} Agent Skill${repository.skills.length === 1 ? "" : "s"}${linked > 0 ? ` (${linked} linked through project skill settings)` : " ready to link"}. The Git package remains declared so pi update --extensions can update it.`);
			continue;
		}
		warnings.push(`${item.metadata.id}: package is declared in this project, but Pi resolved no package resources from ${item.source}. Do not patch .pi/git; keep the upstream package declared so pi update --extensions can update it, and inspect the declaration with pi config -l.`);
	}
	return warnings;
}

export async function collectProjectPackageResources(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, inventory: ProjectInventory): Promise<PackageResourceInventory> {
	const warnings: string[] = [];
	if (!ctx.isProjectTrusted() && inventory.packageDeclarations.length > 0) {
		return { resources: [], warnings: ["Project package resources were not inspected because the project is not trusted by Pi."], skillRepositories: [], skillInspections: [] };
	}
	let resolved: ResolvedPackageResources;
	try {
		const result = await resolveProjectPackageResources(inventory.paths, ctx.isProjectTrusted());
		resolved = result.resolved;
		warnings.push(...result.settingsErrors.map((error) => `Pi settings were not fully loaded for package resource inventory: ${error}`));
	} catch (error) {
		// Resolver-level failure: no source was authoritatively inspected, so keep it as no opinion.
		return { resources: [], warnings: [`Could not inspect project package resources: ${error instanceof Error ? error.message : String(error)}`], skillRepositories: [], skillInspections: [] };
	}

	const resources = await resolvedResourcesForInventory({ inventory, resolved, scope: "project" });
	const skillDiscovery = await discoverSkillRepositories(inventory, resources, ctx.isProjectTrusted());
	warnings.push(...skillDiscovery.diagnostics);
	warnings.push(...declaredManagedPackageResourceWarnings(inventory, resources, skillDiscovery.repositories));
	return { resources, warnings, skillRepositories: skillDiscovery.repositories, skillInspections: skillDiscovery.inspections };
}

/**
 * Cache-only, offline native package-resource preview for Available catalog sources. It never
 * installs, clones, fetches, inspects other projects, or persists data. Agent Skills use a
 * validated catalog snapshot when present; otherwise, a read-only temporary-cache inventory may
 * be shown. Cached inventories can be stale, and no project checkout is inspected here.
 */
export async function collectTemporaryPackageResourcesForSources(
	ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">,
	inventory: ProjectInventory,
	sources: string[],
	options: { cacheOnly?: boolean } = {},
): Promise<PackageResourceInventory> {
	const uniqueSources = [...new Set(sources.filter((source) => source.trim().length > 0))];
	if (uniqueSources.length === 0) return { resources: [], warnings: [], skillRepositories: [], skillInspections: [] };
	if (!ctx.isProjectTrusted()) {
		return { resources: [], warnings: ["Available package resources were not inspected because the project is not trusted by Pi."], skillRepositories: [], skillInspections: [] };
	}

	const warnings: string[] = [];
	let resolved: ResolvedPackageResources;
	try {
		const result = await resolveTemporaryPackageResourcesForSources(inventory.paths, ctx.isProjectTrusted(), uniqueSources, options);
		resolved = result.resolved;
		warnings.push(...result.settingsErrors.map((error) => `Pi settings were not fully loaded for available package resource inventory: ${error}`));
	} catch (error) {
		return { resources: [], warnings: [`Could not inspect available package resources: ${error instanceof Error ? error.message : String(error)}`], skillRepositories: [], skillInspections: [] };
	}

	const temporaryResources = await resolvedResourcesForInventory({ inventory, resolved, scope: "temporary" });
	// Available Agent Skills fall back to a cache-only, offline inspection of Pi's temporary checkout
	// when the source resolves no native resources. The read-only, non-persistent cache may be stale;
	// validated catalog snapshots take priority in the dashboard, while Pi-native resources always win.
	// This never installs, clones, fetches, or inspects another project's `.pi` checkout.
	const skillRepositories: PackageSkillRepository[] = [];
	if (options.cacheOnly === true) {
		const settingsDir = dirname(inventory.paths.projectSettingsPath);
		for (const source of uniqueSources) {
			const matchSources = await packageSourceMatchValues(source, settingsDir);
			if (temporaryResources.some((resource) => packageResourceMatches(resource, { matchSources }))) continue;
			const discovery = discoverTemporaryPackageSkillRepository(inventory.paths, source);
			warnings.push(...discovery.diagnostics);
			if (discovery.repository) skillRepositories.push(discovery.repository);
		}
	}
	return { resources: temporaryResources, warnings, skillRepositories, skillInspections: [] };
}
