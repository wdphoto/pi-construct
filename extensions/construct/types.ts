export type JsonObject = Record<string, unknown>;

export type JsonReadResult =
	| { state: "missing"; path: string }
	| { state: "invalid"; path: string; error: string }
	| { state: "ok"; path: string; data: unknown };

export interface ConstructPaths {
	cwd: string;
	realCwd: string;
	constructDir: string;
	userCatalogPath: string;
	userProjectsPath: string;
	projectSettingsPath: string;
	projectConstructPath: string;
}

export type ResourceKind = "package" | "extension" | "skill" | "prompt" | "theme";
export type DirectResourceKind = Exclude<ResourceKind, "package">;
export type ResourceScope = "user" | "project" | "temporary";
export type ResourceOrigin = "package" | "top-level";

export interface CatalogItem extends JsonObject {
	id: string;
	name?: string;
	kind: "package";
	source: string;
	description?: string;
	groups?: string[];
	managed?: boolean;
}

export interface DirectResourceSummary {
	id: string;
	kind: DirectResourceKind;
	name: string;
	path: string;
	displayPath: string;
	settingsPath?: string;
	baseDir?: string;
	scope: ResourceScope;
	origin: ResourceOrigin;
	source: string;
	enabled: boolean;
	managed: boolean;
	managedId?: string;
}

export interface CatalogProfile extends JsonObject {
	id: string;
	name?: string;
	kind: "profile";
	items: string[];
	sources: string[];
	createdAt?: string;
	updatedAt?: string;
}

export interface CatalogData {
	version: 1;
	items: CatalogItem[];
	profiles: CatalogProfile[];
}

export interface KnownProjectEntry extends JsonObject {
	path: string;
	realPath?: string;
	packages: string[];
	updatedAt?: string;
}

export interface KnownProjectsData {
	version: 1;
	projects: KnownProjectEntry[];
}

export interface LoadResult {
	added: CatalogItem[];
	alreadyKnown: number;
	warnings: string[];
}

export interface PackageDeclarationSummary {
	source: string;
	form: "string" | "object" | "invalid";
	enabled: boolean;
	disabledByFilters?: boolean;
	filterState: "unfiltered" | "whole-package-disabled" | "partially-filtered" | "invalid";
	filterDescription: string;
}

export interface ManagedItemSummary {
	id: string;
	kind: string;
	source?: string;
	enabled?: boolean;
	drift?: string;
	matchSources?: string[];
	identityKey?: string;
}
