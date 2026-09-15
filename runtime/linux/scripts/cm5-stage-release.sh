#!/usr/bin/env bash
# Run from a development checkout. Stages one isolated source snapshot on CM5,
# then lets the device-owned installer build or update its immutable release.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." >/dev/null && pwd -P)"
TARGET="${ODK_CM5_TARGET:-cm5}"
REMOTE_ROOT="${ODK_RUNTIME_ROOT:-/opt/open-deskos}"
STAGING_ID="${ODK_STAGING_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM}"
STAGING_DIR="${REMOTE_ROOT}/staging/${STAGING_ID}"
STAGING_ROOT="${STAGING_DIR}/repo"

cleanup() {
  ssh "${TARGET}" "rm -rf -- '${STAGING_DIR}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ssh "${TARGET}" "mkdir -p '${STAGING_ROOT}/runtime/linux' '${STAGING_ROOT}/integrations' '${STAGING_ROOT}/experiments' '${STAGING_ROOT}/peripherals' '${REMOTE_ROOT}/releases' '${REMOTE_ROOT}/state'"

rsync -a --delete --exclude node_modules --exclude .DS_Store \
  "${ROOT}/runtime/linux/" "${TARGET}:${STAGING_ROOT}/runtime/linux/"
rsync -a --delete --exclude .DS_Store --exclude 'node_modules' --exclude '.env*' --exclude 'auth.json' --exclude '.pi' --exclude '*.env' \
  "${ROOT}/integrations/" "${TARGET}:${STAGING_ROOT}/integrations/"
rsync -a --delete --exclude .DS_Store \
  "${ROOT}/experiments/" "${TARGET}:${STAGING_ROOT}/experiments/"
rsync -a --delete --exclude .DS_Store --exclude 'build/' --exclude 'managed_components/' --exclude 'node_modules' \
  "${ROOT}/peripherals/" "${TARGET}:${STAGING_ROOT}/peripherals/"
rsync -a "${ROOT}/DESIGN.md" "${TARGET}:${STAGING_ROOT}/DESIGN.md"
ssh "${TARGET}" "cd '${STAGING_ROOT}/runtime/linux' && bash scripts/cm5-install.sh"
