import type { PackageResourceSummary } from "./package-resources.js";
import { packageResourceMatches, type PackageResourceMatchTarget } from "./package-resources.js";

/**
 * Effective state derived only from Pi's resolved package resources.
 * - "unknown": no resource inventory was supplied, or the package resolved no
 *   matching resource entries (e.g. missing/uninstalled or zero-resource package).
 * - "active": at least one matching resolved resource is enabled.
 * - "inactive": one or more matching resources resolved and none is enabled.
 *
 * Declaration policy (whole-package-disabled, project overrides, read-only rows)
 * stays with the existing declaration summaries and is applied by callers; this
 * helper never interprets filter arrays itself.
 */
export type EffectivePackageState = "active" | "inactive" | "unknown";

export function effectivePackageState(
	resources: readonly PackageResourceSummary[] | undefined,
	target: PackageResourceMatchTarget,
): EffectivePackageState {
	if (!resources || resources.length === 0) return "unknown";
	const matchTarget: PackageResourceMatchTarget = { id: target.id, matchSources: new Set(target.matchSources) };
	let matched = false;
	for (const resource of resources) {
		if (!packageResourceMatches(resource, matchTarget)) continue;
		matched = true;
		if (resource.enabled) return "active";
	}
	return matched ? "inactive" : "unknown";
}

export type SavedSourceSection = "Active" | "Disabled" | "Unresolved" | "Overrides" | "Available" | "Unloaded";

export interface SavedSourceRow {
	section: SavedSourceSection;
	wholePackageDisabled: boolean;
	effectiveState: EffectivePackageState;
}

export type SavedSourceDecision = "install" | "enable" | "active" | "all-off" | "unresolved" | "override";

/**
 * Shared activate-only policy for a saved-loadout source, used by both `/construct run`
 * and the dashboard saved-row Enter.
 *
 * `Overrides` (Pi `autoload:false` deltas) are read-only and are never fed into the
 * enable/install policy, regardless of their filter shape.
 */
export function savedSourceDecision(row: SavedSourceRow | undefined): SavedSourceDecision {
	if (!row) return "install";
	if (row.section === "Overrides") return "override";
	if (row.section === "Available") return "install";
	if (row.wholePackageDisabled) return "enable";
	if (row.effectiveState === "active") return "active";
	if (row.effectiveState === "inactive") return "all-off";
	return "unresolved";
}
