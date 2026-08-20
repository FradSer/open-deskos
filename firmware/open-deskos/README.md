# Open DeskOS firmware

This directory contains the production Open DeskOS firmware for the **Guition
JC4880P443C** board:

- ESP32-P4 application processor
- ESP32-C6 Wi-Fi and ESP-NOW co-processor
- ST7701S MIPI-DSI display, 480×800 portrait
- GT911 capacitive touch

The production firmware application is [`application/open_deskos/`](application/open_deskos/).
The only board-manager definition is
[`application/open_deskos/boards/guition/jc4880p443c/`](application/open_deskos/boards/guition/jc4880p443c/).
Other boards and standalone upstream sample applications are not part of this
firmware tree.

## Build and flash

Use ESP-IDF 6.0.1 or newer. The P4 MIPI-DSI display path is not supported by
older IDF versions used by the upstream project.

```bash
cd firmware/open-deskos/application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1
```

The board-manager step generates the board-specific component under
`components/gen_bmgr_codes/`. Run it again after removing the build directory
or changing the board definition.

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
run does not validate the production P4 MIPI-DSI adapter path; verify the
firmware with `idf.py build` before flashing hardware.
