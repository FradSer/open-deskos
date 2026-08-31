# Repository Guidelines

## Project Structure & Module Organization

`main/p4_camera_main.c` owns ESP32-P4 boot, USB CDC setup, and capture startup. Keep SC2336 hardware logic in `main/p4_sc2336.{c,h}` and versioned metadata encoding/parsing in `main/p4_camera_protocol.{c,h}`. `main/idf_component.yml`, `dependencies.lock`, and `sdkconfig.defaults` define the ESP-IDF component set and defaults. Behavior is specified in `tests/features/p4-camera.feature`.

## Build & Development Commands

Use ESP-IDF 6.0.1 from this directory:

```sh
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

For repository contract coverage, run `pnpm test` from `firmware/linux/`; it checks the feature, documentation, and v1 metadata parser. A successful host check does not validate the SC2336 sensor, MIPI link, or USB device on hardware.

## Coding Style & Testing Guidelines

Use ESP-IDF C conventions: 4-space indentation, `snake_case`, explicit `esp_err_t` handling, and focused modules. Preserve the documented SCCB pins (GPIO 7/8), reset pin (GPIO 26), MIPI CSI capture boundary, and newline-delimited v1 metadata protocol. Add or update the local Given/When/Then feature before behavior changes, then update the matching Linux contract test.

Do not manually edit `build/`, `managed_components/`, `sdkconfig`, or `sdkconfig.old`; they are ESP-IDF-generated configuration or dependency output.

## Commit & Pull Request Guidelines

Use the repository’s Conventional Commit style and keep camera firmware, protocol, and documentation changes reviewable together. State the ESP-IDF target and the exact build/test commands run; identify unverified hardware behavior. Never include device credentials, captured biometric data, or temporary diagnostics.
