# the-construct

The Construct is a loadout manager for [Pi](https://pi.dev). It helps me remember the tools I use, then load or unload them inside of my projects.

## Current Workflow

1. In project A, install a Pi package or local extension source with normal Pi:
   ```bash
   pi install <source> -l
   ```
2. Sync your project with the Construct. Then the Construct remembers that source when it sees project B.
3. In project B, run:
   ```text
   /construct
   ```
4. Pick an unchecked source:
   ```text
   [x] tally tools          npm:tally-tools
   [ ] tripwire             /Users/me/code/tripwire
   [ ] demo extension       /Users/me/code/foo/extensions/demo.ts
   ```
5. Construct runs:
   ```bash
   pi install <source> -l --approve
   ```

Checked means already declared in this project. Unchecked means remembered by Construct and available to add here.

## Current MVP commands

```text
/construct
/construct load [source-or-library-id]
/construct load --dry-run <source-or-library-id>
/construct unload                    # choose loaded Construct packages to turn off
/construct unload <source-or-library-id> # turn off one managed package declaration
/construct toggle                    # flip the project Construct loadout off/on
/construct sync
/construct sync on|off|status
/construct status
/construct reload                    # ask Pi to refresh resources after changes
```

Low-level library/power-user commands still exist for now:

```text
/construct catalog
/construct catalog add <source> [id]
/construct catalog remove <id-or-source>
```

Compatibility commands still exist but are not the primary MVP surface:

```text
/construct enable <managed-id>
/construct disable <managed-id>
/construct remove <managed-id>
/construct autoload on|off|status
```

## Safe local testing

Do not install into your live global Pi config during early development. Load the package explicitly:

```bash
pi --no-extensions -e .
```

For direct file debugging only:

```bash
pi --no-extensions -e ./extensions/construct/index.ts
```

Print-mode smoke checks:

```bash
./scripts/smoke.sh
./scripts/e2e-smoke.sh
```

The smoke script uses disposable temp `HOME`, project, and package directories.

To test actual package install/discovery without touching your real Pi config:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/home" "$TMP/project"
HOME="$TMP/home" pi install "$PWD" --approve
(cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
```

For interactive package testing:

```bash
pi --no-extensions -e .
```

## License

MIT

## Notes

- Package entry point is `extensions/construct/index.ts`; normal testing should load the package root (`-e .`) so Pi reads `package.json` and labels the extension as `construct`.
- `/construct` currently opens the load picker. Target UX is a full loadout overview.
- `/construct load` shows remembered Construct sources that are not loaded here; Space toggles multiple items, Enter saves, Esc cancels. Direct `/construct load <source-or-id>` also works.
- `/construct load` does not auto-sync local-only Pi packages. Run `/construct sync` to adopt local project package declarations into Construct.
- `/construct unload` shows Construct-managed package declarations currently loaded in this project; Space toggles multiple items off, Enter saves, Esc cancels. `/construct unload <source-or-id>` disables one. It does not delete local source files or forget Construct library items.
- `/construct toggle` flips the project's Construct-managed loadout off/on. Turning off removes only Construct-managed package declarations from `.pi/settings.json`, keeps `.pi/construct.json`, and ignores unsynced local-only Pi packages. Toggling on rearms remembered Construct-managed packages.
- Hidden `/construct off` and `/construct on` aliases remain for testing, but the public flow is `/construct toggle`.
- `/construct wipe` was removed from the primary flow.
- `/construct reload` does not toggle anything. It just asks Pi to refresh resources after settings changed, like Pi's normal `/reload`.
- Construct does not auto-reload after load/unload/sync/toggle. Run `/construct reload` or `/reload` when you want Pi to refresh resources.
- Target project is `ctx.cwd`; MVP does not guess git root.
- Existing `.pi/settings.json` is backed up before Construct/Pi package changes.
- `/construct sync` adopts package sources from the current project's `.pi/settings.json` into the Construct library and arms them in `.pi/construct.json`. It never installs or removes package declarations.
- `/construct sync on` enables invisible remember-only sync on session shutdown.
- Autoload means auto-offer only. It never installs packages by itself.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` is advisory metadata.
- Old enable/disable/remove commands are compatibility/power-user paths; MVP language is load/unload/sync.

## Next refactor order

1. Finish the full `/construct` overview:
   - `/construct load` and `/construct unload` now have save-based multi-toggle TUI flows.
   - `/construct` should become the all-up loadout view where checked means loaded here, unchecked means available, and warning/red means unsynced local-only.
   - Unsynced local-only items should be read-only until `/construct sync` adopts them.
2. Clean up and prettify list output for status, sync, catalog/library, load, unload, and toggle.
3. Add library `remember`/`forget` aliases if we want to retire user-facing `catalog` language.
4. Define restore/profile behavior: `/construct on` is the simple current-project rearm; named profiles come later.
5. Only after that, revisit profiles/groups and resource-level disable filters.
