# Open DeskOS ESP32-P4 Face Agent

> Status: opt-in experiment for the active CM5/Linux runtime. It cannot gate base-shell installation, boot, direct input, or visibility.

Face analysis runs exclusively on the connected ESP32-P4 SC2336 Camera Peripheral. The CM5 Face Agent is a loopback-only adapter: it reads versioned metadata from the P4 USB CDC serial device, validates it fail-closed, and exposes only a bounded status response for Electron.

## Active data boundary

```text
SC2336 → ESP32-P4 MIPI CSI → ESP-DL detection / feature match
       → USB CDC JSON Lines → CM5 Face Agent → 127.0.0.1:8790/status → Electron
```

The P4 owns camera capture, image conversion, face detection, landmarks, feature extraction, owner-feature storage, physical enrollment, and recognition. It sends no image frames to CM5.

CM5 never opens a UVC or V4L2 video device, runs local OpenCV or ONNX face inference, stores face profiles, or offers remote enrollment. The only accepted input device is `/dev/open-deskos-p4-camera`, created by the CM5 udev rule for the P4 USB CDC adapter.

## P4 owner enrollment

Put exactly one valid face in the P4 camera view and press the P4 **BOOT/GPIO 0** button. The P4 consumes the confirmation for one enrollment attempt within 30 seconds and persists the feature and configured owner label locally. The CM5 has no enrollment endpoint.

## Status endpoint

The service listens only at `http://127.0.0.1:8790/status`. `runtime/linux/src/face-agent-status.js` consumes it and exposes a limited UI state.

The adapter rejects malformed records, unsupported protocol versions, inconsistent face counts, out-of-bounds geometry, invalid scores, non-monotonic sequences, and records stale for more than three seconds. A disconnected, invalid, or stale P4 link returns an unavailable camera state; it never causes a CM5 camera fallback.

The endpoint is an experimental status seam. It must not make the shell unavailable or expose raw camera images, biometric feature vectors, or remote identity-creation controls.

## Installation

The integration is installed only with `ODESK_INSTALL_EXPERIMENTAL_VISION=1` through `runtime/linux/scripts/cm5-install.sh`. The P4 firmware is built separately from `peripherals/esp32-p4-camera/` using ESP-IDF 6.0.1.
