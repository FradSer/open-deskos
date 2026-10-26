# Open DeskOS S3 Remote Control

Input peripheral for the active Shell; absence must not block direct touch or keyboard.
It is distinct from the preserved prior P4+C6 DeskOS device OS.

Standalone ESP-IDF firmware for the **Waveshare ESP32-S3 Touch LCD 2.8**.
Control uses one encrypted ESP-NOW peer through the NanoC6 gateway.
USB supplies power and supports separately authorized firmware maintenance.
USB cannot carry Remote state or input records.
Firmware console output is disabled.
The [gateway contract](../../runtime/shell/docs/C6-GATEWAY.md) defines the shared Bridge owner.

## Native component plugins

The boot entry uses the [native plugin host](../common/README.md).
Local [manifests](main/plugins) bind display, touch, buffers, gesture, serial, and surface lifecycle implementations.
CMake generates their immutable descriptors before compilation.
The default dependency order preserves the previous initialization sequence.
A failed boot stops initialized resources before it reports the original error.

[remote_plugin_ports.h](main/remote_plugin_ports.h) owns the component port types.
A buffer provider supplies a DMA-capable framebuffer for 240 by 320 pixels and a queue of `remote_state_t` records.
Serial and surface consumers use these published resources.
The display port accepts the selected framebuffer and state.
Its `drain()` operation waits for pending transfers before buffer cleanup.
The default SPI implementation uses the ESP-IDF parameter-transfer barrier without sending a command.
Cleanup failure retains native handles for retry.
Lifecycle operations and radio polling use the surface owner task.
Wi-Fi callbacks use bounded queues.
The existing `odk:s3/serial/v1` port identity remains compatible with native component replacements.
A build-time native replacement must implement the declared port contract.
These declarations do not load third-party firmware at runtime.

## Controls

- In a ready radio session, directional ring taps and cardinal swipes (minimum 40px) emit up/down/left/right regardless of cached page/mode.
- Center tap emits `primary`; hold ≥600ms emits `secondary`. Back emits `back`.
- MIC emits `mic` only, never audio. Personal Agent captures from its configured microphone: first toggle starts, second submits, and VAD ends after speech plus 1.2s silence. There is no recording-duration deadline. The accepted P4 device setting is `plughw:CARD=Microphone,DEV=0`; failures remain visible. See [Personal Agent](../../integrations/personal-agent/README.md).
- The contextual Touch Bar renders 1–4 ASCII action labels from authoritative state; absent actions show an idle placeholder. Press emits `{"v":1,"type":"input","input":"action","action":"refresh"}`.

## State protocol

There is no top status bar.
Touchpad and system controls send input after the paired radio session receives authoritative state.
The Touch Bar stays idle until action records arrive.
The Bridge sends this authoritative v1 state inside bounded radio frames:

```json
{"v":1,"type":"state","page":1,"pages":4,"name":"Home","canPrev":false,"canNext":true,"link":"wireless","actions":[{"id":"refresh","label":"SYNC"}]}
```

The Remote carries each physical input as bounded JSON inside a radio frame:

```json
{"v":1,"type":"input","input":"left"}
```

`input` is one of `left`, `right`, `up`, `down`, `primary`, `secondary`, `back`, `mic`, or `action` (with `action: "<id>"`).

## Hardware map

| Peripheral | Pins |
| --- | --- |
| ST7789 SPI display | MOSI GPIO45, SCLK GPIO40, CS GPIO42, DC GPIO41, RST GPIO39 |
| Display backlight | GPIO5, LEDC 20 kHz |
| CST328 touch | I2C1 SDA GPIO1, SCL GPIO3, RST GPIO2, INT GPIO4, address `0x1A` |
| Panel power latch | key GPIO6, control GPIO7 |
| Control link | Encrypted ESP-NOW through one NanoC6 peer |

## Build and flash

Flashing requires operational authorization.
A build does not prove physical input or two-device radio acceptance.

This project requires ESP-IDF **6.0.1** and its ESP32-S3 tools.

```sh
cd peripherals/esp32-s3-remote
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1
# After identity verification, full-flash backup, and operational authorization:
eim run 'idf.py -p PORT flash' v6.0.1
```

## Private pairing

The default NVS partition stores the `odk_radio` namespace.
Its fields are `gateway` (six bytes), `pmk` (16 bytes), `lmk` (16 bytes), and `channel` (integer 1–11).
The gateway uses the same channel and keys.
Missing pairing data leaves the surface idle.
Initialization never erases existing NVS after an error.

The following procedure requires separate pairing authorization.
Do not run it as a source validation step.
Use the ESP-IDF 6.0.1 Python environment for an authorized operation:

```sh
python tools/pairing-image.py --gateway-config /private/gateway.json \
  --gateway-mac 'gateway-station-mac' --output /private/s3-pairing.bin \
  --idf-path /absolute/esp-idf
```

The image contains private keys without flash encryption.
Keep its directory private and outside source control.
The generator refuses an existing output file.
Check the generated partition table before you write this image.
The current default NVS partition starts at `0x9000` and occupies `0x6000` bytes.
Back up the complete selected S3 flash before firmware or NVS writes.
Do not write security settings or eFuses.

The [Bridge ESP-NOW contract](../../integrations/remote-bridge/README.md#esp-now-only-mode) owns radio framing, session checks, and connection state.
Offline or busy input is consumed without retention or automatic retry.
A heartbeat deadline clears cached actions.

## BDD scenarios

The behavior contract is in [`tests/features/remote-control.feature`](tests/features/remote-control.feature).

## Development

`main/remote_control.c` implements the native drivers and Remote surface.
`main/plugins/` owns their declarations.
`../common/` owns the shared native lifecycle.
`main/touchpad_gesture.c` and `main/cst328_frame.c` own gesture handling and touch-frame decoding.
Configuration lives in `main/idf_component.yml`; scenarios live in `tests/features/remote-control.feature`.
Use 4-space ESP-IDF C, `snake_case`, explicit error handling, and bounded buffers.
Keep labels ASCII-only.
Consume gestures before synchronization without sending them later.
Never suppress directional input using cached page boundaries.
Do not edit `build/`, `managed_components/`, `sdkconfig`, or generated dependency locks manually.

Run isolated gesture/touch-frame tests from this directory:

```sh
cmake -S tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```

For wire-contract changes, also run `node --test ../../integrations/remote-bridge/test/*.test.js`.
Host tests do not prove target compilation or physical touch or radio acceptance.

## Radio session and acceptance

ODKR version 1 uses a 24-byte header and frames of at most 250 bytes.
A state contains at most 512 bytes and uses chunks of at most 226 bytes.
Only a complete, valid state replaces the display state and receives a state acknowledgement.
Duplicate, conflicting, stale, expired, and embedded-NUL fragments do not commit another state.
The host session expires after 3.5 seconds without a valid host handshake acknowledgement.
The receiver processes at most eight queued frames per poll to preserve touch polling.

Pairing data stays in the existing private `odk_radio` NVS namespace.
The firmware opens that namespace read-only and never erases NVS after an initialization error.
The configured gateway must be unicast and use a channel from 1 through 11.
PMK and LMK values are 16 bytes, and the peer requires encryption.
Do not place pairing data, keys, NVS images, or device captures in source control.
The public `tools/pairing-image.py` source is included and was inspected without executing it.
Its presence does not authorize private input reads, image generation, NVS writes, or pairing.

The wireless packet has no exact author, accepted source revision, build receipt, or active-image binding.
Local tests do not close those provenance gaps.
New pairing, NVS access, flashing, radio operation, and physical acceptance require their existing separate authorization.
