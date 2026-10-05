# Open DeskOS firmware

This directory contains the preserved P4+C6 research firmware and its three
supported board-manager targets:

- **Guition JC4880P443C** — ESP32-P4 application processor, ESP32-C6 Wi-Fi and
  ESP-NOW co-processor, ST7701S MIPI-DSI 480×800 portrait display, GT911 touch.
- **Waveshare ESP32-S3 Touch LCD 2.8** — ESP32-S3, ST7789 SPI 240×320 display,
  CST328 touch.
- **M5Stack PaperColor** — ESP32-S3, ED2208 SPI 400×600 e-paper display, M5PM1 PMIC.

The research firmware application is [`application/open_deskos/`](application/open_deskos/).
Board definitions live under
[`application/open_deskos/boards/`](application/open_deskos/boards/); the
supported IDs are `jc4880p443c`, `esp32_s3_touch_lcd_2_8`, and `m5papercolor`. Standalone
upstream sample applications are not part of this firmware tree.

## Build and flash

Use ESP-IDF 6.0.1 or newer. The P4 MIPI-DSI display path is not supported by
older IDF versions used by the upstream project.

```bash
cd research/esp32-p4-c6-deskos/firmware/application/open_deskos
# Guition JC4880P443C (P4 + C6)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8 (separate build tree)
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1

# M5Stack PaperColor (separate build tree)
eim run "idf.py bmgr -c ./boards -b m5papercolor" v6.0.1
eim run "idf.py -B build-m5paper build" v6.0.1
eim run "idf.py -B build-m5paper -p PORT flash monitor" v6.0.1
```

The board-manager step generates the board-specific component under
`components/gen_bmgr_codes/`. Run it again after removing a build directory or
changing the selected board definition; keep the S3 build in `build-s3`.

The C6 network image is built and embedded separately when required:

```bash
cd research/esp32-p4-c6-deskos/firmware
tools/build_c6_espnow_slave.sh
```

## Native simulator

The SDL2 simulator runs the same Lua/LVGL UI sources on a desktop without
ESP-IDF or Emscripten. It is interactive on macOS and supports scripted,
headless runs for CI. See
[`sim/native_sdl/README.md`](sim/native_sdl/README.md).

```bash
cd research/esp32-p4-c6-deskos/firmware/sim/native_sdl
./run.sh
```

## Verification

Host tests do not require ESP-IDF:

