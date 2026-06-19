# AGENTS.md

This repo is for **the-construct**, a global Pi extension / Pi package whose command surface is `/construct`.

This is a Pi-native project. Before reaching for external web docs, use Pi's installed local documentation, local examples, and this repo's docs as the source of truth. Work smarter: verify against the APIs and behavior that are already on this machine.

## Project intent

- Build a friendly loadout manager for idiomatic Pi project-local config.
- Do not build a new package manager.
- The source of truth for project setup should remain normal Pi files like `.pi/settings.json`, `.pi/prompts/`, `.pi/skills/`, `.pi/extensions/`, and project package declarations.
- Keep global Pi lean; the global extension should provide commands, catalog/import/export, and onboarding only.

## Current status

- MVP implementation exists.
- Entry point: `extensions/construct/index.ts`.
- Main plan: `the-construct-plan.md`.
- Main validation: `./scripts/smoke.sh` plus disposable installed-package checks.

## Safety rules

- Do **not** edit live global Pi files unless explicitly requested:
  - `~/.pi/agent/auth.json`
  - `~/.pi/agent/settings.json`
  - `~/.pi/agent/npm/`
  - `~/.pi/agent/git/`
- Do not install the extension into the live global Pi config unless explicitly requested.
- Test extension loading explicitly:
  ```bash
  pi --no-extensions -e .
  ```
- Test package install/discovery only with a disposable `HOME`, for example:
  ```bash
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/home" "$TMP/project"
  HOME="$TMP/home" pi install "$PWD" --approve
  (cd "$TMP/project" && HOME="$TMP/home" pi -p '/construct status')
  ```
- Prefer disposable fixture projects for testing project-local writes.
- Before editing any `.pi/settings.json`, create a backup.
- `/construct` should be the primary loadout surface; keep extra slash commands out unless they are clearly needed.
- Never write secrets, tokens, API keys, or auth material.

## Pi docs and local resources first

Use the installed Pi docs as the source of truth before web search. Only go outside when the local Pi docs/examples and repo files do not answer the question, or when the user explicitly asks for outside research.

Start with:

- Main docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Additional docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
- Examples: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/`
- Local Pi package install/cache behavior can be inspected under `~/.pi/agent/` when needed, but do not edit live global Pi files without explicit request.

Key docs:

- Extensions: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Packages: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Settings/project trust: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- Skills: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Prompt templates: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/prompt-templates.md`
- TUI/custom UI: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Examples: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

Relevant examples to review when coding:

- `project-trust.ts` only to understand Pi trust; the-construct should not own trust in MVP.
- `commands.ts` for slash command listing patterns.
- `tools.ts` for simple settings-list UI patterns.
- `dynamic-resources/index.ts` for future cwd/profile ideas, not MVP.
- `reload-runtime.ts` for safe reload command behavior.

## Current command surface

Primary public commands:

- `/construct`
- `/construct status`
- `/construct`
- `/construct status`
- `/construct sync`
- `/construct sync -a`
- `/construct sync status`
- `/construct reload`

Do not re-add load/unload/toggle/library/remember/forget/catalog compatibility commands without an explicit product decision. The current bias is one quiet menu plus minimal support commands.

## Naming

- Extension/package/project name: `the-construct`.
- User command: `/construct`.
- Human prompt: `Load it into the Construct? y/n`.

## Git/project hygiene

- Do not add generated package caches to this repo.
- Do not commit secrets.
- Keep plans/docs readable and low-tech.
