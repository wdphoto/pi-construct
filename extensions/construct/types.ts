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
	projectSettingsPath: string;
	projectConstructPath: string;
}

export interface CatalogItem extends JsonObject {
	id: string;
	name?: string;
	kind: "package";
	source: string;
	description?: string;
	groups?: string[];
	managed?: boolean;
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

export interface SyncResult {
	added: CatalogItem[];
	alreadyKnown: number;
	warnings: string[];
}

export interface PackageDeclarationSummary {
	source: string;
	form: "string" | "object" | "invalid";
	enabled: boolean;
}

export interface ManagedItemSummary {
	id: string;
	kind: string;
	source?: string;
	enabled?: boolean;
	drift?: string;
}