```bash
cd research/esp32-p4-c6-deskos/firmware
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

The native simulator uses an SDL2 IO/PARTIAL render path. A passing simulator
run does not validate the P4 MIPI-DSI adapter or S3 SPI path; verify
the selected firmware target with its ESP-IDF build before flashing hardware.

## Preserved protocol and safety design

This section keeps the unique protocol values from the removed planning documents. It records a design contract. Check the protocol sources and tests before you use it. It does not prove that all paths have device acceptance.

### USB-HID and text

The old composite design used keyboard interface 0 (8-byte boot report), consumer interface 1 (2 bytes), mouse interface 2 (5 bytes), and vendor interface 3 (64-byte input/output reports, usage page 0xFF00, usage 0x01). It used separate interfaces without Report IDs. Boot mode requires an 8-byte keyboard report and a 3-byte mouse report. Implement tud_hid_set_protocol_cb. Update bcdDevice when interfaces change; a different PID can be required for the Windows descriptor cache.

| Vendor frame byte | Meaning |
|---|---|
| 0 | 0x01 TEXT_UTF8, 0x02 STATUS, 0x03 CONFIG, 0x04 ACK |
| 1 | bit0: continued message; bit1: final fragment |
| 2 | Sequence, 0–255 with wrap |
| 3 | Payload length, 0–60 |
| 4–63 | Payload |

Do not split a UTF-8 character across fragments. Reassemble by sequence, inject after the final fragment, and return an ACK with its sequence. The design waits 50ms for each ACK and drops the message after three failed attempts. CONFIG carries device settings and Wi-Fi credentials. Do not log credentials.

HID scan codes depend on the host keyboard layout. Unicode text requires a host client. The old host design used Windows SendInput with KEYEVENTF_UNICODE and surrogate pairs; macOS CGEventKeyboardSetUnicodeString in blocks of at most 20 UTF-16 units; and X11 XTEST or a supported Wayland virtual-keyboard protocol. Clipboard paste was the fallback. macOS device read and text injection require separate Input Monitoring and Accessibility permissions. HID vendor enumeration compatibility requires a real-host test. See the [actual Apple client](../apple/README.md) for its narrower scope.

### ESP-NOW bridge

ESP-NOW runs on the C6. The recorded esp-hosted version did not expose esp_now APIs to the P4. The bridge uses esp_hosted_send_custom_data(msg_id, data, len) and esp_hosted_register_custom_callback(msg_id, cb, ctx). The recorded packet limit was about 8166 bytes; verify it for the selected image. A 921600-baud UART link with length-prefix or COBS framing was the fault-isolation fallback.

The peer payload is ver(1B) + type(1B) + seq(1B) + len(1B) + payload(≤196B). Types are 0x01 telemetry, 0x02 command, 0x03 pairing and 0x04 heartbeat. Telemetry runs every 1–5s. Three missed 10s heartbeats mark a peer offline. Keep packets at most 200 bytes. Use PMK/LMK encryption. Pairing requires user confirmation before the peer enters the table.

Wi-Fi and ESP-NOW share the C6 radio and AP channel. Use channel=0 and WIFI_IF_STA. Resynchronize peers after an AP channel change. The Wi-Fi callback must only enqueue work. Do not block it. The proposed device test was one hour with packet loss below 5%, command round trip below 200ms and offline detection below 30s.

The later telemetry proposal reserves payload byte 0 for device_type: 0x01 charger, 0x02 plant sensor, 0x03 desk note, 0x04–0x7F reserved, 0x80–0xFF private. It then uses metric_id(1B), type(1B: u8/u16/i16/u32/str), len(1B), value. Metrics 0x01 battery, 0x02 temperature and 0x03 power were proposed; 0x80+ is private. Check the protocol registry before assigning IDs. The proposed pairing window is 60s, with at most six peers as a product target. This extension is not evidence that XML peer packages exist.

### Audio, permissions and unverified gates

The old dictation pipeline uses I2S DMA, VAD, Opus at 12–24kbps and streaming WSS ASR. LLM text processing is optional. Fixed local commands do not provide free dictation. The later design injects final segments and only displays partial text. Confirmation mode is optional. The target from final segment to host text is at most 2s.

Show a capture indicator throughout microphone capture. Do not let a package disable it. With no Wi-Fi, do not start the cloud capture path. With no client, allow only the ASCII path. Keep completed segments after an ASR interruption and discard the unfinished segment. Live capture requires an authorized device task.

Generated v2 packages must use the installer: staging, SHA-256 checks, capability consent, atomic install and provenance/index update. Generated content must not gain direct filesystem or hardware access. The old HID-injection proposal requires a foreground App, a user-touch window of 5s and a first-use notice for each session. Check implementation and tests before treating this proposal as an enforced control.

The historical v2 manifest proposal used these fields. This table does not establish support in the current installer.

| Field | Proposed value or role |
| --- | --- |
| `schema_version` | `2` |
| `app_id`, `kind` | Package identity and type |
| `entry` | `app/main.lua` |
| `capabilities`, `dependencies` | Declared access and dependencies |
| `files` | Package file inventory |

The vendor extension proposal named `DATA_PUSH`, `PKG_XFER`, and `NOTIFY`.
It assigned no command IDs. Use the source protocol registry before an implementation; do not infer reserved IDs from these names.


Historical esp-hosted reports included inbound stalls near 100KB and unrecoverable SDIO state errors. Their current fix status was not checked during this edit. The design uses C6 heartbeat/reset and an independent UART peer path. Its fallback triggers were TCP below 50KB/s for 5s, ASR failure rate above 30%, or SDIO latency above 500ms. A local-command fallback does not satisfy free-dictation acceptance.

The old 262×928 AMOLED proposal left panel lane/timing and many GPIO values unresolved. It is not the Guition pin map. Audio capture for 5 minutes at 16kHz/16bit and rotated display at 30fps were proposed gates, not current test results. Power, radio coexistence, Unicode injection and physical touch each require their own device checks. No board-level power or supply-current claim follows from a host test.

See the [Guition reference](../reference/GUITION-JC4880P443.md) for preserved pin, timing, initialization and measurement values. Read actual board metadata for the selected target. Do not copy a proposal pin map to another board.

## Original security targets

The original hardware proposal specified the following controls. Their presence here does not prove implementation or hardware acceptance.

- Sign firmware with ECDSA-P256. Verify signatures before installation.
- Use eFuse anti-rollback and Secure Boot v2 on P4 and C6.
- Store ASR/LLM API keys in an encrypted NVS partition. Exclude them from firmware images.
- Do not broadcast pairing keys in plaintext. The ESP-NOW encryption and pairing limits above still apply.

Verify these controls on the exact firmware, provisioning state, and board before any security claim.


## Image layout and configuration

Edit application/open_deskos/fatfs_image/storage for writable DATA seeds and fatfs_image/system for read-only SYSTEM seeds. The build stages them into build/fatfs_image and build/system_fs_image. A selected board can overlay its fatfs_image directory onto SYSTEM only. Matching relative paths replace base files. Hidden board directories are excluded.

Component skills and builtin Lua scripts/documents are copied into SYSTEM. DATA can be reformatted and seeded again without losing the system copies. Configure Wi-Fi, LLM, IM, search keys and timezone through menuconfig in the selected toolchain. Keep credentials out of examples and logs.

## API owners

- [System, hardware and media API](components/lua_modules/lua_module_system/README.md).
- [UI and display API](components/lua_modules/lua_module_lvgl/README.md).
- [Network and capability API](components/lua_modules/lua_module_ble/README.md).

The build extracts each module/library section into its existing image document name. The generated builtin_lua_modules skill remains the device lookup index.
