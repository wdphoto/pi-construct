<img width="498" height="278" alt="morfeo-the-construct" src="https://github.com/user-attachments/assets/ccd93aca-1b89-416e-a67e-aa151cfe8f7f" />

# The Construct

The Construct is a **global** extension for [Pi](https://pi.dev) that manages project-level resource packages like extensions, skills, prompts, themes, and loadouts from one menu.

This README is the main human guide for Construct.

Run `/construct`, hit **Spacebar** to select what belongs in the project, press **Enter** to apply. Easy stuff.

## Install

```bash
pi install npm:pi-construct
# or
pi install git:github.com/wdphoto/pi-construct
# or
pi install https://github.com/wdphoto/pi-construct
# or
pi install ~/Code/pi-construct
```

## Quick start

Install a Pi package in a project:

```bash
pi install npm:package-name -l --approve
```

Adopt the already-installed project package/resource declarations into Construct metadata:

```text
/construct load
```

Open the loadout menu:

```text
/construct
```

Save the active package set for later:

```text
/construct save web-stack
```

Run that saved loadout in another project:

```text
/construct run web-stack
```

## What it does

- Shows active, disabled, unresolved, available, and unloaded project resources.
- Remembers package sources so you can reuse them across projects.
- Saves named loadouts as package-source recipes.
- Lets the dashboard enable, disable, install, or remove project package declarations from one TUI.
- Can unfold declared package-contained resources and write Pi-native package filters.
- Shows read-only cached previews for available packages; Enter installs the whole package, then you select the live Pi-resolved resources after reopening.
- Can adapt Git Agent Skills repositories that resolve zero native Pi package resources: it discovers valid skills in the managed checkout and links selected skill roots through project-level `skills` settings while keeping the Git package declared for `pi update --extensions`.
- Can adopt Pi-resolved project resources from `.pi/`, project `.agents/skills`, and project settings paths into project metadata.
- Uses Pi-native settings, package filters, trust checks, and reload behavior.

For exact extension/skill/prompt/theme inheritance and overrides, use Pi's native project resource editor:

```bash
pi config -l
```

Construct uses Pi-resolved package resources plus discovered Agent Skills carriers to identify known active and all-off states. A Construct-managed declared package with no resolved resources is shown as **Unresolved** unless it is explicitly whole-package-disabled or has a discovered Agent Skills adapter; a whole-package-disabled declaration stays **Disabled** and enableable, and a discovered carrier follows carrier state (Active/Disabled) below. An unadopted declaration remains read-only **Unloaded**, with its unresolved or all-off detail shown rather than treated as active. Remembered sources no longer declared remain installable.

Some Git packages (for example Agent Skills repositories) contain skills but expose zero native Pi package resources. Construct reads the managed checkout, lists its valid skills as collapsed inline child rows (Right Arrow unfolds and Left Arrow folds, using the same package-child affordance as ordinary resources, and the parent row reports how many Agent Skills are available), and writes selected skill roots into the project-level top-level `skills` array through Pi's settings manager. The Git package declaration stays in place so Pi still owns clone/update via `pi update --extensions`. Such a carrier is **Active** when any linked skill is enabled and **Disabled** otherwise (nothing linked yet, or every linked path is off); **Unresolved** is reserved for a declared package that resolves zero native resources and has no discovered Agent Skills adapter. Available library rows use a bounded advisory catalog inventory recorded by `/construct load` and dashboard package removal when one exists; it contains only validated, capped skill names, descriptions, and package-relative roots, so a previously inspected carrier keeps its tree after Pi removes the project checkout. Without that snapshot, Construct can show read-only children from Pi's already-existing temporary cache. This cache-only, offline lookup never installs, fetches, scans another project, or persists data, and its inventory can be stale; validated catalog snapshots win over cached inventories, and native Pi resources always win. An authoritative `/construct load` or successful dashboard removal inspection that finds no adapter (native package, malformed, or otherwise unrepresentable) clears any stale snapshot instead of preserving it. Enter on the parent still installs normally, and Construct re-resolves the real checkout before any skill-link write. An Available source with neither a recorded snapshot nor a suitable temporary cached inventory has no Agent Skill arrow; snapshots are recorded only by `/construct load` (including a refresh for an already-adopted carrier, updating existing library entries only) and successful dashboard removal of an existing library item, not by first installation. Adapted skill selections are project-local like package child filters: they are not stored in saved loadout recipes, and removing the carrier removes its linked skill paths first. Unselected linked skills keep their state, and linked skills loaded through a broader path or pattern are never silently rewritten; use `pi config -l` for those. Linked carriers also count as Active in the shared save/run effective-state path (recipes remain source-only); an unlinked/discovered carrier is skipped by `/construct run` and save with carrier-specific guidance to open `/construct` and review the package children, not `pi config -l`, and `status full` summarizes found/linked/enabled skills. A present-but-malformed `.claude-plugin/marketplace.json` disables discovery instead of publishing template skills, and package removal refuses when a broader skill pattern could be left dangling rather than silently dropping it. `/construct load` never adopts carrier-owned skills as independent direct resources, and carrier removal prunes any legacy duplicate direct skill metadata under the checkout without deleting files. Full status lists carrier-managed skills under the Agent Skills repository summary instead of as unloaded direct resources.

Saving excludes all-off partial-filter and unresolved declarations with an explicit summary. Running a saved loadout skips and explains those rows; inspect the declaration with `pi config -l`. Partly active filtered packages remain active, and Construct preserves partial Pi filters rather than clearing them as a workaround.

Child-resource filter actions cannot be mixed with package, direct-resource, or saved-loadout selections: split them into separate actions. Parent aggregate selection within one child group and multiple child-only package groups remain valid. Package resource filter actions and Agent Skill link actions also cannot be combined in one submit. Before filtering a declared package, Construct rechecks the reviewed declaration and Pi-resolved resource list and enabled state; additions, removals, or state changes require re-review without changing unrelated settings. Available rows are install-only: Construct shows read-only cached previews, installs the whole package with Pi's normal defaults, and you select the live Pi-resolved resources after reopening (before `/reload`) or with `pi config -l`. If you only want some resources, install first and filter after reopening. Before each install, Construct rechecks live trust and that the reviewed source is still undeclared; a later target that is now declared or untrusted is refused without undoing earlier changes. Install results never auto-reload Pi: they say Pi defaults remain unfiltered and to reopen /construct or run `pi config -l` before `/reload` (or `/reload` explicitly to accept defaults). The same per-install preflight and manual-reload rule apply to `/construct run`; its print output says to reopen /construct or use `pi config -l` before `/reload` rather than claiming no reload is needed.

Construct always treats Pi `autoload: false` project override entries as read-only and excludes them from Construct package operations; use `pi config -l` for their inherit/load/unload state. Saved Construct loadouts remain package-source recipes: they do not copy direct skill files or serialize package child-resource filters.

Construct is a loadout manager, not a new package manager. `.pi/settings.json` stays the source of truth.

Unload forgets matching package ownership without deleting resources or changing Pi settings. In the dashboard, Space-select eligible package rows (or all children of one package), press `Ctrl+U`, and confirm to forget them from the Construct library, saved-loadout references, and current-project metadata. `Ctrl+Alt+R` removes a package from the project with its existing focused-row fallback, while `Alt+I` opens details and `/construct wipe <name>` deletes only a saved recipe. Plain `u`, `r`, and `i` (upper or lower case) always remain filter text. Partial child groups, direct resources, saved rows, Unloaded rows, and override rows refuse the whole unload batch. Declarations can remain visible as Unloaded after reopening.

Scan refuses the filesystem root, home directory, and home-level `.pi`, `.agents`, `.claude`, and `.codex` directories as scan roots, including symlink aliases. Before every scan/reconcile metadata or catalog write, Construct rechecks target trust through Pi; denied, missing, or unreadable trust skips the target without granting trust. Earlier writes can remain and are reported, while independent trusted targets can continue. Share's credential-warning output omits rejected source values; always review source URLs before sharing.

## Common commands

```text
/construct                    # open the loadout menu
/construct status [full]      # read-only diagnostics
/construct scan [path]        # find unloaded trusted Pi-resolved project resources
/construct load [query-or-source ...] # adopt project resources; unmatched explicit sources are remembered library-only
/load <package-source ...>           # always add explicit package sources to the library only
/construct unload [...]       # forget package ownership, not uninstall
/construct save <name>        # save active package sources as a loadout
/construct list               # list saved loadouts
/construct run <name>         # apply a saved loadout to this project
/construct share <name>       # print a shareable loadout JSON snippet
/construct import [json]      # preview/import a shared loadout snippet
/construct wipe <name>        # delete only a saved loadout recipe
```

`/construct load <source>` first considers matching project load candidates. A recognized explicit source with no match is remembered in the global Construct library only: nothing is installed, `.pi/settings.json` and `.pi/construct.json` are untouched, and no known project is recorded. `/load <package-source ...>` is the thin top-level command that always performs that library-only add. Construct recognizes:

```text
/load npm:package-name          # npm, unscoped
/load npm:@scope/package-name   # npm, scoped
/load npm:package-name@1.2.3    # npm, versioned
/load ./packages/local-pkg      # local directory, relative to the current project
/load ../sibling-pkg            # local directory, relative parent
/load ~/packages/local-pkg      # local directory, home-relative
/load /opt/example/local         # local, absolute
/load ./single-extension.ts     # local file
/load git:github.com/owner/repo # Git source forms
```

Relative local paths resolve against the current project directory, `~` expands, and local sources are stored as normalized absolute paths (realpaths when available). Local paths are machine-specific and break if the directory moves, so prefer a Git or npm source for portability. A local path must already exist and be readable when added; Construct records only the path and does not install, copy, scan, or inspect the local package, nor change project files. Paths containing spaces are not supported because command arguments are whitespace-separated. Bare ids/resource names and bare `~`, `.` or `..` keep the existing project-query behavior; generated Pi cache paths are refused. Library-only adds do not require project trust; an explicit-source-only `/construct load` in an untrusted project is remembered library-only rather than adopted.

## Files

- `.pi/settings.json` — Pi project source of truth.
- `.pi/construct.json` — project-local Construct metadata.
- `~/.pi/agent/construct/catalog.json` — user-local Construct library and saved loadouts.
- `~/.pi/agent/construct/projects.json` — user-local index of touched projects.

## Remove Construct

Use the same source form you installed with:

```bash
pi remove npm:pi-construct
pi remove git:github.com/wdphoto/pi-construct
pi remove /path/to/pi-construct
```

`pi uninstall <source>` is also supported as an alias for `pi remove <source>`.

## Development checks

With dependencies installed and `pi`, Bash, and Python 3 on your PATH:

```bash
npm run check
npm run check:hygiene
npm run smoke:all
npm run release:verify
```

Smoke scripts use disposable homes, clear inherited Pi config/session directory overrides, and run Pi offline. They do not use your live global Pi configuration.

## License

MIT
