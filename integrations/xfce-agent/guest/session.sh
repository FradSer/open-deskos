#!/usr/bin/env bash
set -euo pipefail
umask 077
export LIBGL_ALWAYS_SOFTWARE=1
export NO_AT_BRIDGE=1
# Refuse persistent or shared browser storage.
runtime=${XDG_RUNTIME_DIR:?A private runtime directory is required}
test -d "$runtime" && test ! -L "$runtime"
test "$(stat -c %u -- "$runtime")" = "$(id -u)"
test "$(stat -c %a -- "$runtime")" = 700
test "$(stat -f -c %T -- "$runtime")" = tmpfs
profile=$(mktemp -d "$runtime/odk-chrome.XXXXXXXX")
export XDG_CACHE_HOME="$profile/cache"
export CHROME_LOG_FILE=/dev/null
xset s off
xset -dpms
xfconf-query -c xfce4-session -p /general/SaveOnExit -n -t bool -s false || true
xfconf-query -c xfce4-session -p /general/ShowSplash -n -t bool -s false || true
output=$(xrandr --query | awk '/ connected/{print $1;exit}')
test -n "$output"
xrandr --output "$output" --mode 1280x800
for _ in $(seq 1 60); do
  if python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/", timeout=1).read(1)' >/dev/null 2>&1; then break; fi
  sleep 1
done
exec chromium --no-first-run --no-default-browser-check --noerrdialogs \
  --disable-sync --disable-background-networking --disable-component-update \
  --disable-breakpad --disable-crash-reporter \
  --disable-features=Translate,MediaRouter --user-data-dir="$profile" --disk-cache-dir="$profile/cache" \
  --start-maximized --app=http://127.0.0.1:8080/
