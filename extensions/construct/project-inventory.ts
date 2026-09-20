import { dirname } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths, JsonReadResult, ManagedItemSummary, PackageDeclarationSummary } from "./types.js";
import { parseCatalog } from "./catalog.js";
import { readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { applyDirectResourceDrift, collectPackageSourceSets, getManagedItems, getPackages, type PackageSourceSets } from "./project-settings.js";
import { parseKnownProjects } from "./projects.js";
import { collectDirectProjectResources } from "./resources.js";
import { effectivePackageState, type EffectivePackageState } from "./effective-state.js";
import type { PackageResourceInventory } from "./package-resources.js";
import { packageSkillRepositoryFor, skillRepositoryState } from "./skill-repositories.js";
import { normalizeSourceForLibrary, packageSourceMatchValues } from "./sources.js";

export type InventoryPackageState = "active" | "disabled" | "available" | "unloaded";

export interface ManagedPackageInventoryItem {
	metadata: ManagedItemSummary & { source: string };
	source: string;
	matchSources: string[];
	declared: boolean;
	projectOverride: boolean;
	disabledByFilters: boolean;
	filterState?: PackageDeclarationSummary["filterState"];
	filterDescription?: string;
	state: Exclude<InventoryPackageState, "unloaded">;
	effectiveState: EffectivePackageState;
	/** True when Pi resolved zero native resources but a discovered Agent Skills adapter owns this package. */
	skillCarrier?: boolean;
	drift?: string;
}

export interface UnloadedPackageInventoryItem {
	declaration: PackageDeclarationSummary;
	rawSource: string;
	source: string;
	matchSources: string[];
	projectOverride: boolean;
	disabledByFilters?: boolean;
	filterState?: PackageDeclarationSummary["filterState"];
	filterDescription?: string;
	effectiveState: EffectivePackageState;
	skillCarrier?: boolean;
}

export interface ProjectInventory {
	paths: ConstructPaths;
	reads: {
		userCatalog: JsonReadResult;
		userProjects: JsonReadResult;
		projectSettings: JsonReadResult;
		projectConstruct: JsonReadResult;
	};
	catalog: ReturnType<typeof parseCatalog>;
	knownProjects: ReturnType<typeof parseKnownProjects>;
	packageDeclarations: PackageDeclarationSummary[];
	projectOverrides: PackageDeclarationSummary[];
	packageSources: PackageSourceSets;
	managedItems: ManagedItemSummary[];
	managedPackages: ManagedPackageInventoryItem[];
	availableCatalogPackages: CatalogItem[];
	unloadedPackageDeclarations: UnloadedPackageInventoryItem[];
	directResources: Awaited<ReturnType<typeof collectDirectProjectResources>>;
}

function managedPackageSources(item: ManagedItemSummary & { source: string }): string[] {
	return item.matchSources ?? [item.source];
}

function packageState(declared: boolean, disabledByFilters: boolean): ManagedPackageInventoryItem["state"] {
	if (!declared) return "available";
	return disabledByFilters ? "disabled" : "active";
}

export async function collectProjectInventory(ctx: Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted">, options: { directResources?: boolean } = {}): Promise<ProjectInventory> {
	const paths = await getPaths(ctx);
	const [userCatalog, userProjects, projectSettings, projectConstruct] = await Promise.all([
		readJson(paths.userCatalogPath),
		readJson(paths.userProjectsPath),
		readJson(paths.projectSettingsPath),
		readJson(paths.projectConstructPath),
	]);

	const catalog = parseCatalog(userCatalog);
	const knownProjects = parseKnownProjects(userProjects);
	const packageDeclarations = getPackages(projectSettings);
	const settingsDir = dirname(paths.projectSettingsPath);
	const packageSources = await collectPackageSourceSets(packageDeclarations, settingsDir);
	const packageDeclarationsByMatch = new Map<string, PackageDeclarationSummary>();
	for (const declaration of packageDeclarations) {
		if (declaration.form === "invalid" || !declaration.source.trim()) continue;
		for (const match of await packageSourceMatchValues(declaration.source, settingsDir)) packageDeclarationsByMatch.set(match, declaration);
	}
	const directResources = options.directResources === false ? { resources: [], warnings: [] } : await collectDirectProjectResources(ctx, paths, projectConstruct);
	const rawManagedItems = await getManagedItems(projectConstruct, packageSources.declaredSources, paths, packageSources.disabledSources, packageSources.projectOverrideSources);
	const managedItems = options.directResources === false ? rawManagedItems : applyDirectResourceDrift(rawManagedItems, directResources.resources);
	const managedPackages = managedItems
		.filter((item): item is ManagedItemSummary & { source: string } => item.kind === "package" && typeof item.source === "string" && item.source.length > 0)
		.map((metadata): ManagedPackageInventoryItem => {
			const matchSources = managedPackageSources(metadata);
			const declared = matchSources.some((candidate) => packageSources.declaredSources.has(candidate));
			const projectOverride = matchSources.some((candidate) => packageSources.projectOverrideSources.has(candidate));
			const disabledByFilters = matchSources.some((candidate) => packageSources.disabledSources.has(candidate));
			const declaration = matchSources.map((match) => packageDeclarationsByMatch.get(match)).find((pkg): pkg is PackageDeclarationSummary => pkg !== undefined);
			return {
				metadata,
				source: metadata.source,
				matchSources,
				declared,
				projectOverride,
				disabledByFilters,
				filterState: declaration?.filterState,
				filterDescription: declaration?.filterDescription,
				state: packageState(declared, disabledByFilters),
				effectiveState: "unknown",
				drift: metadata.drift,
			};
		});
	const managedSources = new Set(managedPackages.flatMap((item) => item.matchSources));
	const availableCatalogPackages: CatalogItem[] = [];
	for (const item of catalog.data.items) {
		const matches = await packageSourceMatchValues(item.source, settingsDir);
		if (!matches.some((match) => managedSources.has(match) || packageSources.declaredSources.has(match) || packageSources.projectOverrideSources.has(match))) availableCatalogPackages.push(item);
	}
	const unloadedPackageDeclarations: UnloadedPackageInventoryItem[] = [];
	for (const declaration of packageDeclarations) {
		if (declaration.form === "invalid" || !declaration.enabled || !declaration.source.trim()) continue;
		if (declaration.projectOverride) continue;
		const source = await normalizeSourceForLibrary(declaration.source, settingsDir);
		const matchSources = await packageSourceMatchValues(declaration.source, settingsDir);
		if (matchSources.some((match) => managedSources.has(match))) continue;
		unloadedPackageDeclarations.push({
			declaration,
			rawSource: declaration.source,
			source,
			matchSources,
			projectOverride: false,
			disabledByFilters: declaration.disabledByFilters,
			filterState: declaration.filterState,
			filterDescription: declaration.filterDescription,
			effectiveState: "unknown",
		});
	}
	return {
		paths,
		reads: { userCatalog, userProjects, projectSettings, projectConstruct },
		catalog,
		knownProjects,
		packageDeclarations,
		projectOverrides: packageDeclarations.filter((declaration) => declaration.projectOverride),
		packageSources,
		managedItems,
		managedPackages,
		availableCatalogPackages,
		unloadedPackageDeclarations,
		directResources,
	};
}

/**
 * Return a copy of the inventory whose package rows carry effective state decoded
 * from Pi's resolved project package resources and discovered Agent Skills
 * repositories. Keeps declaration policy (`state`, `disabledByFilters`,
 * `filterState`) untouched; callers combine the two explicitly.
 */
export function withEffectivePackageStates(inventory: ProjectInventory, packageResources: PackageResourceInventory): ProjectInventory {
	return {
		...inventory,
		managedPackages: inventory.managedPackages.map((item) => {
			const repository = packageSkillRepositoryFor(packageResources.skillRepositories ?? [], { source: item.source, matchSources: item.matchSources });
			const repositoryState = repository ? skillRepositoryState(repository) : undefined;
			const effectiveState: EffectivePackageState = repositoryState === "active" ? "active" : repositoryState === "inactive" ? "inactive" : effectivePackageState(packageResources.resources, { id: item.metadata.id, matchSources: item.matchSources });
			return { ...item, effectiveState, skillCarrier: repository !== undefined };
		}),
		unloadedPackageDeclarations: inventory.unloadedPackageDeclarations.map((item) => {
			const repository = packageSkillRepositoryFor(packageResources.skillRepositories ?? [], { source: item.source, matchSources: item.matchSources });
			const repositoryState = repository ? skillRepositoryState(repository) : undefined;
			// A discovered unloaded carrier follows its linked skill state (inactive when nothing is
			// linked) instead of Pi's zero-resolved-resource "unknown", so save/run treat it as an
			// Agent Skills carrier rather than an unresolved declaration.
			const effectiveState: EffectivePackageState = repositoryState === "active" ? "active" : repositoryState === "inactive" ? "inactive" : effectivePackageState(packageResources.resources, { matchSources: item.matchSources });
			return { ...item, effectiveState, skillCarrier: repository !== undefined };
		}),
	};
}
