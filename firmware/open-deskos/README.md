# Open DeskOS firmware

This directory contains the production Open DeskOS firmware and its two
supported board-manager targets:

- **Guition JC4880P443C** — ESP32-P4 application processor, ESP32-C6 Wi-Fi and
  ESP-NOW co-processor, ST7701S MIPI-DSI 480×800 portrait display, GT911 touch.
- **Waveshare ESP32-S3 Touch LCD 2.8** — ESP32-S3, ST7789 SPI 240×320 display,
  CST328 touch.

The production firmware application is [`application/open_deskos/`](application/open_deskos/).
Board definitions live under
[`application/open_deskos/boards/`](application/open_deskos/boards/); the
supported IDs are `jc4880p443c` and `esp32_s3_touch_lcd_2_8`. Standalone
upstream sample applications are not part of this firmware tree.

## Build and flash

Use ESP-IDF 6.0.1 or newer. The P4 MIPI-DSI display path is not supported by
older IDF versions used by the upstream project.

```bash
cd firmware/open-deskos/application/open_deskos
# Guition JC4880P443C (P4 + C6)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8 (separate build tree)
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1
```

The board-manager step generates the board-specific component under
`components/gen_bmgr_codes/`. Run it again after removing a build directory or
changing the selected board definition; keep the S3 build in `build-s3`.

The C6 network image is built and embedded separately when required:

```bash
cd firmware/open-deskos
tools/build_c6_espnow_slave.sh
```

## Native simulator

The SDL2 simulator runs the same Lua/LVGL UI sources on a desktop without
ESP-IDF or Emscripten. It is interactive on macOS and supports scripted,
headless runs for CI. See
[`sim/native_sdl/README.md`](sim/native_sdl/README.md).

```bash
cd firmware/open-deskos/sim/native_sdl
./run.sh
```

## Verification

Host tests do not require ESP-IDF:

```bash
cd firmware/open-deskos
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

The native simulator uses an SDL2 IO/PARTIAL render path. A passing simulator
run does not validate the production P4 MIPI-DSI adapter or S3 SPI path; verify
the selected firmware target with its ESP-IDF build before flashing hardware.
