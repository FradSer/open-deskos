#!/usr/bin/env bash
set -euo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && pwd -P)"
cd "$DIR"

if [ ! -x node_modules/.bin/electron ]; then
  echo "electron not installed; run: pnpm install (or npm install)" >&2
  exit 1
fi

exec ./node_modules/.bin/electron . "$@"
