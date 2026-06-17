#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
PROJECT_DIR="$TMP/project"
mkdir -p "$HOME_DIR" "$PROJECT_DIR"

printf '== install package into disposable HOME ==\n'
(
  cd "$ROOT"
  HOME="$HOME_DIR" pi install "$ROOT" --approve >/dev/null 2>&1
)

printf '== discover installed extension ==\n'
(
  cd "$PROJECT_DIR"
  HOME="$HOME_DIR" pi -p '/construct status' >/dev/null 2>&1
)

printf '== installed extension command smoke ==\n'
(
  cd "$PROJECT_DIR"
  HOME="$HOME_DIR" pi -p '/construct catalog add npm:@scope/pkg installed-smoke' >/dev/null 2>&1
  HOME="$HOME_DIR" pi -p '/construct catalog remove installed-smoke' >/dev/null 2>&1
)

printf 'install smoke ok\n'
