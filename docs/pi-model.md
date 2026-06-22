# Idiomatic Pi model

<!-- Historical source: former the-construct-plan.md notes on existing Pi primitives. -->

## Existing Pi primitives we should build on

- **Project trust**: project-local `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, and `.agents/skills` load only after trust.
- **Context files**: repo-root/ancestor `AGENTS.md` and `CLAUDE.md` are normal Pi project guidance and can be part of a workflow, though they are not gated the same way as `.pi` resources.
- **Trust belongs to Pi**. Global extensions can technically participate in the `project_trust` event, but Construct should not own, replace, or track trust decisions.
- **Project package installs** already exist: `pi install <source> -l` writes to `.pi/settings.json`; after that, Pi installs missing project packages on startup after trust. No `-l` churn is needed on every run.
- **Project-local auto-discovery** already exists: `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `.pi/themes/` are discovered after trust without extra settings in many cases.
- **Resources**:
  - extensions: TypeScript modules, can add tools and slash commands.
  - skills: progressive capability docs/scripts, optionally `/skill:name` commands.
  - prompt templates: project-level slash commands from `.pi/prompts/*.md`.
  - themes: project/user themes.
  - packages: npm/git/local bundles containing any of the above.
- **Resource filtering** already exists in settings object form:
  ```json
  {
    "packages": [
      {
        "source": "npm:my-package",
        "extensions": ["extensions/main.ts"],
        "skills": ["skills/review"],
        "prompts": [],
        "themes": []
      }
    ]
  }
  ```
- **Runtime reload**: after settings/resource changes, `/reload` or `ctx.reload()` from an extension command refreshes resources.

## Alignment with idiomatic Pi

Construct should generate and manage the same files a careful Pi user would write by hand:

1. Keep `~/.pi/agent/settings.json` bare: provider auth/core defaults only, not a pile of always-on workflow resources.
2. Put repo behavior in the repo: `.pi/settings.json`, `.pi/skills/`, `.pi/prompts/`, `.pi/extensions/`, `.pi/themes/`, `.pi/SYSTEM.md`, plus `AGENTS.md`/`CLAUDE.md` when appropriate.
3. Package reusable cross-project assets as Pi packages and list them per project under `.pi/settings.json` `packages`.
4. Trust is handled by Pi before project setup. Construct should not bypass, replace, or track trust.

Construct's value is not a new resource system. Its value is packaging these idioms into a friendly "load this workflow into this project" experience.

## Construct resource coverage target

Construct should cover the native Pi project resource kinds Pi already understands: packages, extensions, skills, prompt templates, and themes. Direct resources should be managed through the same settings arrays and `+path` / `-path` filters that Pi uses, while packages remain the preferred portable/shareable unit for reusable workflows.

