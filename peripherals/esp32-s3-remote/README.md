# Open DeskOS S3 Remote Control

Required architecture peripheral for the active CM5/Linux runtime. It is distinct from the preserved prior P4+C6 DeskOS device OS.

Standalone ESP-IDF firmware for the **Waveshare ESP32-S3 Touch LCD 2.8**. It
uses the board's USB-Serial/JTAG port as a high-speed bidirectional protocol interface. It receives newline-delimited authoritative v1 state JSON and sends versioned Remote Touchpad input records.

## Interaction Architecture (Apple TV Remote + Contextual Touch Bar)

The remote interface is divided into three functional vertical sections:

1. **Top Section: Apple TV Style Touchpad / Clickpad**
   - **4-Way Directional Navigation is ALWAYS available**:
     - Outer cardinal ring: Tapping `UP`, `DOWN`, `LEFT`, or `RIGHT` directly emits `up`, `down`, `left`, `right`.
     - Touch surface gestures: Swiping in any cardinal direction (minimum 40 pixels) emits `up`, `down`, `left`, `right`.
   - **Center Action**:
     - Tapping the center `SELECT` area emits `primary`.
     - Holding the center area for at least 600 ms emits `secondary`.
   - Navigation is never blocked by current page or mode: directional navigation is an always-accessible control surface.

2. **Middle Section: Dedicated System Controls**
   - Directly below the touchpad:
     - **`< BACK`**: Tapping emits `back` (returns from focused controls, closes modals, or goes back).
     - **`MIC`**: Emits `mic` to the CM5 resident Voice Agent. Click once to record from the CM5 Linux default microphone, then again to stop and submit; recording also ends after 30 seconds. The Remote transports button input, not audio. The independent service transcribes through a configured OpenAI-compatible endpoint and invokes Pi capabilities; missing microphone, credentials, or service is reported by the shell rather than treated as success. See [Voice Agent](../../integrations/voice-agent/README.md) for setup and verification limits.

3. **Bottom Section: Contextual Touch Bar**
   - A dynamic action bar at the bottom of the screen (similar to MacBook Touch Bar).
   - Populated dynamically by the current active page or plugin through the authoritative CDC state payload:
     ```json
     "actions": [
       { "id": "refresh", "label": "SYNC" },
       { "id": "toggle", "label": "MODE" }
     ]
     ```
   - Supports 1 to 4 customizable action buttons with clean ASCII labels.
   - Tapping an action button emits a versioned action record:
     ```json
     {"v":1,"type":"input","input":"action","action":"refresh"}
     ```
   - When no actions are specified for the page, an idle Touch Bar placeholder is displayed.

## State protocol

No top status bar is displayed; the touchpad and system controls are directly usable as soon as the serial link enumerates, and the Touch Bar displays idle state until action records are received. Write exactly one authoritative v1 JSON record per newline:

```json
{"v":1,"type":"state","page":1,"pages":4,"name":"Home","canPrev":false,"canNext":true,"link":"wired","actions":[{"id":"refresh","label":"SYNC"}]}
```

The Remote sends each user interaction to the host as one JSON Lines record:

```json
{"v":1,"type":"input","input":"left"}
```

`input` is one of `left`, `right`, `up`, `down`, `primary`, `secondary`, `back`, `mic`, or `action` (with `action: "<id>"`).

## Hardware map

| Peripheral | Pins |
| --- | --- |
| ST7789 SPI display | MOSI GPIO45, SCLK GPIO40, CS GPIO42, DC GPIO41, RST GPIO39 |
| Display backlight | GPIO5, LEDC 20 kHz |
| CST328 touch | I2C1 SDA GPIO1, SCL GPIO3, RST GPIO2, address `0x1A` |
| Panel power latch | key GPIO6, control GPIO7 |
| Serial Link | ESP32-S3 USB-Serial/JTAG |

## Build and flash

This project requires ESP-IDF **6.0.1** and its ESP32-S3 tools.

```sh
cd peripherals/esp32-s3-remote
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

## BDD scenarios

The behavior contract is in
[`tests/features/remote-control.feature`](tests/features/remote-control.feature).
