#!/bin/zsh
set -euo pipefail

: "${OPEN_DESKOSCTL:?Set OPEN_DESKOSCTL to the built OpenDeskOS executable}"

project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." >/dev/null && pwd -P)
configuration_test_binary=$(mktemp "${TMPDIR:-/tmp}/open-deskos-daemon-configuration.XXXXXX")
help="$("$OPEN_DESKOSCTL" --help)"
printf '%s\n' "$help" | rg -q 'plugin health'
printf '%s\n' "$help" | rg -q 'daemon install'
printf '%s\n' "$help" | rg -q 'daemon uninstall'
printf '%s\n' "$help" | rg -q 'daemon status'

"$OPEN_DESKOSCTL" daemon status | rg -q 'Daemon: '

invalid_output=$(mktemp)
unavailable_output=''
state_home=''
server_pid=''
fixture_directory=$(mktemp -d "${TMPDIR:-/tmp}/open-deskos-cli-http.XXXXXX")
cleanup() {
    rm -f "$invalid_output" "$unavailable_output" "$configuration_test_binary"
    rm -rf "$fixture_directory"
    if [[ -n "$state_home" ]]; then
        rm -rf "$state_home"
    fi
    if [[ -n "$server_pid" ]]; then
        kill "$server_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT

xcrun swiftc \
    "$project_dir/OpenDeskOSCLI/CLIError.swift" \
    "$project_dir/OpenDeskOSCLI/PluginHealth.swift" \
    "$project_dir/OpenDeskOSCLI/LaunchAgent.swift" \
    "$project_dir/tests/DaemonInstallConfigurationTests.swift" \
    -o "$configuration_test_binary"
"$configuration_test_binary"

if "$OPEN_DESKOSCTL" plugin health --timeout 0 >"$invalid_output" 2>&1; then
    print -u2 'expected --timeout 0 to fail'
    exit 1
fi
rg -q 'Timeout must be between 1 and 60 seconds' "$invalid_output"

# One isolated server covers all health calls; port 0 avoids occupied fixture ports.
python3 -u - "$fixture_directory/port" <<'PY_FIXTURE' >/dev/null 2>&1 &
import pathlib
import socket
import sys

with socket.socket() as server:
    server.bind(("127.0.0.1", 0))
    server.listen(3)
    server.settimeout(15)
    pathlib.Path(sys.argv[1]).write_text(str(server.getsockname()[1]))
    for _ in range(3):
        connection, _ = server.accept()
        with connection:
            connection.settimeout(5)
            connection.recv(4096)
            connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
PY_FIXTURE
server_pid=$!
for _ in {1..100}; do
    [[ -s "$fixture_directory/port" ]] && break
    sleep 0.05
done
[[ -s "$fixture_directory/port" ]] || { print -u2 'health fixture did not start'; exit 1; }
fixture_port=$(cat "$fixture_directory/port")
fixture_url="http://127.0.0.1:$fixture_port/health"
FLOW_API_PORT="$fixture_port" "$OPEN_DESKOSCTL" plugin health | rg -q 'Wispr Flow: healthy \(HTTP 200'
FLOW_API_PORT=invalid "$OPEN_DESKOSCTL" plugin health --url "$fixture_url" | rg -q 'Wispr Flow: healthy \(HTTP 200'

state_home=$(mktemp -d "${TMPDIR:-/tmp}/open-deskos-cli-state.XXXXXX")
mkdir -p "$state_home/Library/Application Support"
: >"$state_home/Library/Application Support/OpenDeskOS"
CFFIXED_USER_HOME="$state_home" "$OPEN_DESKOSCTL" plugin health --daemon --url "$fixture_url" | rg -q 'Wispr Flow: healthy \(HTTP 200'
wait "$server_pid"
server_pid=''

unavailable_output=$(mktemp)
if "$OPEN_DESKOSCTL" plugin health --url http://127.0.0.1:1/health --timeout 1 >"$unavailable_output" 2>&1; then
    print -u2 'expected an unavailable sidecar to fail'
    exit 1
fi
rg -q 'Wispr Flow is unavailable' "$unavailable_output"

print 'OpenDeskOS CLI acceptance checks passed'
