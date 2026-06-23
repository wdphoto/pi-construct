import { dirname } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, ConstructPaths, JsonReadResult, ManagedItemSummary, PackageDeclarationSummary } from "./types.js";
import { parseCatalog } from "./catalog.js";
import { readJson } from "./json.js";
import { getPaths } from "./paths.js";
import { collectPackageSourceSets, getManagedItems, getPackages, type PackageSourceSets } from "./project-settings.js";
import { parseKnownProjects } from "./projects.js";
import { collectDirectProjectResources } from "./resources.js";
import { normalizeSourceForLibrary } from "./sources.js";

export type InventoryPackageState = "active" | "disabled" | "available" | "unloaded";

export interface ManagedPackageInventoryItem {
	metadata: ManagedItemSummary & { source: string };
	source: string;
	matchSources: string[];
	declared: boolean;
	disabledByFilters: boolean;
	state: Exclude<InventoryPackageState, "unloaded">;
	drift?: string;
}

export interface UnloadedPackageInventoryItem {
	declaration: PackageDeclarationSummary;
	rawSource: string;
	source: string;
	matchSources: string[];
	disabledByFilters?: boolean;
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
	const packageSources = await collectPackageSourceSets(packageDeclarations, dirname(paths.projectSettingsPath));
	const managedItems = await getManagedItems(projectConstruct, packageSources.declaredSources, paths, packageSources.disabledSources);
	const managedPackages = managedItems
		.filter((item): item is ManagedItemSummary & { source: string } => item.kind === "package" && typeof item.source === "string" && item.source.length > 0)
		.map((metadata) => {
			const matchSources = managedPackageSources(metadata);
			const declared = matchSources.some((candidate) => packageSources.declaredSources.has(candidate));
			const disabledByFilters = matchSources.some((candidate) => packageSources.disabledSources.has(candidate));
			return {
				metadata,
				source: metadata.source,
				matchSources,
				declared,
				disabledByFilters,
				state: packageState(declared, disabledByFilters),
				drift: metadata.drift,
			};
		});
	const managedSources = new Set(managedPackages.flatMap((item) => item.matchSources));
	const availableCatalogPackages = catalog.data.items.filter((item) => !managedSources.has(item.source) && !packageSources.declaredSources.has(item.source));
	const unloadedPackageDeclarations: UnloadedPackageInventoryItem[] = [];
	for (const declaration of packageDeclarations) {
		if (declaration.form === "invalid" || !declaration.enabled || !declaration.source.trim()) continue;
		const source = await normalizeSourceForLibrary(declaration.source, dirname(paths.projectSettingsPath));
		if (managedSources.has(declaration.source) || managedSources.has(source)) continue;
		unloadedPackageDeclarations.push({
			declaration,
			rawSource: declaration.source,
			source,
			matchSources: [declaration.source, source],
			disabledByFilters: declaration.disabledByFilters,
		});
	}
	const directResources = options.directResources === false ? { resources: [], warnings: [] } : await collectDirectProjectResources(ctx, paths, projectConstruct);
	return {
		paths,
		reads: { userCatalog, userProjects, projectSettings, projectConstruct },
		catalog,
		knownProjects,
		packageDeclarations,
		packageSources,
		managedItems,
		managedPackages,
		availableCatalogPackages,
		unloadedPackageDeclarations,
		directResources,
	};
}
