#!/usr/bin/env bash
# Provision Tailscale for a desk on the Linux reference host.
#
# Same reuse rule as the Windows script: a host that already has Tailscale keeps
# its installation, its login, and its configuration. Only a host with none gets
# one, and the login stays the operator's act.
set -euo pipefail

COMMAND="${ODESK_TAILSCALE_BIN:-/usr/bin/tailscale}"
REPORT=0
[ "${1:-}" = "--report" ] && REPORT=1

state() {
  if [ ! -x "$COMMAND" ]; then
    echo absent
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo installed
    return
  fi
  "$COMMAND" status --json 2>/dev/null | jq -r '"installed-" + (.BackendState // "unknown")' || echo installed-unreadable
}

STATE="$(state)"
echo "tailscale: ${STATE} (${COMMAND})"

if [ "$STATE" != "absent" ]; then
  echo "reused the host installation; nothing was installed, changed, or logged in"
  [ "$STATE" = "installed-NeedsLogin" ] && echo "complete the login on the desk: '$COMMAND up' prints a URL to open"
  exit 0
fi

if [ "$REPORT" = "1" ]; then
  echo "absent: Tailscale is not installed on this host"
  exit 0
fi

echo "installing Tailscale for this host"
curl -fsSL https://tailscale.com/install.sh | sh
echo "tailscale: $(state)"
echo "complete the login on the desk: '$COMMAND up' prints a URL to open"