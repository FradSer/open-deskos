# Repository Guidelines

## Project Structure & Module Organization
This is the required ESP32-S3 Remote Control Peripheral for the active CM5 runtime, not part of preserved P4+C6 research. `main/remote_control.c` owns display, touch polling, and serial I/O; gesture handling and CST328 frame decoding live in `main/touchpad_gesture.c` and `main/cst328_frame.c`. Component configuration is in `main/idf_component.yml`; behavior scenarios are in `tests/features/remote-control.feature`.

## Build, Test & Development Commands
From this directory, use ESP-IDF 6.0.1:
```sh
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
```
For authorized flashing and the board pin map, use @README.md. Console logs are intentionally disabled on the protocol port, so a silent monitor is not evidence of failed boot.

## Coding Style & Naming Conventions
- 4-space ESP-IDF C, `snake_case`, explicit error handling, and bounded buffers.
- USB-Serial/JTAG is exclusively a v1 JSON Lines protocol channel, not a HID keyboard or console. The fixed Espressif serial identity is recognized by the Remote Bridge.
- Emit directional, primary/secondary, Back, MIC, and contextual action input records. MIC sends an input event, not audio.
- Keep labels ASCII-only. Touchpad and system controls remain usable before state synchronization; contextual actions come only from valid authoritative state. Cached page boundaries must not suppress directional input.
- Do not manually edit `build/`, `managed_components/`, `sdkconfig`, or generated dependency locks.

## Testing Guidelines
From this directory, gesture and touch-frame tests run without ESP-IDF or hardware:
```sh
cmake -S tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```
For wire-contract changes, also run `node --test ../../integrations/remote-bridge/test/*.test.js`. These host tests do not replace an ESP32-S3 target build or board touch/USB acceptance.
