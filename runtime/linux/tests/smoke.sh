#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." >/dev/null && pwd -P)"
cd "$root"

./node_modules/.bin/unocss "src/renderer/**/*.html" "src/renderer/**/*.js" \
  -c uno.config.mjs -o src/renderer/uno.css --minify >/dev/null

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

run_smoke() {
  local expected_w="$1" expected_h="$2"
  shift 2
  local output_file result_file line
  output_file=$(mktemp)
  result_file=$(mktemp)
  if ! ODESK_SMOKE_RESULT_FILE="$result_file" timeout 30s env "$@" ./run.sh --smoke >"$output_file"; then
    if [ ! -s "$result_file" ]; then
      rm -f "$output_file" "$result_file"
      fail "smoke process did not finish successfully"
    fi
  fi
  line=$(tail -n 1 "$result_file")
  rm -f "$output_file" "$result_file"
  echo "smoke: $line"
  [[ "$line" == *'"ok":true'* ]] || fail "smoke reported not ok: $line"
  [[ "$line" == *"\"width\":${expected_w}"* ]] || fail "expected width ${expected_w}, got: $line"
  [[ "$line" == *"\"height\":${expected_h}"* ]] || fail "expected height ${expected_h}, got: $line"
}

echo "== scenario: default size =="
run_smoke 1920 1280

echo "== scenario: no inline styles in index.html =="
if grep -q 'style=' src/renderer/index.html; then
  fail "index.html carries inline styles; placement belongs in config/desktop_layout.js"
fi

echo "== scenario: index.html stays a skeleton =="
if sed '/<script/d' src/renderer/index.html | grep -qE 'widget|dash-|quota|w-clock|almanac|sb-net|sb-time|status-summary|tabler".*bolt'; then
  fail "index.html contains element markup; everything visible is mounted from plugins"
fi

echo "== scenario: shell core stays plugin-free =="
if grep -RIlE 'almanac|pomodoro|quota|dash-narrative|w-clock-time|w-chat|w-settings|sb-net|sb-time' src/renderer/shell.js src/renderer/core/ >/dev/null 2>&1; then
  fail "shell core references element specifics; move them into plugins/"
fi

[ -s src/renderer/uno.css ] || fail "UnoCSS output is missing"

for f in \
  src/renderer/core/overlay-alerts.js \
  src/renderer/core/registry.js \
  src/renderer/core/services.js \
  src/renderer/core/composer.js \
  src/renderer/config/desktop_layout.js \
  docs/AI_PLUGIN_GUIDE.md; do
  [ -f "$f" ] || fail "missing $f"
done

echo "== scenario: env override =="
run_smoke 480 854 ODESK_SHELL_WIDTH=480 ODESK_SHELL_HEIGHT=854

node tests/check_tokens.mjs
node tests/layout-harness.mjs

echo "ALL SMOKE CHECKS PASSED"
