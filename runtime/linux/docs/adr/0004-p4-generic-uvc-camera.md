# P4 camera as a generic UVC webcam and microphone

## Status

Accepted

## Context

The ESP32-P4 SC2336 peripheral ran on-device face detection, owner recognition with a physical enrollment button, expression gating research, and a versioned JSON metadata protocol over USB CDC, consumed on CM5 by the Face Agent experiment (`experiments/vision/face-agent/`, `src/face-agent-status.js`, Face presence / Current emotion tiles, `odk-face-agent-status` IPC). The product direction is that the P4 is positioned like the board microphone: a standard-class USB device with no on-device analysis and no biometric storage.

## Decision

- The P4 firmware exposes one composite USB device (`303a:7002`): a standard UVC MJPEG camera (1280x720 at 30 fps, isochronous) plus the existing standard UAC microphone (16-bit mono PCM at 16 kHz). The CDC metadata interface is removed.
- All face detection, owner recognition, physical enrollment, expression policy, metadata protocol, diagnostic snapshots, face-model flash partitions, and biometric storage are deleted from `peripherals/esp32-p4-camera/`. Capture (`p4_sc2336`), MJPEG encode plus UVC push (`p4_uvc_stream`), microphone (`p4_usb_microphone`), and app-owned UVC+UAC descriptors (`usb_descriptors.c`) are the only firmware modules.
- The CM5 Face Agent chain is deleted in full: the `experiments/vision/` service, the Electron status normalizer and IPC endpoint, the Face presence / Current emotion tiles and their layout slots, the experimental owner-lock shield, the installer provisioning block, and the CDC udev rule. The udev rule now binds the V4L2 device (`SUBSYSTEM=="video4linux"` → `/dev/open-deskos-p4-camera`).
- Hardware acceptance is `runtime/linux/scripts/p4-camera-acceptance.sh` (USB identity, V4L2 MJPEG 1280x720, one bounded frame via v4l2-ctl, no media written) alongside the CDC-free `p4-microphone-acceptance.sh`.

## Consequences

- CM5 consumes the camera through standard V4L2 tooling (`v4l2-ctl`, `ffplay`); no vendor driver, metadata parser, or loopback status service exists.
- The wayfinding ticket `005-face-agent-python-host-contract` is withdrawn; its file remains as exploration history.
- Isochronous was chosen over bulk after hardware verification: bulk has no zero-bandwidth alternate setting, so the device streams forever once committed and every new host session joins mid-frame (torn first frames). With isochronous alt 0 carrying no endpoint, each host session starts on a fresh frame boundary. The Home 1x1 camera tile polls one frame per interval and depends on this.
- UVC streaming and the unified UVC+UAC descriptors must pass the CM5 acceptance scripts on hardware before release; the firmware build (`idf.py build` under ESP-IDF 6.0.1) verifies compilation only.
- Home grid column 4 rows 2-3 are intentionally unassigned after the tile removal; a later design pass may rebalance the layout.
