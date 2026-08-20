# Open DeskOS ![](https://img.shields.io/badge/status-active_development-orange)

[![Hardware](https://img.shields.io/badge/hardware-ESP32--P4%20%2B%20ESP32--C6-blue)](docs/open-deskos/OPEN-DESKOS.md) [![Firmware](https://img.shields.io/badge/firmware-ESP--IDF-green)](firmware/open-deskos/)

**English** | [简体中文](README.zh-CN.md)

Open DeskOS is a desktop companion operating system for an ESP32-P4 display device, an ESP32-C6 connectivity coprocessor, and companion clients for Apple platforms.

## What is in the repository

### Firmware

The ESP32-P4 firmware provides the LVGL/Lua desktop shell, widgets, apps, voice UI, USB integration, and the device-side runtime. The ESP32-C6 firmware handles Wi-Fi and ESP-NOW connectivity through the hosted link.

The current product direction and hardware boundaries are documented in [docs/open-deskos/OPEN-DESKOS.md](docs/open-deskos/OPEN-DESKOS.md). **Firmware hardware scope:** production firmware supports only the Guition JC4880P443C (ESP32-P4 + ESP32-C6, 480x800). CM5/S31 and every other board are research or migration references only and are not supported production targets.

### Native SDL simulator

`firmware/open-deskos/sim/native_sdl/` runs the firmware Lua/LVGL UI on a desktop without ESP-IDF or Emscripten. It is useful for launcher, widget, layout, and generated-UI checks. Its IO/PARTIAL rendering path does not validate the P4 MIPI-DSI adapter path.

```bash
cd firmware/open-deskos/sim/native_sdl
cmake -S . -B build
cmake --build build -j
cp ../../components/lua_modules/lua_module_lvgl/lib/{launcher,aiodi}.lua lib/
./build/cerberus_sim
```

### Apple clients

`app/apple/` contains the SwiftUI client and the macOS-only `OpenDeskOSCLI` target. The CLI manages Wispr Flow health checks and bridges OpenCode Go subscription snapshots to the device.

```bash
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
```

### Product and implementation documentation

- [Product specification](docs/open-deskos/OPEN-DESKOS.md)
- [Firmware README](firmware/open-deskos/README.md)
- [Apple client notes](app/README.md)
- [BDD scenarios](firmware/open-deskos/tests/features/)

## Build and flash the firmware

The P4 display path requires ESP-IDF 6.0.1 or newer. Install the toolchain with [`eim`](https://github.com/espressif/idf-im-ui), then run each ESP-IDF command through the selected version:

```bash
# Install ESP-IDF and the ESP32-P4 tools once.
eim install -i v6.0.1 -t esp32p4

cd firmware/open-deskos/application/edge_agent

# Generate the board-manager configuration for the Guition JC4880P443C.
eim run "idf.py bmgr -c ./boards -b guition_jc4880" v6.0.1

# Build the application and its system/storage images.
eim run "idf.py build" v6.0.1

# Replace PORT with the device's USB Serial/JTAG port, then flash and monitor.
eim run "idf.py -p PORT flash monitor" v6.0.1
```

On macOS, the port is commonly `/dev/cu.usbmodem*`; on Linux, it is commonly `/dev/ttyACM0`. If automatic download mode does not start, hold BOOT while resetting the board, then rerun the flash command. Stop the monitor with `Ctrl-C`.

The board ID above matches `firmware/open-deskos/application/edge_agent/boards/guition/jc4880p443c/board_info.yaml`. Do not select another board ID for production firmware. The exact Guition board configuration, partition layout, and flashing workflow are maintained under `firmware/open-deskos/application/edge_agent/boards/guition/jc4880p443c/`.

## Testing

Host tests and BDD-related harnesses live under `firmware/open-deskos/tests/`. The native simulator and the host build cover different paths, so a passing simulator run is not a substitute for an ESP-IDF build.

## Contributing

Keep product decisions in `docs/open-deskos/OPEN-DESKOS.md`. Firmware changes should follow the local instructions in `firmware/open-deskos/AGENTS.md`; add or update a scenario in `firmware/open-deskos/tests/features/` before implementing new behavior.

## License

No root-level license file is currently included in this repository.
