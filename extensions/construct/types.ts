export type JsonObject = Record<string, unknown>;

export type JsonReadResult =
	| { state: "missing"; path: string }
	| { state: "invalid"; path: string; error: string }
	| { state: "ok"; path: string; data: unknown };

export interface ConstructPaths {
	cwd: string;
	realCwd: string;
	constructDir: string;
	agentSettingsPath: string;
	userSettingsPath: string;
	userCatalogPath: string;
	userSkipsPath: string;
	projectSettingsPath: string;
	projectConstructPath: string;
}

export interface CatalogItem {
	id: string;
	name?: string;
	kind: "package";
	source: string;
	description?: string;
	managed?: boolean;
}

export interface CatalogData {
	version: 1;
	items: CatalogItem[];
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
