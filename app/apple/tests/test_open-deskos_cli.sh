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
cleanup() {
    rm -f "$invalid_output" "$unavailable_output" "$configuration_test_binary"
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

python3 -u -c 'import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",18787)); s.listen(2); nl=bytes([13,10]);
for _ in range(2): c,_=s.accept(); c.recv(4096); c.sendall(b"HTTP/1.1 200 OK"+nl+b"Content-Length: 2"+nl+b"Connection: close"+nl+nl+b"ok"); c.close()
s.close()' >/dev/null 2>&1 &
server_pid=$!
sleep 1
FLOW_API_PORT=18787 "$OPEN_DESKOSCTL" plugin health | rg -q 'Wispr Flow: healthy \(HTTP 200'
FLOW_API_PORT=invalid "$OPEN_DESKOSCTL" plugin health --url http://127.0.0.1:18787/health | rg -q 'Wispr Flow: healthy \(HTTP 200'
wait "$server_pid" 2>/dev/null || true
server_pid=''

state_home=$(mktemp -d "${TMPDIR:-/tmp}/open-deskos-cli-state.XXXXXX")
mkdir -p "$state_home/Library/Application Support"
: >"$state_home/Library/Application Support/OpenDeskOS"
python3 -u -c 'import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",18788)); s.listen(1); c,_=s.accept(); c.recv(4096); nl=bytes([13,10]); c.sendall(b"HTTP/1.1 200 OK"+nl+b"Content-Length: 2"+nl+b"Connection: close"+nl+nl+b"ok"); c.close(); s.close()' >/dev/null 2>&1 &
server_pid=$!
sleep 1
CFFIXED_USER_HOME="$state_home" "$OPEN_DESKOSCTL" plugin health --daemon --url http://127.0.0.1:18788/health | rg -q 'Wispr Flow: healthy \(HTTP 200'
wait "$server_pid" 2>/dev/null || true
server_pid=''

unavailable_output=$(mktemp)
if "$OPEN_DESKOSCTL" plugin health --url http://127.0.0.1:1/health --timeout 1 >"$unavailable_output" 2>&1; then
    print -u2 'expected an unavailable sidecar to fail'
    exit 1
fi
rg -q 'Wispr Flow is unavailable' "$unavailable_output"

print 'OpenDeskOS CLI acceptance checks passed'
