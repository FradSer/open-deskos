#!/usr/bin/env bash
# Run ON the CM5 inside the synced runtime/linux directory.
# Verifies the ESP32-P4 native USB composite enumerates as a standard UVC
# camera and captures one bounded MJPEG frame without writing media to disk.
set -euo pipefail

USB_ID="303a:7002"
VIDEO_SYMLINK="/dev/open-deskos-p4-camera"

is_mjpg_node() {
  v4l2-ctl -d "$1" --list-formats-ext 2>/dev/null | grep -q 'MJPG'
}

is_p4_node() {
  local properties
  properties="$(udevadm info -q property -n "$1" 2>/dev/null)"
  printf '%s' "$properties" | grep -q 'ID_VENDOR_ID=303a' && printf '%s' "$properties" | grep -q 'ID_MODEL_ID=7002'
}

resolve_video_device() {
  if [ -e "$VIDEO_SYMLINK" ] && is_p4_node "$VIDEO_SYMLINK" && is_mjpg_node "$VIDEO_SYMLINK" ]; then
    printf '%s' "$VIDEO_SYMLINK"
    return 0
  fi
  for node in /dev/video*; do
    [ -e "$node" ] || continue
    if is_p4_node "$node" && is_mjpg_node "$node"; then
      printf '%s' "$node"
      return 0
    fi
  done
  return 1
}

lsusb -d "$USB_ID" >/dev/null || {
  echo "P4 native USB camera $USB_ID is not connected." >&2
  exit 1
}

if ! command -v v4l2-ctl >/dev/null 2>&1; then
  echo "v4l2-ctl is missing; install the v4l-utils package and retry." >&2
  exit 1
fi

VIDEO_DEVICE="$(resolve_video_device)" || {
  echo "P4 USB device is present but no MJPEG video node is available." >&2
  exit 1
}

FORMATS="$(v4l2-ctl -d "$VIDEO_DEVICE" --list-formats-ext 2>/dev/null)"
printf '%s\n' "$FORMATS" | grep -q 'MJPG' || {
  echo "P4 camera does not offer an MJPEG format." >&2
  exit 1
}
printf '%s\n' "$FORMATS" | grep -q '1280x720' || {
  echo "P4 camera does not offer the 1280x720 frame." >&2
  exit 1
}

FRAME_FILE="$(mktemp /tmp/p4-camera-frame.XXXXXX.mjpg)"
trap 'rm -f "$FRAME_FILE"' EXIT HUP INT TERM
flock -w 20 /tmp/odk-camera.lock v4l2-ctl -d "$VIDEO_DEVICE" --set-fmt-video=width=1280,height=720,pixelformat=MJPG \
  --stream-mmap --stream-count=1 --stream-to="$FRAME_FILE" >/dev/null 2>&1 || {
  echo "P4 camera capture failed." >&2
  exit 1
}
FRAME_BYTES="$(wc -c < "$FRAME_FILE")"
[ "$FRAME_BYTES" -gt 4096 ] || {
  echo "P4 camera capture was truncated or empty." >&2
  exit 1
}

printf '{"usb":"%s","video":"%s","format":"MJPG","frame":"1280x720","frame_bytes":%s}\n' \
  "$USB_ID" "$VIDEO_DEVICE" "$FRAME_BYTES"
