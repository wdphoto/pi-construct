import type { DirectResourceKind } from "./types.js";
import type { PackageResourceSummary } from "./package-resources.js";
import { packageResourceFilterKeys, type PackageResourceFilterKey } from "./package-filters.js";

export const packageFilterKeyForKind: Record<DirectResourceKind, PackageResourceFilterKey> = {
	extension: "extensions",
	skill: "skills",
	prompt: "prompts",
	theme: "themes",
};

export interface PackageResourceFilterPlanInput {
	kind: DirectResourceKind;
	packageRelativePath: string;
}

export interface PackageResourceFilterPlanResult {
	filters: Record<PackageResourceFilterKey, string[]>;
	selectedResourceKeys: Set<string>;
	selectedCount: number;
}

export function packageResourceSelectionKey(kind: DirectResourceKind, packageRelativePath: string): string {
	return `${kind}\u0000${packageRelativePath}`;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
}

export function planPackageResourceFilters(
	resources: readonly PackageResourceFilterPlanInput[],
	selectedResourceKeys: Set<string>,
): PackageResourceFilterPlanResult {
	const filters: Record<PackageResourceFilterKey, string[]> = { extensions: [], skills: [], prompts: [], themes: [] };
	let selectedCount = 0;

	for (const resource of resources) {
		const key = packageResourceSelectionKey(resource.kind, resource.packageRelativePath);
		if (!selectedResourceKeys.has(key)) continue;
		filters[packageFilterKeyForKind[resource.kind]].push(resource.packageRelativePath);
		selectedCount += 1;
	}

	for (const key of packageResourceFilterKeys) filters[key] = uniqueSorted(filters[key]);
	return { filters, selectedResourceKeys: new Set(selectedResourceKeys), selectedCount };
}

export function packageResourceSetsDiffer(a: Iterable<PackageResourceSummary>, b: Iterable<PackageResourceSummary>): boolean {
	const aKeys = new Set([...a].map((resource) => packageResourceSelectionKey(resource.kind, resource.packageRelativePath)));
	const bKeys = new Set([...b].map((resource) => packageResourceSelectionKey(resource.kind, resource.packageRelativePath)));
	if (aKeys.size !== bKeys.size) return true;
	for (const key of aKeys) if (!bKeys.has(key)) return true;
	return false;
}
