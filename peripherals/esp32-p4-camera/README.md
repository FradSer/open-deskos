# Open DeskOS ESP32-P4 SC2336 Camera Subsystem

ESP32-P4 + SC2336 MIPI CSI Camera Peripheral for the CM5/Linux Open DeskOS architecture. It exposes the sensor as a standard USB Video Class (UVC) MJPEG webcam and the board microphone as a standard USB Audio Class input. There is no on-device face detection, owner recognition, expression classification, metadata protocol, or biometric storage in this firmware. It is distinct from the preserved prior P4+C6 DeskOS device OS under `research/esp32-p4-c6-deskos/firmware/`.

## Architecture

```text
SC2336 RAW8 → ESP32-P4 MIPI CSI → hardware JPEG encode
  → standard UVC MJPEG bulk stream on native USB → CM5 V4L2 video device
ES8311 microphone → I2S0 → standard UAC2 PCM stream on the same USB → CM5 ALSA capture
```

The P4 reports no vendor-specific camera metadata. The CM5 opens the camera like any generic webcam (`v4l2-ctl`, `ffplay`, browsers) and the microphone like any USB audio input (`arecord`).

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

## USB Camera and Microphone

The native ESP32-P4 USB device port enumerates as a composite device with a stable identity (`303a:7002`):

- UVC carries one MJPEG function: 1280x720 at 30 fps over an isochronous endpoint.
- UAC2 exposes signed 16-bit mono PCM at 16 kHz for standard Linux ALSA capture.

The OSPTEK V1.3 baseboard schematic defines the ES8311 wiring: I2S0 MCLK GPIO 13, BCLK/SCLK GPIO 12, WS/LRCK GPIO 10, and ES8311 `ASDOUT` into the P4 capture input on GPIO 11. GPIO 9 is the opposite playback direction (`DSDIN`) and is not used by this microphone-only implementation. ES8311 and SC2336 share I2C SDA GPIO 7 and SCL GPIO 8; the codec uses the Espressif driver's `0x30` wire-format address, corresponding to 7-bit address `0x18`.

The P4 native USB pair uses GPIO 24/25 through the TS3USB221ARSER mux. Connect the CM5 to the board's native USB **data** Type-C connector; the separate CH343P debug Type-C connector cannot carry UVC video or UAC audio.

On the CM5, run the live hardware acceptance checks as the kiosk user or root:

```sh
bash runtime/linux/scripts/p4-camera-acceptance.sh
bash runtime/linux/scripts/p4-microphone-acceptance.sh
```

The camera check requires USB identity `303a:7002`, resolves the V4L2 video device, and captures a bounded MJPEG frame without writing media to disk. The microphone check requires the same USB identity, resolves the ALSA card, streams bounded raw PCM through a pipe, and rejects silence, constant data, clipping, or a truncated capture without writing speech to disk. After acceptance, set `ODESK_VOICE_AUDIO_DEVICE=plughw:CARD=Microphone,DEV=0` in the device-local Voice Agent environment rather than hardcoding a numeric card index in a release.

The board-level wiring authority is the OSPTEK [`esp32-p4c6-module-dev-board`](https://gitee.com/osptek/esp32-p4c6-module-dev-board) repository at the reviewed V1.3 baseboard schematic. The camera implementation follows the SC2336 MIPI CSI configuration demonstrated by [osptek/camera-mipi-csi-sc2336](https://github.com/osptek/camera-mipi-csi-sc2336), retaining its compatible SC2336 pins and `esp_video` capture boundary. The capture-to-JPEG-to-UVC pipeline mirrors the official `esp_video` UVC example; the USB descriptors are app-owned so the UVC camera and UAC microphone share one composite device.

## Flash Layout

The 16 MB flash carries only firmware; no model or biometric partitions exist:

| Partition | Offset | Purpose |
|---|---:|---|
| `factory` | `0x10000` | Firmware app |

## Build and Flash

Use ESP-IDF **6.0.1**:

```sh
cd peripherals/esp32-p4-camera
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

Flashing may use the USB-UART bridge, but the CM5 camera and microphone connection must use the P4 native USB device port.

## BDD Contract

Behavior scenarios are maintained in [`tests/features/p4-camera.feature`](tests/features/p4-camera.feature).
