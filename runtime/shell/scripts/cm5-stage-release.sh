#!/usr/bin/env bash
# Run from a development checkout. Stages one isolated source snapshot on CM5,
# then lets the device-owned installer build or update its immutable release.
set -euo pipefail

# Route planning before SSH, directory preparation, or the cleanup trap.
for argument in "$@"; do
  if [ "$argument" = --dry-run ] || [ "$argument" = --help ]; then
    exec node "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/cm5-release.js" "$@"
  fi
done
if [ "$#" -gt 0 ]; then
  echo '{"dryRun":true,"executionAvailable":false,"error":"invalid_arguments"}'
  exit 64
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." >/dev/null && pwd -P)"
source "${ROOT}/runtime/shell/scripts/cm5-personal-agent.sh"
TARGET="${ODK_CM5_TARGET:-cm5}"
REMOTE_ROOT="${ODK_RUNTIME_ROOT:-/opt/odk}"
STAGING_ID="${ODK_STAGING_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM}"
STAGING_DIR="${REMOTE_ROOT}/staging/${STAGING_ID}"
STAGING_ROOT="${STAGING_DIR}/repo"

cleanup() {
  ssh "${TARGET}" "rm -rf -- '${STAGING_DIR}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ssh "${TARGET}" "mkdir -p '${STAGING_ROOT}/runtime/shell' '${STAGING_ROOT}/runtime/android/app/src/main' '${STAGING_ROOT}/integrations' '${STAGING_ROOT}/experiments' '${STAGING_ROOT}/peripherals' '${STAGING_ROOT}/.agents' '${REMOTE_ROOT}/releases' '${REMOTE_ROOT}/state'"

rsync -a --delete --exclude node_modules --exclude .DS_Store --exclude 'native/odk-process/build' "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/runtime/shell/" "${TARGET}:${STAGING_ROOT}/runtime/shell/"
rsync -a --delete --exclude .DS_Store "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/runtime/android/app/src/main/" "${TARGET}:${STAGING_ROOT}/runtime/android/app/src/main/"
rsync -a --delete --exclude .DS_Store --exclude 'node_modules' "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/integrations/" "${TARGET}:${STAGING_ROOT}/integrations/"
rsync -a --delete --exclude .DS_Store "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/experiments/" "${TARGET}:${STAGING_ROOT}/experiments/"
rsync -a --delete --exclude .DS_Store --exclude 'build/' --exclude 'managed_components/' --exclude 'node_modules' "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/peripherals/" "${TARGET}:${STAGING_ROOT}/peripherals/"
rsync -a --delete --exclude .DS_Store "${RELEASE_PRIVATE_EXCLUDES[@]}" \
  "${ROOT}/.agents/" "${TARGET}:${STAGING_ROOT}/.agents/"
rsync -a "${ROOT}/DESIGN.md" "${TARGET}:${STAGING_ROOT}/DESIGN.md"
ssh "${TARGET}" "cd '${STAGING_ROOT}/runtime/shell' && bash scripts/cm5-install.sh"
