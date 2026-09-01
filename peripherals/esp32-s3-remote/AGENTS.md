# Repository Guidelines

## Project Structure & Module Organization
This is the required ESP32-S3 Remote Control Peripheral for the active CM5 runtime, not part of preserved P4+C6 research. Keep firmware in `main/remote_control.c`, component configuration in `main/idf_component.yml`, and behavior scenarios in `tests/features/remote-control.feature`.

## Build, Test & Development Commands
From this directory, use ESP-IDF 6.0.1:
```sh
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

## Coding Style & Naming Conventions
- 4-space ESP-IDF C, `snake_case`, explicit error handling, and bounded buffers.
- Composite USB contract: HID emits only `ArrowLeft`/`ArrowRight`; CDC accepts newline-delimited authoritative v1 state records.
- Preserve USB product descriptor `Open DeskOS Remote`, used for `/dev/serial/by-id/` discovery.
- Keep the display English-only and blank of claimed state until an authoritative CDC record is received.
- Do not manually edit `build/`, `managed_components/`, `sdkconfig`, or generated dependency locks.

## Testing Guidelines
- Update Given/When/Then scenarios in `tests/features/remote-control.feature` before modifying firmware behavior.
- Protocol contracts are validated by the integration test suite.

## Commit & Pull Request Guidelines
- Use focused Conventional Commits (`feat(hw):`, `fix(hw):`, `refactor(hw):`).
- State the tested board, USB path, and exact commands; explicitly identify hardware not exercised.
- Never commit serial captures, credentials, generated binaries, or temporary diagnostics.
