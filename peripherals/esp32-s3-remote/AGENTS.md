# Repository Guidelines
## Project Structure & Module Organization
This is the required ESP32-S3 Remote Control Peripheral for the active CM5 runtime, not part of preserved P4+C6 research. Keep firmware in `main/remote_control.c`, dependencies in `main/idf_component.yml`, and behavior in `tests/features/remote-control.feature`.
## Build, Test & Development Commands
From this directory, use ESP-IDF 6.0.1:
```sh
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```
Run `pnpm test` from `runtime/linux/` for cross-scope contracts. The Remote Bridge suite validates the host protocol but cannot replace USB-OTG hardware testing.
## Coding Style & Testing Guidelines
Use 4-space ESP-IDF C, `snake_case`, explicit errors, and bounded buffers. Preserve the composite USB contract: HID emits only `ArrowLeft`/`ArrowRight`; CDC accepts one newline-delimited authoritative v1 state record. Preserve USB product name `Open DeskOS Remote`, which the bridge discovers under `/dev/serial/by-id/`. Keep the display English-only and blank of claimed state until a valid CDC record arrives. Update the local Gherkin feature before behavior changes. Do not manually edit `build/`, `managed_components/`, `sdkconfig`, or generated dependency output.
## Commit & Pull Request Guidelines
Use focused Conventional Commits. State the tested board, USB path, and exact commands; explicitly identify hardware not exercised. Never commit serial captures, credentials, generated output, or temporary diagnostics.
