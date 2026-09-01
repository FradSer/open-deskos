# Repository Guidelines

## Project Structure & Module Organization
This is the ESP32-P4 SC2336 Camera Peripheral for the active CM5 architecture; it is distinct from preserved P4+C6 DeskOS research. `main/p4_camera_main.c` owns boot, USB CDC, and capture startup. Sensor logic lives in `main/p4_sc2336.{c,h}` and versioned metadata encoding/parsing in `main/p4_camera_protocol.{c,h}`. Behavior scenarios are defined in `tests/features/p4-camera.feature`.

## Build, Test & Development Commands
Use ESP-IDF 6.0.1 from this directory:
```sh
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

## Coding Style & Naming Conventions
- 4-space ESP-IDF C, `snake_case`, focused modules, and explicit `esp_err_t` return handling.
- Preserve SCCB GPIO 7/8, sensor reset GPIO 26, MIPI CSI capture boundary, and newline-delimited v1 metadata format.
- Keep experimental owner recognition strictly decoupled from base CM5 system startup.
- Do not manually edit `build/`, `managed_components/`, `sdkconfig`, `sdkconfig.old`, or dependency output.

## Testing Guidelines
- Update local Given/When/Then scenarios in `tests/features/p4-camera.feature` before modifying behavior.
- Validate protocol and schema changes against unit and contract tests.

## Commit & Pull Request Guidelines
- Keep camera firmware, protocol, and docs reviewable together under focused Conventional Commits (`feat(hw):`, `fix(hw):`).
- Report the ESP-IDF target, commands run, and note unverified hardware.
- Never include biometric data, raw camera captures, credentials, or diagnostics.
