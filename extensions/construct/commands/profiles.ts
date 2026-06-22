import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CatalogData, CatalogItem, CatalogProfile, ConstructPaths } from "../types.js";
import { deriveId, findCatalogItem, loadCatalog, addSourcesToCatalog } from "../catalog.js";
import { isObject, readJson, writeJson } from "../json.js";
import { getPaths } from "../paths.js";
import { loadPackageIntoProject } from "../package-ops.js";
import { getPackages } from "../project-settings.js";
import { rememberKnownProject } from "../projects.js";
import { managedPackageSourceIdentity, normalizeSourceForLibrary } from "../sources.js";
import { progressStatus, setConstructStatus, showSummary, showText, splitArgs, waitForIdleBeforeConstructWrite } from "../ui.js";

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

	await waitForIdleBeforeConstructWrite(ctx, "Construct profile save");

	const load = await addSourcesToCatalog(ctx, sources);
	const remembered = await rememberKnownProject(ctx);
	if (remembered.warning) load.warnings.push(remembered.warning);
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

	await waitForIdleBeforeConstructWrite(ctx, "Construct profile apply");

	const loaded: Array<{ source: string; item?: CatalogItem }> = [];
	const partialRuntimeChanges: Array<{ source: string; item?: CatalogItem; error: string }> = [];
	const failures: string[] = [];
	let needsReload = false;
	let progress = 0;
	try {
		for (const source of sources) {
			const item = findCatalogItem(catalog.items, source);
			setConstructStatus(ctx, progressStatus("loading", ++progress, sources.length, item?.id ?? deriveId(source)));
			const result = await loadPackageIntoProject(pi, paths, { source, item });
			if (result.needsReload) needsReload = true;
			if (result.ok) loaded.push({ source, item });
			else {
				const error = result.error ?? result.stderr ?? `exit ${result.exitCode ?? "unknown"}`;
				if (result.metadataOnlyFailure && result.needsReload) partialRuntimeChanges.push({ source, item, error });
				else failures.push(`${item?.id ?? deriveId(source)}: ${error}`);
			}
		}
	} finally {
		setConstructStatus(ctx, undefined);
	}
	await showSummary(
		ctx,
		[
			`Construct profile applied: ${profile.id}`,
			`Turned on: ${loaded.length + partialRuntimeChanges.length}/${sources.length}`,
			...loaded.map(({ source, item }) => `+ ${item?.id ?? deriveId(source)}: ${source}`),
			partialRuntimeChanges.length > 0 ? `Package settings changed, but Construct metadata failed: ${partialRuntimeChanges.length}` : undefined,
			...partialRuntimeChanges.map(({ source, item, error }) => `! ${item?.id ?? deriveId(source)}: ${error}`),
			partialRuntimeChanges.length > 0 ? "Run /construct status to inspect drift." : undefined,
			...failures.map((failure) => `! ${failure}`),
			needsReload ? "Reload Pi resources with /reload when ready." : "No reload needed; no package settings changed.",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n"),
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
