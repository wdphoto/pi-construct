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

// Stale-baseline check for child filter plans: compare the reviewed (displayed) resource
// state to freshly resolved state. Any logical change in a reviewed resource (missing,
// enabled/disabled flip, or a newly added resource) requires re-review, so future policy
// and newly discovered resources are never overwritten or silently disabled.
export interface PackageResourceStateDrift {
	missing: string[];
	changed: string[];
	added: string[];
}

export function packageResourceStateDrift(baseline: Iterable<PackageResourceFilterPlanInput & { enabled?: boolean }>, current: Iterable<PackageResourceFilterPlanInput & { enabled?: boolean }>): PackageResourceStateDrift {
	const baselineState = new Map<string, boolean>();
	for (const resource of baseline) baselineState.set(packageResourceSelectionKey(resource.kind, resource.packageRelativePath), Boolean(resource.enabled));
	const currentState = new Map<string, boolean>();
	for (const resource of current) currentState.set(packageResourceSelectionKey(resource.kind, resource.packageRelativePath), Boolean(resource.enabled));
	const missing: string[] = [];
	const changed: string[] = [];
	const added: string[] = [];
	for (const [key, enabled] of baselineState) {
		if (!currentState.has(key)) missing.push(key);
		else if (currentState.get(key) !== enabled) changed.push(key);
	}
	for (const key of currentState.keys()) if (!baselineState.has(key)) added.push(key);
	return { missing, changed, added };
}

export function packageResourceSetsDiffer(a: Iterable<PackageResourceSummary>, b: Iterable<PackageResourceSummary>): boolean {
	const aKeys = new Set([...a].map((resource) => packageResourceSelectionKey(resource.kind, resource.packageRelativePath)));
	const bKeys = new Set([...b].map((resource) => packageResourceSelectionKey(resource.kind, resource.packageRelativePath)));
	if (aKeys.size !== bKeys.size) return true;
	for (const key of aKeys) if (!bKeys.has(key)) return true;
	return false;
}
