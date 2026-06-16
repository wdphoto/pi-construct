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
/construct load [source-or-catalog-id]
/construct load --dry-run <source-or-catalog-id>
/construct disable <managed-id>
/construct enable <managed-id>
/construct remove <managed-id>
/construct autoload on|off|status
/construct reload
```

## Safe local testing

Do not install globally during early development. Load explicitly:

```bash
pi --no-extensions -e ./src/index.ts
```

Print-mode smoke checks:

```bash
./scripts/smoke.sh
```

The smoke script uses disposable temp `HOME`, project, and package directories.

## Notes

- `/construct load` runs `pi install <source> -l --approve` from the active Pi project.
- Target project is `ctx.cwd`; MVP does not guess git root.
- Existing `.pi/settings.json` is backed up before Construct/Pi package changes.
- Autoload means auto-offer only. It never installs packages by itself.
- `.pi/settings.json` remains Pi's source of truth; `.pi/construct.json` is advisory metadata.
