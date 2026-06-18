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
/construct unload                    # unload all project package declarations
/construct unload <source-or-library-id> # unload one package declaration
/construct sync
/construct sync on|off|status
/construct status
/construct reload
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
- `/construct` opens the remembered-source picker; choosing an unchecked item runs `pi install <source> -l --approve` from the active Pi project.
- `/construct load` is the explicit/direct-load alias for the same flow.
- `/construct unload` unloads all current project package declarations by running `pi remove <source> -l --approve` for each one. `/construct unload <source-or-id>` unloads one. It does not delete local source files or forget Construct library items.
- Construct does not auto-reload after load/unload/sync. Run `/construct reload` or `/reload` when you want Pi to refresh resources.
- Target project is `ctx.cwd`; MVP does not guess git root.
- Existing `.pi/settings.json` is backed up before Construct/Pi package changes.
- `/construct sync` remembers package sources from the current project's `.pi/settings.json` into the Construct library. It never installs or edits the project.
- `/construct sync on` enables invisible remember-only sync on session shutdown.
- Autoload means auto-offer only. It never installs packages by itself.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` is advisory metadata.
- Old enable/disable/remove commands are compatibility/power-user paths; MVP language is load/unload/sync.

## Next refactor order

1. Replace the one-item select picker with a save-based TUI:
   - `/construct load` should show loadable/unchecked remembered sources only; saving installs selected sources with no second confirmation page.
   - `/construct unload` should show loaded/checked project package declarations only; saving removes selected sources.
   - `/construct` should become the all-up loadout view where checked means loaded here and unchecked means available.
   - Esc/cancel bails; Save does the deed and then reports success plus `/construct reload` / `/reload` guidance.
2. Clean up and prettify list output for status, sync, catalog/library, load, and unload.
3. Add library `remember`/`forget` aliases if we want to retire user-facing `catalog` language.
4. Only after that, revisit profiles/groups and resource-level disable filters.
