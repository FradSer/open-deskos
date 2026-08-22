#!/usr/bin/env bash
# codeterrier-review: device-flow login.
# POST /api/device -> print activation URL -> poll /api/device/status with the
# opaque device code until the token is issued -> save to ~/.codeterrier/token.
# Works in any agent's shell (no gh).
#
# Usage:
#   bash login.sh [--base-url <https://codeterrier.com>]
#
# Env:
#   CODETERRIER_BASE_URL  override the API base (default https://codeterrier.com)
#   CODETERRIER_TOKEN_FILE  where the token is saved (default ~/.codeterrier/token)

set -u

BASE_URL="${CODETERRIER_BASE_URL:-https://codeterrier.com}"
TOKEN_FILE="${CODETERRIER_TOKEN_FILE:-$HOME/.codeterrier/token}"
POLL_INTERVAL=5
MAX_POLLS=120 # 10 minutes

# Resolve --base-url flag.
while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) [ $# -ge 2 ] && BASE_URL="$2" && shift 2 ;;
    *) shift ;;
  esac
done

# A token already exists? Nothing to do.
if [ -n "${CODETERRIER_TOKEN:-}" ]; then
  echo "CODETERRIER_TOKEN is set — already authenticated." >&2
  exit 0
fi
if [ -f "$TOKEN_FILE" ] && [ -s "$TOKEN_FILE" ]; then
  echo "Token already saved at $TOKEN_FILE — run with CODETERRIER_TOKEN or delete it to re-login." >&2
  exit 0
fi

echo "Requesting a device code from $BASE_URL ..." >&2
res=$(curl -sS -X POST "$BASE_URL/api/device") || {
  echo "login: could not reach $BASE_URL/api/device" >&2
  exit 1
}

# Parse the response with jq; fall back to a plain echo on parse failure.
user_code=$(printf '%s' "$res" | jq -r '.userCode // empty' 2>/dev/null)
device_code=$(printf '%s' "$res" | jq -r '.deviceCode // empty' 2>/dev/null)
verification_uri=$(printf '%s' "$res" | jq -r '.verificationUri // empty' 2>/dev/null)
poll_interval=$(printf '%s' "$res" | jq -r '.interval // empty' 2>/dev/null)
expires_in=$(printf '%s' "$res" | jq -r '.expiresIn // empty' 2>/dev/null)
[ -n "$poll_interval" ] && POLL_INTERVAL="$poll_interval"
if [ -n "$expires_in" ] && [ "$POLL_INTERVAL" -gt 0 ]; then
  MAX_POLLS=$((expires_in / POLL_INTERVAL + 1))
fi

if [ -z "$user_code" ] || [ -z "$device_code" ]; then
  echo "login: bad response from /api/device: $res" >&2
  exit 1
fi

echo
echo "  Open ${verification_uri:-$BASE_URL/activate?user_code=$user_code}"
echo
echo "Waiting for you to authorize in the browser ..." >&2

polls=0
while [ "$polls" -lt "$MAX_POLLS" ]; do
  polls=$((polls + 1))
  status_res=$(curl -sS -X POST "$BASE_URL/api/device/status" \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg device_code "$device_code" '{device_code: $device_code}')") || {
    sleep "$POLL_INTERVAL"
    continue
  }
  status=$(printf '%s' "$status_res" | jq -r '.status // empty' 2>/dev/null)
  if [ "$status" = "authorized" ]; then
    token=$(printf '%s' "$status_res" | jq -r '.token // empty' 2>/dev/null)
    if [ -z "$token" ]; then
      echo "login: authorized but no token in response" >&2
      exit 1
    fi
    mkdir -p "$(dirname "$TOKEN_FILE")" 2>/dev/null || true
    printf '%s\n' "$token" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "Device linked! Token saved to $TOKEN_FILE" >&2
    exit 0
  fi
  if [ "$status" = "expired" ]; then
    echo "login: code expired — run login.sh again for a fresh code." >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL"
done

echo "login: timed out waiting for authorization." >&2
exit 1
