#!/usr/bin/env bash
# CM5 entry point for the Shell acceptance checks. The checks themselves live in
# tests/smoke.mjs so a Windows Shell Host, which has no bash, runs the same rules
# instead of a second copy of them.
set -euo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

exec node tests/smoke.mjs "$@"
