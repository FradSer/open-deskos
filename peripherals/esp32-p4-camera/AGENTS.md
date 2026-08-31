# Repository Guidelines
## Project Structure & Module Organization
This is the ESP32-P4 SC2336 Camera Peripheral for the active CM5 architecture; it is distinct from preserved P4+C6 DeskOS research. `main/p4_camera_main.c` owns boot, USB CDC, and capture startup. Keep sensor logic in `main/p4_sc2336.{c,h}` and versioned metadata encoding/parsing in `main/p4_camera_protocol.{c,h}`. `tests/features/p4-camera.feature` owns behavior.
## Build, Test & Development Commands
Use ESP-IDF 6.0.1 from this directory:
```sh
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```
Run `pnpm test` from `runtime/linux/` for feature, documentation, and v1 protocol coverage. It does not validate the SC2336 sensor, MIPI link, or USB hardware.
## Coding Style & Testing Guidelines
Use 4-space ESP-IDF C, `snake_case`, focused modules, and explicit `esp_err_t` handling. Preserve SCCB GPIO 7/8, reset GPIO 26, the MIPI CSI capture boundary, and newline-delimited v1 metadata. Owner recognition is an experiment; it must not create a CM5 base-shell gate. Update the local Given/When/Then feature and matching runtime protocol test before behavior changes. Do not edit `build/`, `managed_components/`, `sdkconfig`, `sdkconfig.old`, or dependency output manually.
## Commit & Pull Request Guidelines
Keep camera firmware, protocol, and docs reviewable together under a focused Conventional Commit. Report the ESP-IDF target, tests run, and unverified hardware. Never include biometric data, camera captures, credentials, or diagnostics.
