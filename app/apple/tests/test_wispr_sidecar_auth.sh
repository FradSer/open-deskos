#!/bin/zsh
set -euo pipefail

project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." >/dev/null && pwd -P)
bundled_bun="$project_dir/OpenDeskOS/Resources/plugins/wispr/bun"
bun_command="${BUN:-bun}"
bundle="$project_dir/OpenDeskOS/Resources/plugins/wispr/server.bundle.js"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/open-deskos-wispr-auth.XXXXXX")
port=$((20_000 + ($$ % 10_000)))
server_pid=''

cleanup() {
    if [[ -n "$server_pid" ]]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$temporary_directory"
}
trap cleanup EXIT

if [[ -x "$bundled_bun" ]]; then
    bun_command="$bundled_bun"
fi
if ! command -v "$bun_command" >/dev/null; then
    print 'skipped: Bun runtime is not available for sidecar integration testing'
    exit 0
fi
rg -q 'hostname: "127.0.0.1"' "$bundle"

session_path="$temporary_directory/session.json"
printf '%s' '{"test-auth-token":"{\"access_token\":\"test-token\"}"}' >"$session_path"

FLOW_SESSION_PATH="$session_path" \
FLOW_API_PORT="$port" \
FLOW_API_TOKEN='background-check-secret' \
"$bun_command" "$bundle" >"$temporary_directory/server.log" 2>&1 &
server_pid=$!

health_url="http://127.0.0.1:$port/health"
for _ in {1..30}; do
    if curl --silent --fail --max-time 1 "$health_url" >"$temporary_directory/health.json" 2>/dev/null; then
        break
    fi
    sleep 0.1
done

if ! test -s "$temporary_directory/health.json"; then
    sed -n '1,80p' "$temporary_directory/server.log" >&2
    exit 1
fi
rg -q '"ok":true' "$temporary_directory/health.json"

response_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
    --request POST "http://127.0.0.1:$port/transcribe")
test "$response_status" = '401'

print 'Wispr Flow health authentication acceptance checks passed'
