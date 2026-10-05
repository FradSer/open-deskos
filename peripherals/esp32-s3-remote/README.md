# Open DeskOS S3 Remote Control

Input peripheral for the active Shell; absence must not block direct touch or keyboard.
It is distinct from the preserved prior P4+C6 DeskOS device OS.

Standalone ESP-IDF firmware for the **Waveshare ESP32-S3 Touch LCD 2.8**.
It uses the board's USB-Serial/JTAG port as an exclusive bidirectional protocol interface.
Firmware console output is disabled so logs cannot corrupt newline-delimited authoritative v1 state JSON or versioned Remote Touchpad input records.

## Controls

- Directional ring taps and cardinal swipes (minimum 40px) emit up/down/left/right regardless of cached page/mode.
- Center tap emits `primary`; hold ≥600ms emits `secondary`. Back emits `back`.
- MIC emits `mic` only, never audio. Personal Bot captures from its configured microphone: first toggle starts, second submits, and VAD ends after speech plus 1.2s silence. There is no recording-duration deadline. The accepted P4 device setting is `plughw:CARD=Microphone,DEV=0`; failures remain visible. See [Personal Bot](../../integrations/personal-bot/README.md).
- The contextual Touch Bar renders 1–4 ASCII action labels from authoritative state; absent actions show an idle placeholder. Press emits `{"v":1,"type":"input","input":"action","action":"refresh"}`.

## State protocol

There is no top status bar.
Touchpad and system controls become usable when the serial link enumerates.
The Touch Bar stays idle until action records arrive.
Write exactly one authoritative v1 JSON record per newline:

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
| CST328 touch | I2C1 SDA GPIO1, SCL GPIO3, RST GPIO2, INT GPIO4, address `0x1A` |
| Panel power latch | key GPIO6, control GPIO7 |
| Serial Link | ESP32-S3 USB-Serial/JTAG |

## Build and flash

Flashing requires operational authorization; a build does not prove board input/USB acceptance.

This project requires ESP-IDF **6.0.1** and its ESP32-S3 tools.

```sh
cd peripherals/esp32-s3-remote
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

## BDD scenarios

The behavior contract is in [`tests/features/remote-control.feature`](tests/features/remote-control.feature).

## Development

`main/remote_control.c` owns display, touch polling, and serial I/O.
`main/touchpad_gesture.c` and `main/cst328_frame.c` own gesture handling and touch-frame decoding.
Configuration lives in `main/idf_component.yml`; scenarios live in `tests/features/remote-control.feature`.
Use 4-space ESP-IDF C, `snake_case`, explicit error handling, and bounded buffers.
Keep labels ASCII-only.
Keep touchpad/system controls usable before synchronization.
Never suppress directional input using cached page boundaries.
Do not edit `build/`, `managed_components/`, `sdkconfig`, or generated dependency locks manually.

Run isolated gesture/touch-frame tests from this directory:

```sh
cmake -S tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```

For wire-contract changes, also run `node --test ../../integrations/remote-bridge/test/*.test.js`.
Host tests do not prove target compilation or physical touch/USB acceptance.
