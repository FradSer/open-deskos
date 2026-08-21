#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." >/dev/null && pwd -P)"
cd "$root"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

run_smoke() {
  local expected_w="$1" expected_h="$2"
  shift 2
  local line
  line=$(env "$@" ./node_modules/.bin/electron . --smoke | tail -n 1)
  echo "smoke: $line"
  [[ "$line" == *'"ok":true'* ]] || fail "smoke reported not ok: $line"
  [[ "$line" == *"\"width\":${expected_w}"* ]] || fail "expected width ${expected_w}, got: $line"
  [[ "$line" == *"\"height\":${expected_h}"* ]] || fail "expected height ${expected_h}, got: $line"
}

echo "== scenario: default size =="
run_smoke 568 1232

echo "== scenario: env override =="
run_smoke 480 854 ODESK_SHELL_WIDTH=480 ODESK_SHELL_HEIGHT=854

node tests/check_tokens.mjs

echo "ALL SMOKE CHECKS PASSED"
