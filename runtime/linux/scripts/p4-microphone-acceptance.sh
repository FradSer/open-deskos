#!/usr/bin/env bash
set -euo pipefail

USB_ID="303a:7002"
CAPTURE_SECONDS="${P4_MIC_CAPTURE_SECONDS:-3}"
CDC_DEVICE="/dev/open-deskos-p4-camera"

lsusb -d "$USB_ID" >/dev/null || {
  echo "P4 native USB microphone $USB_ID is not connected." >&2
  exit 1
}

[ -c "$CDC_DEVICE" ] || {
  echo "P4 USB device is present but the CDC metadata interface is unavailable." >&2
  exit 1
}
CDC_PROPERTIES="$(udevadm info -q property -n "$CDC_DEVICE")"
printf '%s\n' "$CDC_PROPERTIES" | grep -q '^ID_VENDOR_ID=303a$' || exit 1
printf '%s\n' "$CDC_PROPERTIES" | grep -q '^ID_MODEL_ID=7002$' || exit 1

DEVICE_LINE="$(arecord -l | awk '/P4 Camera and Microphone/ { print; exit }')"
[ -n "$DEVICE_LINE" ] || {
  echo "P4 USB device is present but no ALSA capture device was found." >&2
  exit 1
}

CARD="$(printf '%s\n' "$DEVICE_LINE" | sed -n 's/^card \([0-9][0-9]*\):.*device \([0-9][0-9]*\):.*/\1/p')"
DEVICE="$(printf '%s\n' "$DEVICE_LINE" | sed -n 's/^card \([0-9][0-9]*\):.*device \([0-9][0-9]*\):.*/\2/p')"
[ -n "$CARD" ] && [ -n "$DEVICE" ] || {
  echo "Could not resolve the P4 ALSA card and device numbers." >&2
  exit 1
}

RESULT="$({
  arecord -D "hw:$CARD,$DEVICE" -t raw -f S16_LE -r 16000 -c 1 -d "$CAPTURE_SECONDS" 2>/dev/null
} | python3 -c '
import json
import math
import struct
import sys

expected_bytes = int(sys.argv[1]) * 16000 * 2
raw = sys.stdin.buffer.read()
if len(raw) < expected_bytes or len(raw) % 2:
    raise SystemExit("P4 microphone capture was truncated")
samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
mean = sum(samples) / len(samples)
centered = [sample - mean for sample in samples]
ac_peak = max(abs(sample) for sample in centered)
ac_rms = math.sqrt(sum(sample * sample for sample in centered) / len(centered))
clipped = sum(sample in (-32768, 32767) for sample in samples)
if ac_peak < 32 or ac_rms < 8:
    raise SystemExit("P4 microphone captured silence or a constant signal")
if clipped > len(samples) // 100:
    raise SystemExit("P4 microphone capture is excessively clipped")
print(json.dumps({
    "samples": len(samples),
    "min": min(samples),
    "max": max(samples),
    "mean": round(mean, 2),
    "ac_peak": round(ac_peak, 2),
    "ac_rms": round(ac_rms, 2),
    "clipped": clipped,
}))
' "$CAPTURE_SECONDS")"

printf '{"usb":"%s","alsa":"hw:%s,%s","capture":%s}\n' "$USB_ID" "$CARD" "$DEVICE" "$RESULT"
