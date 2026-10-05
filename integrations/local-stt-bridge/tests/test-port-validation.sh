#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
SCRIPT="${ROOT_DIR}/scripts/provision-stt-bridge.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "${fixture_directory}"' EXIT
# Always stop at the non-root guard, including when the test runner is root.
printf '#!/usr/bin/env bash\nprintf "1234\\n"\n' > "${fixture_directory}/id"
chmod +x "${fixture_directory}/id"

for value in 1 65535; do
  output="$(ODK_STT_PORT="${value}" PATH="${fixture_directory}:${PATH}" bash "${SCRIPT}" 2>&1 || true)"
  [[ "${output}" == *"Run as root: provisioning writes"* ]]
  [[ "${output}" != *"between 1 and 65535"* ]]
done

for value in 0 65536 99999 invalid ' '; do
  output="$(ODK_STT_PORT="${value}" PATH="${fixture_directory}:${PATH}" bash "${SCRIPT}" 2>&1 || true)"
  if [[ "${output}" != *"between 1 and 65535"* ]]; then
    echo "invalid STT port did not fail validation: '${value}'" >&2
    exit 1
  fi
  [[ "${output}" != *"Run as root: provisioning writes"* ]]
done
