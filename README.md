# the-construct

A global Pi extension for loading reusable Pi packages into projects at the project-local level.

MVP principle: **Construct is not a package manager.** It wraps idiomatic Pi project config:

- project packages in `.pi/settings.json`
- Construct metadata in `.pi/construct.json`
- user reusable picker state in `~/.pi/agent/construct/`

## Current MVP commands

```text
/construct
/construct status
/construct catalog
/construct catalog add <source> [id]
/construct catalog remove <id-or-source>
/construct load [source-or-library-id]
/construct load --dry-run <source-or-library-id>
/construct disable <managed-id>
/construct enable <managed-id>
/construct remove <managed-id>
/construct autoload on|off|status
/construct reload
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
- `/construct load` runs `pi install <source> -l --approve` from the active Pi project.
- Target project is `ctx.cwd`; MVP does not guess git root.
- Existing `.pi/settings.json` is backed up before Construct/Pi package changes.
- Autoload means auto-offer only. It never installs packages by itself.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` is advisory metadata.
- `/construct disable` removes the project package declaration and keeps Construct metadata/library state for later re-enable.
