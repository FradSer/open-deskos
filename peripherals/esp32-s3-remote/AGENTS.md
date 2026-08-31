# Repository Guidelines

## Project Structure & Module Organization

This is standalone ESP-IDF firmware for the Waveshare ESP32-S3 Touch LCD 2.8. Keep implementation in `main/remote_control.c`; its component dependencies are declared in `main/idf_component.yml`. `tests/features/remote-control.feature` defines the USB remote behavior. It is delivered with the Linux Display Shell, not with the P4 firmware application.

## Build & Development Commands

From this directory, use ESP-IDF 6.0.1:

```sh
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

Run `pnpm test` from `runtime/linux/` for repository-level contracts. The `integrations/remote-bridge` tests validate the host-side protocol; they do not substitute for flashing and testing the USB-OTG device.

## Coding Style & Testing Guidelines

Use ESP-IDF C style: 4-space indentation, `snake_case`, explicit errors, and bounded buffers. Preserve the composite USB contract: HID emits only `ArrowLeft`/`ArrowRight`; CDC receives one newline-delimited authoritative v1 state record. Keep the USB product name `Open DeskOS Remote`, which host discovery matches below `/dev/serial/by-id/`; do not rename it without updating the bridge and its tests. The remote display remains English-only and reports no state before a valid CDC frame.

Start with an update to `tests/features/remote-control.feature` and retain the existing parser, boundary, and redraw guarantees. Do not edit `build/`, `managed_components/`, `sdkconfig`, or `sdkconfig.old` manually.

## Commit & Pull Request Guidelines

Use focused Conventional Commits. Describe the tested board/USB path and commands, and call out hardware not exercised. Do not commit serial data, credentials, generated output, or temporary diagnostics.
