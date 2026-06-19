import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogItem, CatalogProfile, ConstructPaths } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, parseCatalog, addSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { loadPackageIntoProject } from "../package-ops.js";
import { getPackages } from "../project-settings.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary } from "../sources.js";
import { progressStatus, setConstructStatus, showSummary, showText, splitArgs } from "../ui.js";

function profileId(name: string): string {
	return deriveId(name);
}

function findProfile(catalog: CatalogData, query: string): CatalogProfile | undefined {
	return catalog.profiles.find((profile) => profile.id === query || profile.name === query);
}

function usage(): string {
	return [
		"Construct profiles",
		"==================",
		"/construct profile list",
		"/construct profile save <name>",
		"/construct profile apply <name>",
		"",
		"Profiles are named groups of Construct library packages. They never auto-apply.",
	].join("\n");
}

async function activeManagedSources(paths: ConstructPaths): Promise<string[]> {
	const [settingsRead, constructRead] = await Promise.all([readJson(paths.projectSettingsPath), readJson(paths.projectConstructPath)]);
	if (constructRead.state === "invalid") throw new Error(`Cannot save a profile because .pi/construct.json is invalid JSON.\n${constructRead.error}`);
	if (constructRead.state !== "ok" || !isObject(constructRead.data) || !isObject(constructRead.data.items)) return [];

	const projectSources = new Set<string>();
	const settingsDir = dirname(paths.projectSettingsPath);
	for (const pkg of getPackages(settingsRead)) {
		if (pkg.form === "invalid" || !pkg.enabled || !pkg.source.trim()) continue;
		projectSources.add(pkg.source);
		projectSources.add(await normalizeSourceForLibrary(pkg.source, settingsDir));
	}

	const sources: string[] = [];
	const seen = new Set<string>();
	for (const value of Object.values(constructRead.data.items)) {
		if (!isObject(value) || value.kind !== "package") continue;
		const identity = await managedPackageSourceIdentity(value, paths);
		if (!identity.displaySource) continue;
		const active = [...identity.matchSources].some((source) => projectSources.has(source));
		if (!active) continue;
		const source = identity.normalizedInstallSource ?? identity.displaySource;
		if (seen.has(source)) continue;
		seen.add(source);
		sources.push(source);
	}
	return sources.sort();
}

async function saveProfile(ctx: ExtensionCommandContext, name: string): Promise<void> {
	if (!name.trim()) {
		showText(ctx, "Usage: /construct profile save <name>");
		return;
	}
	const paths = await getPaths(ctx);
	const sources = await activeManagedSources(paths);
	if (sources.length === 0) {
		showText(ctx, "Construct profile not saved. No active Construct-managed packages found in this project. Run /construct load first if these packages are local-only.");
		return;
	}

	const load = await addSourcesToCatalog(ctx, sources);
	if (load.warnings.length > 0) {
		showText(ctx, ["Construct profile not saved.", ...load.warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const { paths: catalogPaths, read, catalog, warnings } = await loadCatalog(ctx);
	if (read.state === "ok" && warnings.length > 0) {
		showText(ctx, ["Construct profile not saved.", `Fix ${catalogPaths.userCatalogPath} first.`, ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}

	const items = sources.map((source) => findCatalogItem(catalog.items, source)?.id ?? deriveId(source));
	const id = profileId(name);
	const now = new Date().toISOString();
	const existing = findProfile(catalog, id);
	const nextProfile: CatalogProfile = {
		...(existing ?? {}),
		id,
		name: name.trim(),
		kind: "profile",
		items,
		sources,
		updatedAt: now,
		createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
	};
	const profiles = [...catalog.profiles.filter((profile) => profile.id !== id), nextProfile].sort((a, b) => a.id.localeCompare(b.id));
	await writeJson(catalogPaths.userCatalogPath, { ...catalog, version: 1, profiles });
	await showSummary(ctx, [`Construct profile saved: ${id}`, `Packages: ${sources.length}`, ...sources.map((source) => `- ${source}`)].join("\n"));
}

async function applyProfile(pi: ExtensionAPI, ctx: ExtensionCommandContext, query: string): Promise<void> {
	if (!query.trim()) {
		showText(ctx, "Usage: /construct profile apply <name>");
		return;
	}
	const paths = await getPaths(ctx);
	const { catalog, warnings } = await loadCatalog(ctx);
	if (warnings.length > 0) {
		showText(ctx, ["Construct profile apply failed.", ...warnings.map((warning) => `! ${warning}`)].join("\n"));
		return;
	}
	const profile = findProfile(catalog, query.trim());
	if (!profile) {
		showText(ctx, `Construct profile not found: ${query.trim()}`);
		return;
	}
	const sources = profile.sources.length > 0
		? profile.sources
		: profile.items.map((id) => catalog.items.find((item) => item.id === id)?.source).filter((source): source is string => typeof source === "string");
	if (sources.length === 0) {
		showText(ctx, `Construct profile has no package sources: ${profile.id}`);
		return;
	}

	const loaded: Array<{ source: string; item?: CatalogItem }> = [];
	const failures: string[] = [];
	let progress = 0;
	try {
		for (const source of sources) {
			const item = findCatalogItem(catalog.items, source);
			setConstructStatus(ctx, progressStatus("loading", ++progress, sources.length, item?.id ?? deriveId(source)));
			const result = await loadPackageIntoProject(pi, paths, { source, item });
			if (result.ok) loaded.push({ source, item });
			else failures.push(`${item?.id ?? deriveId(source)}: ${result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`}`);
		}
	} finally {
		setConstructStatus(ctx, undefined);
	}
	await showSummary(
		ctx,
		[
			`Construct profile applied: ${profile.id}`,
			`Turned on: ${loaded.length}/${sources.length}`,
			...loaded.map(({ source, item }) => `+ ${item?.id ?? deriveId(source)}: ${source}`),
			...failures.map((failure) => `! ${failure}`),
			"Reload Pi resources with /reload when ready.",
		].join("\n"),
	);
}

async function listProfiles(ctx: ExtensionCommandContext): Promise<void> {
	const { catalog, warnings } = await loadCatalog(ctx);
	const lines = ["Construct profiles", "=================="];
	if (catalog.profiles.length === 0) lines.push("- none");
	else {
		for (const profile of catalog.profiles) {
			lines.push(`- ${profile.id}${profile.name && profile.name !== profile.id ? ` (${profile.name})` : ""}: ${profile.sources.length || profile.items.length} packages`);
		}
	}
	lines.push(...warnings.map((warning) => `! ${warning}`));
	showText(ctx, lines.join("\n"));
}

export async function handleProfile(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { command, rest } = splitArgs(args);
	if (command === "dashboard" || command === "list") {
		await listProfiles(ctx);
		return;
	}
	if (command === "save") {
		await saveProfile(ctx, rest);
		return;
	}
	if (command === "apply" || command === "load") {
		await applyProfile(pi, ctx, rest);
		return;
	}
	showText(ctx, usage());
}
