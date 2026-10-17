#!/bin/sh
# Installed at one root-owned host path; sudoers permits no arguments.
[ "$#" -eq 0 ] || exit 2
cd / || exit 2
for path in / /usr /usr/local /usr/local/libexec /usr/local/libexec/odk-xorg-bgra-verify /usr/local/libexec/odk-xorg-bgra-verify.py; do
  [ ! -L "$path" ] || exit 2
  owner=$(/usr/bin/stat -c '%u:%g' "$path") || exit 2
  mode=$(/usr/bin/stat -c '%a' "$path") || exit 2
  [ "$owner" = '0:0' ] && [ "$((0$mode & 022))" -eq 0 ] || exit 2
  case "$path" in
    /usr/local/libexec/odk-xorg-bgra-verify*) [ -f "$path" ] || exit 2 ;;
    *) [ -d "$path" ] || exit 2 ;;
  esac
done
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I -S /usr/local/libexec/odk-xorg-bgra-verify.py
