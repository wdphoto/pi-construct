# the-construct

A global Pi extension for remembering Pi package/extension install sources and checking them into projects with project-local installs.

MVP principle: **Construct is not a package manager.** It is a simple install-memory picker for idiomatic Pi project config:

- project packages in `.pi/settings.json`
- Construct metadata in `.pi/construct.json`
- user reusable picker state in `~/.pi/agent/construct/`

## MVP workflow

1. In project A, install a Pi package or local extension source with normal Pi:
   ```bash
   pi install <source> -l
   ```
2. Construct remembers that source when it sees project A.
3. In project B, run:
   ```text
   /construct
   ```
4. Pick an unchecked remembered source:
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
/construct unload [source-or-library-id]
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
- `/construct unload <source-or-id>` runs `pi remove <source> -l --approve` to remove that source from the active project only. It does not delete local source files or forget the Construct library item.
- Target project is `ctx.cwd`; MVP does not guess git root.
- Existing `.pi/settings.json` is backed up before Construct/Pi package changes.
- `/construct sync` remembers package sources from the current project's `.pi/settings.json` into the Construct library. It never installs or edits the project.
- `/construct sync on` enables invisible remember-only sync on session shutdown.
- Autoload means auto-offer only. It never installs packages by itself.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` is advisory metadata.
- Old enable/disable/remove commands are compatibility/power-user paths; MVP language is load/unload/sync.

## Next refactor order

1. Add a permanent end-to-end smoke script for Project A raw install → `/construct sync` → Project B load/unload/reload.
2. Replace the current simple select picker with a searchable checkbox TUI.
3. Add library `remember`/`forget` aliases if we want to retire user-facing `catalog` language.
4. Only after that, revisit profiles/groups and resource-level disable filters.
