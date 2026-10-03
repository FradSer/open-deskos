# Open DeskOS

Open DeskOS is a cross-platform desk companion with one Electron Display Shell for Linux, 64-bit Windows, and macOS. The CM5/RK3588S Linux panel is the reference host. Direct input remains usable while hardware peripherals complete their own acceptance gates; host capabilities and device acceptance are verified separately.

## Active architecture

```text
runtime/shell/                         Shared Electron Shell: Linux, Windows, and macOS
peripherals/esp32-s3-remote/           ESP32-S3 touch Remote Control
peripherals/esp32-p4-camera/           ESP32-P4 SC2336 Camera Peripheral
integrations/remote-bridge/            CM5 ↔ Remote transport service
```

The ESP32-S3 Remote Control and ESP32-P4 Camera Peripheral are intended parts of the CM5 system architecture. A base CM5 installation and direct shell use do not wait for either board. The P4 Camera is a generic UVC webcam and UAC microphone with no face recognition or identity storage.

## Develop the Shell

```sh
cd runtime/shell
pnpm install
pnpm styles
pnpm test
pnpm run e2e
bash tests/smoke.sh
./run.sh
```

For CM5 installation and acceptance, see [runtime/shell/README.md](runtime/shell/README.md). For a 64-bit Windows host, see [runtime/shell/docs/WINDOWS_HOST.md](runtime/shell/docs/WINDOWS_HOST.md): `pnpm install`, `pwsh -File run.ps1`, then `node tests/smoke.mjs`.

## Build required peripherals

```sh
# ESP32-S3 touch Remote Control
cd peripherals/esp32-s3-remote
 eim run 'idf.py set-target esp32s3' v6.0.1
 eim run 'idf.py build' v6.0.1

# ESP32-P4 SC2336 Camera Peripheral
cd ../esp32-p4-camera
 eim run 'idf.py set-target esp32p4' v6.0.1
 eim run 'idf.py build' v6.0.1
```

The Remote protocol is documented in [peripherals/esp32-s3-remote/README.md](peripherals/esp32-s3-remote/README.md). The P4 Camera protocol and physical enrollment experiment are documented in [peripherals/esp32-p4-camera/README.md](peripherals/esp32-p4-camera/README.md).

## Preserved P4+C6 research

[research/esp32-p4-c6-deskos/](research/esp32-p4-c6-deskos/) contains the earlier, parallel P4+C6 DeskOS device OS: its ESP-IDF firmware, LVGL/Lua/AIODI shell, native simulator, board tests, specifications, and Apple USB companion. It is preserved so the experiments remain reproducible. It is not an active runtime and does not define the CM5 product’s requirements or release gates.

## Product authority

- [Current product definition](PRODUCT.md)
- [Shell architecture context](runtime/shell/CONTEXT.md)
- [Architecture decision record](runtime/shell/docs/adr/0002-cm5-runtime-and-preserved-p4-research.md)
- [Preserved P4+C6 research documentation](research/esp32-p4-c6-deskos/docs/)
