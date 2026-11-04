#!/usr/bin/env bash
# Device-side release gate. The full test suite runs once on the staging host and
# is bound to a content receipt; here the artifact must prove it belongs on this
# host: dependency integrity, the style build the sealed release will serve, and
# the pre/post-activation Electron smoke that update-runtime.js already runs.
set -euo pipefail
DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"
node scripts/validate-runtime-dependencies.js "$DIR"
pnpm styles