# Open DeskOS

Open DeskOS is a CM5/RK3588S Linux desk companion runtime. Its Electron shell runs directly on the desk display and remains usable with touch and keyboard while hardware peripherals complete their own acceptance gates.

## Active architecture

```text
runtime/linux/                         CM5 Electron desk runtime
peripherals/esp32-s3-remote/           ESP32-S3 touch Remote Control
peripherals/esp32-p4-camera/           ESP32-P4 SC2336 Camera Peripheral
integrations/remote-bridge/            CM5 ↔ Remote transport service
experiments/vision/face-agent/         opt-in vision and owner-recognition experiment
```

The ESP32-S3 Remote Control and ESP32-P4 Camera Peripheral are intended parts of the CM5 system architecture. A base CM5 installation and direct shell use do not wait for either board. Face Agent and owner recognition remain opt-in experiments.

## Develop the CM5 runtime

```sh
cd runtime/linux
pnpm install
pnpm styles
pnpm test
pnpm run e2e
bash tests/smoke.sh
./run.sh
```

For CM5 installation and acceptance, see [runtime/linux/README.md](runtime/linux/README.md).

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
- [CM5 runtime architecture context](runtime/linux/CONTEXT.md)
- [Architecture decision record](runtime/linux/docs/adr/0002-cm5-runtime-and-preserved-p4-research.md)
- [Preserved P4+C6 research documentation](research/esp32-p4-c6-deskos/docs/)
