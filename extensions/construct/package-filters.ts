import { isObject } from "./json.js";

export const packageResourceFilterKeys = ["extensions", "skills", "prompts", "themes"] as const;

export type PackageResourceFilterKey = (typeof packageResourceFilterKeys)[number];

export type PackageFilterState = "unfiltered" | "whole-package-disabled" | "partially-filtered" | "invalid";

export interface PackageFilterAnalysis {
	state: PackageFilterState;
	presentKeys: PackageResourceFilterKey[];
	invalidKeys: PackageResourceFilterKey[];
	description: string;
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function filterEntryIsValid(entry: unknown): entry is string[] {
	return Array.isArray(entry) && entry.every((value) => typeof value === "string");
}

function describeCounts(entry: Record<string, unknown>, keys: PackageResourceFilterKey[]): string {
	return keys
		.map((key) => {
			const value = entry[key];
			const count = Array.isArray(value) ? value.length : 0;
			return `${key} ${count}`;
		})
		.join(" · ");
}

export function analyzePackageFilters(entry: unknown): PackageFilterAnalysis {
	if (typeof entry === "string") {
		return { state: "unfiltered", presentKeys: [], invalidKeys: [], description: "unfiltered" };
	}
	if (!isObject(entry) || typeof entry.source !== "string") {
		return { state: "invalid", presentKeys: [], invalidKeys: [], description: "invalid package declaration" };
	}

	const presentKeys = packageResourceFilterKeys.filter((key) => hasOwn(entry, key));
	if (presentKeys.length === 0) {
		return { state: "unfiltered", presentKeys, invalidKeys: [], description: "unfiltered" };
	}

	const invalidKeys = presentKeys.filter((key) => !filterEntryIsValid(entry[key]));
	if (invalidKeys.length > 0) {
		return {
			state: "invalid",
			presentKeys,
			invalidKeys,
			description: `invalid package filters: ${invalidKeys.join(", ")}`,
		};
	}

	const wholePackageDisabled = packageResourceFilterKeys.every((key) => hasOwn(entry, key) && Array.isArray(entry[key]) && entry[key].length === 0);
	if (wholePackageDisabled) {
		return { state: "whole-package-disabled", presentKeys, invalidKeys: [], description: "whole package disabled by filters" };
	}

	return {
		state: "partially-filtered",
		presentKeys,
		invalidKeys: [],
		description: `partially filtered (${describeCounts(entry, presentKeys)})`,
	};
}

export function packageFiltersDisableWholePackage(entry: unknown): boolean {
	return analyzePackageFilters(entry).state === "whole-package-disabled";
}

export function packageFiltersArePartial(entry: unknown): boolean {
	return analyzePackageFilters(entry).state === "partially-filtered";
}
