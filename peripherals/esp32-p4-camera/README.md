# Open DeskOS ESP32-P4 SC2336 Camera Subsystem

ESP32-P4 + SC2336 MIPI CSI Camera Peripheral for the CM5/Linux Open DeskOS architecture. It owns face detection, owner-recognition research, feature storage, and USB metadata transport. It is distinct from the preserved prior P4+C6 DeskOS device OS under `research/esp32-p4-c6-deskos/firmware/`.

## Architecture

```text
SC2336 BGGR RAW8 → ESP32-P4 MIPI CSI → bounded PSRAM frame copy
  → BGGR-to-RGB565 conversion → ESP-DL face detection / owner feature match
  → newline-delimited metadata on USB-UART → CM5 Face Agent → Electron widgets
```

The P4 reports metadata only. It never sends full camera frames to the CM5.

## Hardware Pinout

| Signal | ESP32-P4 Pin | Notes |
|---|---:|---|
| MIPI CSI-2 Data0 | D0P / D0N | Differential lane 0 |
| MIPI CSI-2 Data1 | D1P / D1N | Differential lane 1 |
| MIPI CSI-2 Clock | CLKP / CLKN | Differential clock lane |
| SCCB SDA | GPIO 7 | I2C master data |
| SCCB SCL | GPIO 8 | I2C master clock at 100 kHz |
| Camera Reset | GPIO 26 | Active-low reset |
| Power Down | -1 | Unconnected |
| Owner confirmation | GPIO 0 / BOOT | Active-low; required for physical enrollment |

The implementation follows the SC2336 MIPI CSI configuration demonstrated by [osptek/camera-mipi-csi-sc2336](https://github.com/osptek/camera-mipi-csi-sc2336), retaining its compatible SC2336 pins and `esp_video` capture boundary.

## Experimental Owner Recognition

The P4 uses the ESP-DL MSR/MNP face detector and MFN face-feature model. Owner recognition is an opt-in privacy experiment, not a base-shell gate.

- No face, unknown face, malformed metadata, stale metadata, or a failed P4 link leaves the experimental owner-recognition state unavailable; it does not block the CM5 shell.
- The feature database and owner-to-feature mapping live on the P4 in its `storage` and NVS partitions.
- The CM5 only validates and displays the P4 result; it never creates an identity or unlock result from missing data.
- P4 revision v1.3 captures SC2336 RAW8 through the CSI bypass path, then converts a bounded frame copy to RGB565 for ESP-DL. It does not require the unavailable pre-v3 CSI bridge color conversion.

### Enroll the owner

Enrollment is performed on the P4 alone; no CM5 request, serial command, or HTTP endpoint can trigger it. Put exactly one valid face in the camera view, then press the P4's active-low **BOOT/GPIO 0** button. The next inference result is a one-shot enrollment attempt for the configured local owner label (`Frad` by default); the request is cleared immediately. If no result arrives within 30 seconds, it is cleared without enrollment.

A successful future recognition reports `unlocked: true` for experimental consumers. Zero faces, multiple faces, an invalid face, a non-match, or an expired confirmation window never changes the owner database or claims recognition.

## Metadata Protocol (`v: 1`)

```json
{
  "v": 1,
  "online": true,
  "width": 1280,
  "height": 720,
  "sequence": 42,
  "current_face_index": 0,
  "faces_count": 1,
  "any_unlocked": true,
  "processing_time_ms": 101.2,
  "faces": [
    {
      "box": [120, 80, 160, 200],
      "landmarks": [[150, 130], [230, 130], [190, 165], [160, 220], [220, 220]],
      "detect_score": 0.92,
      "face_id": {
        "unlocked": true,
        "user": "Frad",
        "similarity": 0.88,
        "threshold": 0.75
      },
      "emotion": {
        "primary": "",
        "confidence": 0
      }
    }
  ]
}
```

The CM5 requires an exact protocol version, monotonic sequence, face-count/array agreement, bounded boxes and scores, five landmarks per face, and valid current-face selection. It fails closed on anything else.

## Flash Layout

The 16 MB flash is partitioned for owner recognition:

| Partition | Offset | Purpose |
|---|---:|---|
| `factory` | `0x10000` | Firmware app |
| `human_face_det` | `0x610000` | Packed MSR/MNP detector model |
| `human_face_feat` | `0x650000` | Packed MFN feature model |
| `storage` | `0x7d0000` | Persistent face feature database |

## Build and Flash

Use ESP-IDF **6.0.1**:

```sh
cd peripherals/esp32-p4-camera
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

`idf.py flash` includes the firmware, partition table, and both model partitions. When the USB-UART bridge is unreliable for the roughly 5 MB complete image, use `esptool` at 115200 baud and keep the Face Agent stopped while flashing.

## BDD Contract

Behavior scenarios are maintained in [`tests/features/p4-camera.feature`](tests/features/p4-camera.feature).
