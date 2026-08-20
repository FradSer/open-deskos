# Open DeskOS ![](https://img.shields.io/badge/status-active_development-orange)

[![Hardware](https://img.shields.io/badge/hardware-ESP32--P4%20%2B%20ESP32--C6%20%7C%20ESP32--S3-blue)](docs/open-deskos/OPEN-DESKOS.md) [![Firmware](https://img.shields.io/badge/firmware-ESP--IDF-green)](firmware/open-deskos/)

**English** | [简体中文](README.zh-CN.md)

Open DeskOS is a desktop companion operating system for an ESP32-P4 display device, an ESP32-C6 connectivity coprocessor, a compact ESP32-S3 variant, and companion clients for Apple platforms.

## What is in the repository

### Firmware

The production firmware lives in `firmware/open-deskos/application/open_deskos/` (ESP-IDF project `open_deskos`). It supports two boards:

- **Guition JC4880P443C** (`guition/jc4880p443c`, ESP32-P4 + ESP32-C6, 480x800 ST7701S MIPI-DSI, GT911 touch) — main desktop device.
- **Waveshare ESP32-S3 Touch LCD 2.8** (`waveshare/esp32_s3_touch_lcd_2_8`, ESP32-S3, 240x320 ST7789 SPI, CST328 touch) — compact variant with adapted layout and target-gated services.

Both boards are the product scope enforced by `firmware-scope.feature`. The only supported application path is `application/open_deskos`; the legacy `edge_agent` path and other vendor board trees are not part of the product build. Current product direction and hardware boundaries are documented in [docs/open-deskos/OPEN-DESKOS.md](docs/open-deskos/OPEN-DESKOS.md).

### Native SDL simulator

`firmware/open-deskos/sim/native_sdl/` runs the Guition JC4880P443C Lua/LVGL UI on a desktop without ESP-IDF or Emscripten. On macOS, `./run.sh` opens an interactive Cocoa window without requiring `DISPLAY` or `WAYLAND_DISPLAY`; on Linux, use an X11 or Wayland session. For headless checks, set `ODK_SIM_SHOT` and optionally `ODK_SIM_TAP`. Its IO/PARTIAL rendering path does not validate the P4 MIPI-DSI adapter path. See [`firmware/open-deskos/sim/native_sdl/README.md`](firmware/open-deskos/sim/native_sdl/README.md) for details.

```bash
cd firmware/open-deskos/sim/native_sdl
./run.sh
# Headless: ODK_SIM_SHOT=/tmp/opendeskos-sim.bmp ODK_SIM_SHOT_FRAMES=30 ./run.sh
```

### Apple clients

`app/apple/` contains the SwiftUI client and the macOS-only `OpenDeskOSCLI` target (`odkctl`). The CLI manages Wispr Flow health checks and bridges OpenCode Go subscription snapshots to the device.

```bash
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
```

### Product and implementation documentation

- [Product specification](docs/open-deskos/OPEN-DESKOS.md)
- [Firmware README](firmware/open-deskos/README.md)
- [Waveshare S3 board notes](firmware/open-deskos/application/open_deskos/boards/waveshare/esp32_s3_touch_lcd_2_8/README.md)
- [Apple client notes](app/README.md)
- [BDD scenarios](firmware/open-deskos/tests/features/)

## Build and flash the firmware

The P4 display path requires ESP-IDF 6.0.1 or newer. The S3 variant also builds with ESP-IDF 6.0.1. Install the toolchain with [`eim`](https://github.com/espressif/idf-im-ui), then run each ESP-IDF command through the selected version.

```bash
# Install ESP-IDF and target tools once.
eim install -i v6.0.1 -t esp32p4
eim install -i v6.0.1 -t esp32s3

cd firmware/open-deskos/application/open_deskos

# Guition JC4880P443C (P4 + C6, 480x800)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8 (S3, 240x320) — separate build dir
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1
```

On macOS, the port is commonly `/dev/cu.usbmodem*`; on Linux, it is commonly `/dev/ttyACM0`. If automatic download mode does not start, hold BOOT while resetting the board, then rerun the flash command. Stop the monitor with `Ctrl-C`.

Board IDs match `firmware/open-deskos/application/open_deskos/boards/guition/jc4880p443c/board_info.yaml` and `firmware/open-deskos/application/open_deskos/boards/waveshare/esp32_s3_touch_lcd_2_8/board_info.yaml`. Do not select another board ID for production firmware.

## Testing

Host tests and BDD-related harnesses live under `firmware/open-deskos/tests/`. Key scenarios include `firmware-scope.feature` (two-board production scope) and `s3-small-board.feature` (240x320 layout and target gating).

```bash
cd firmware/open-deskos
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

The native simulator and the host build cover different paths, so a passing simulator run is not a substitute for an ESP-IDF build.

## Contributing

Keep product decisions in `docs/open-deskos/OPEN-DESKOS.md`. Firmware changes should follow the local instructions in `firmware/open-deskos/AGENTS.md`; add or update a scenario in `firmware/open-deskos/tests/features/` before implementing new behavior.

## License

No root-level license file is currently included in this repository. The firmware subtree includes its own `firmware/open-deskos/LICENSE`.
