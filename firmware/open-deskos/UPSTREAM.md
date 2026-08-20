# UPSTREAM — esp-claw vendored fork provenance

`firmware/open-deskos/` is a vendored fork of Espressif's `esp-claw`, used as the
Open DeskOS firmware base (Open DeskOS-OS §11.3 ruling: fork wins, replacing the
2026-06-13 plan's task-013 from-scratch skeleton).

## Upstream

| Field | Value |
|---|---|
| Repository | https://github.com/espressif/esp-claw |
| Branch | `master` |
| Vendored commit SHA | `dfb01ea6777682ef67b41d510d3663ec1631eed7` |
| Clone date | 2026-07-10 |
| License | Apache-2.0 (upstream `LICENSE` retained verbatim at the fork root) |
| ESP-IDF line | release-v5.5; built here with the `activate_idf_v5.5.1.sh` toolchain |

The vendored tree carries no `.git` directory: it was shallow-cloned, verified
at the SHA above with `git rev-parse HEAD`, then copied in with `.git` excluded.

## Locked dependency versions

| Dependency | Constraint (source) | Notes |
|---|---|---|
| `georgik/lua` | `^5.5.0~7` | Declared in `components/claw_capabilities/cap_lua/idf_component.yml`. Lua 5.5 line. The exact resolved version pinned by the build lands in `application/edge_agent/dependencies.lock`; the host test harness (task 002) vendors its Lua from the resolved `managed_components/georgik__lua/` to stay byte-aligned with the on-target VM. |

The exact resolved `georgik/lua` version from this build:

    georgik/lua 5.5.0~7
    component_hash: 10698fd2d729b63cca8b882e219c3fa3bd8a9adea26f814f2febb624d0385c23

Read from `application/edge_agent/dependencies.lock` and
`managed_components/georgik__lua/idf_component.yml` after the first successful
`idf.py build` (ESP-IDF 5.5.1). The host test harness (task 002) vendors its Lua
from that same `managed_components/georgik__lua/` tree — see
`tests/host/vendor/lua/PROVENANCE.md`.

## Local changes (Open DeskOS deltas over upstream)

Every change Open DeskOS makes to the fork is appended here.

- 2026-07-10 — Added headless board entry
  `application/edge_agent/boards/open-deskos/open_deskos_p4_headless/`
  (`board_info.yaml`, `board_peripherals.yaml`, `board_devices.yaml`,
  `sdkconfig.defaults.board`, `setup_device.c`). Targets `esp32p4`. Declares no
  `display_lcd` / `lcd_touch` and provides no DSI panel factory entry, so the
  build carries no Open DeskOS DSI panel init path (HG-1 avoidance). Mirrors
  `espressif/esp32_p4_function_ev`'s non-display peripherals (I2C, I2S audio,
  PA control GPIO) and its P4+C6 esp-hosted/esp_wifi_remote transport, all
  adapted to real LUMINA-P4 module pins from `firmware/main/lumina_p4_pins.h`:
  I2C0 (sda=8/scl=9, audio ICs), I2C1 (sda=6/scl=7, power/control), I2S0
  playback (mclk=20/bclk=21/ws=22/dout=23), I2S2 capture
  (mclk=29/bclk=30/ws=31/din=32), TAS5825M PA control (gpio=47), and the
  ESP32-C6 ESP-Hosted SDIO transport on the real wiring
  (clk=14/cmd=15/d0=16/d1=17/d2=18/d3=19, slot 1, 4-bit bus) in place of the
  EV board's on-board-C6 default pinout. The one declared device is a
  `gpio_button` "buttons" entry on the real voice-key pin (`LP4_VOICE_KEY=1`);
  audio codec devices (CS43131/TAS5825M/AK5572) are deliberately not declared
  since no upstream board-manager driver exists for those chips — see
  `TRIM.md` and the comment block in `board_devices.yaml`.
- 2026-07-10 — Added `UPSTREAM.md` (this file) and `TRIM.md`.
- 2026-07-10 — Appended Open DeskOS-OS fork ignore lines to the repo-root
  `.gitignore` (`firmware/open-deskos/**/build/`, `managed_components/`,
  `dependencies.lock`).
- 2026-07-11 — task-009 composition root (app-platform wiring). Additive
  Open DeskOS files: `application/edge_agent/main/odk_composition.{c,h}`
  (composition root, wiring only); `application/edge_agent/partitions_odk_16MB.csv`
  and `partitions_odk_8MB.csv` (FR-16: base tables with the headless-dead
  `emote` SPIFFS trimmed to fund a dedicated 2M `packages` FAT partition);
  the on-target port glue under `components/odk_installer/src/port_idf/`
  (storage→VFS, checksum→mbedtls, consent→serial), `components/odk_svc_llm/src/port_idf/`
  (kv→NVS, clock→RTC, llm http→esp_http_client+esp_crt_bundle), and
  `components/odk_app_runtime/src/port_idf/` (App source→VFS) plus
  `components/odk_app_manager/`, with `*_ports_idf.h` where needed. The
  odk_* component CMakeLists gained those SRCS plus REQUIRES (fatfs/esp_timer,
  nvs_flash/esp_timer/mbedtls respectively). These
  port files live under `src/port_idf/`, outside the host test glob
  (`odk_*/src/*.c`, non-recursive), so the host suite never compiles them.
- 2026-07-11 — **Upstream files modified** (first non-additive deltas):
  - `application/edge_agent/main/main.c`: added `#include "odk_composition.h"`
    and a `odk_composition_init()` call after `register_wifi_command()`
    (logged, not `ESP_ERROR_CHECK`'d, so a composition hiccup never panics boot).
  - `application/edge_agent/main/idf_component.yml`: added `path:` dependency
    entries for the Open DeskOS platform components (they carry no
    idf_component.yml of their own, so the component manager needs them listed),
    for `display_arbiter` (required by the LVGL display path), and for
    `georgik/lua` (odk_sandbox's
    Lua VM; cap_lua, which normally pulls it, is not in the headless build).
  - `application/edge_agent/boards/open-deskos/open_deskos_p4_headless/sdkconfig.defaults.board`:
    added `CONFIG_PARTITION_TABLE_CUSTOM` + `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions_odk_16MB.csv"`.
  - `application/edge_agent/tools/cmake/flash_partition_defaults.cmake`: the fork
    auto-selects `partitions_<flashsize>.csv` and strips/overrides any
    board-declared `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME`, which defeated the
    board setting above. Changed it to honor a board-declared partition table
    (read from `board_manager.defaults`) over the flash-size default, so the
    headless board gets `partitions_odk_16MB.csv` without forcing that
    layout on other 16MB boards (which have displays needing the full `emote`
    SPIFFS). Falls back to `partitions_<flashsize>.csv` when a board declares none.
  - Three odk_* component `CMakeLists.txt` gained `odk_domain` in REQUIRES
    (`odk_svc_llm`, `odk_sandbox`, `odk_app_manager`): each includes `odk_err.h`
    from odk_domain. The host build's single-library glob hides cross-component
    include deps; ESP-IDF requires each to be declared. Also gave odk_sandbox an
    `idf_component.yml` (georgik/lua), invisible to the host build.

NFR-10 respected: the app-platform path references no `esp_https_ota`/`app_update`.
The LLM transport (`llm_http_idf.c`) is an ordinary `esp_http_client` HTTPS call,
not an OTA partition write; installer delivery stays file-copy-and-verify.

- 2026-07-11 — `application/edge_agent/main/main.c`: changed the unconditional
  `ESP_ERROR_CHECK(wifi_manager_init())` in `app_main` to a soft-fail (log +
  continue). The fork's default boot-loops when the C6 esp-hosted slave is not
  up (HG-2), which blocks the headless app-platform services from starting.
  Degrading here lets the packages partition + `cerb` console + platform
  services come up without Wi-Fi; Wi-Fi can be brought up later via the
  settings UI or a retry once the C6 link is up. Matches the Open DeskOS-OS
  degradation spirit (no Wi-Fi -> log, don't block).

- 2026-07-11 — Added Guition JC4880P443C_I_W/Y board entry
  `application/edge_agent/boards/guition/jc4880p443c/` (board_info /
  board_peripherals / board_devices / sdkconfig.defaults.board /
  setup_device.c). Targets esp32p4, 16MB flash, 32MB PSRAM, on-board C6
  Wi-Fi co-processor over esp-hosted SDIO. Runs headless: no display_lcd /
  lcd_touch declared (ST7701S RGB panel driver + 3-wire-SPI panel-IO not
  vendored; Guition RGB/control pin map pending — panel bring-up is a
  follow-up). sdkconfig adds the key C6 fix missing from
  open_deskos_p4_headless: CONFIG_SLAVE_IDF_TARGET_ESP32C6=y (without it
  esp-hosted never identifies the slave and wifi_manager_init boot-loops),
  plus CONFIG_ESP_HOSTED_SDIO_GPIO_RESET_SLAVE=100, and the Open DeskOS
  packages partition table.

- 2026-07-11 — `components/common/wifi_manager/wifi_manager.c`: softened
  `ESP_ERROR_CHECK(esp_wifi_init(&cfg))` in `wifi_manager_init()` to return
  the error instead of aborting. esp_wifi_init drives the esp-hosted
  transport and returns ESP_FAIL when the C6 slave is not up (HG-2); the
  upstream abort caused a SW_CPU_RESET boot-loop before the headless app
  platform could start. Now app_main's existing soft-fail catches it and
  continues to odk_composition_init. Downstream event-handler/timer
  registration is skipped on the failure path.

- 2026-07-11 — Upgraded guition/jc4880p443c board entry from headless to full
  display (ST7701S MIPI-DSI 480x800) + GT911 touch + C6 Wi-Fi. Research
  (ultracode workflow: 3 parallel agents synthesized into a board spec)
  cross-confirmed against bigbag/JC4880P443C-examples + ultramcu/guition
  + the commanderk33n helloworld BSP:
  - Display: ST7701S over MIPI-DSI (2 lanes, 750 Mbps), DPI timing from
    ST7701_480_360_PANEL_60HZ_DPI_CONFIG (480x800@60Hz, 34MHz DPI clock,
    RGB565, DMA2D). DSI PHY LDO_VO3 @ 2500mV. Backlight GPIO23 LEDC.
    LCD RST = NC (driver-default init, no custom cmd block). Uses
    espressif/esp_lcd_st7701 ^1.1.3 (registry component, not vendored).
  - Touch: GT911 over I2C (SDA=7/SCL=8, RST=22, INT=21, 400kHz, 0x5D/0xBA).
  - C6 Wi-Fi: SDIO (CLK18/CMD19/D0-14..D3-17, reset=GPIO54 active-HIGH).
    KEY CORRECTION: the right path is CONFIG_ESP_WIFI_REMOTE_LIBRARY_HOSTED=y
    + CONFIG_ESP_HOSTED_P4_DEV_BOARD_FUNC_BOARD=y (bundles EV-board SDIO pin
    preset Guition copied), NOT the manual CONFIG_ESP_HOSTED_PRIV_SDIO_PIN_*
    overrides the prior headless entry used (which never selected the slave
    backend -> bootloop). C6 CHIP_PU is External (always powered) — no
    power-enable GPIO; only RESET=54 driven by esp_hosted. If WiFi still
    fails, suspect stale C6 slave firmware (host~2.12 / slave 2.3.0
    mismatch per ultramcu) -> UART reflash of C6 slave needed.
  Gaps needing the Guition schematic (Baidu pan login-gated): confirm LCD
  RST truly NC, C6 RESET polarity, backlight GPIO, DSI lane physical wiring,
  GT911 RST/INT pins, ST7701S vendor init cmds.

- 2026-07-11 — Reworked guition/jc4880p443c to mirror pulse-esp's VERIFIED
  display config (~/Developer/FradSer/pulse-esp/src/display_driver_p4.cpp,
  confirmed lit on this exact board 2026-07-02), superseding the earlier
  ultracode-synthesized spec on every value where they differed:
  - DSI lane bitrate 750->500 Mbps; LCD RST NC->GPIO5; esp_lcd_st7701
    ^1.1.3->^2.0.2; esp_lcd_touch_gt911 *->^1.2.0.
  - ST7701 init: driver-default -> the full ESPHome guition.py 43-cmd array
    (incl MADCTL/COLMOD/SLPOUT/DISPON); driver defaults leave this panel black.
  - Touch: I2C port0/400kHz->port1/100kHz; RST/INT 22/21->NC (poll, 0x5D/0x14
    probe); flags.disable_control_phase=1 mandatory.
  - C6/esp-hosted: ENABLED->DISABLED. pulse-esp drives the panel on the P4
    alone with zero C6 involvement, so esp_hosted is off to avoid the
    esp_hosted_reconfigure bootloop (C6 slave not responding). The fork's
    wifi_manager_init + app_claw_start are soft-failed in main.c so the
    headless app platform (cerb console + packages) comes up without Wi-Fi.
    C6/Wi-Fi bring-up is a separate follow-up (needs C6 slave firmware check
    per ultramcu host/slave version-mismatch note).

- 2026-07-11 — Patched managed component espressif__esp_hosted
  `host/port/esp/freertos/src/port_esp_hosted_host_init.c`: the upstream
  `__attribute__((constructor)) esp_hosted_host_init()` calls
  `ESP_ERROR_CHECK(esp_hosted_init())` BEFORE app_main, which blocks in
  `transport_drv_reconfigure()` waiting for a C6 slave not up (HG-2). Made
  the constructor a no-op (log + return) on the headless no-C6 bring-up so
  the panel + cerb platform boot without esp-hosted transport. NOTE: this
  edits a managed_components source file — it persists across `idf.py build`
  but a `rm dependencies.lock`/reconfigure that re-fetches the component
  will clobber it; re-apply if re-fetched.

- 2026-07-12 — Direct display bring-up (bypass board_manager). Added
  main/odk_display_bringup.c: drives the ST7701S panel directly in app_main's
  first line (LDO ch3 @2.5V -> DSI bus 2-lane 500Mbps -> DBI IO -> DPI panel
  34MHz RGB565 -> esp_lcd_new_panel_st7701 + the ESPHome guition.py 43-cmd
  init array -> reset -> init -> LEDC backlight GPIO23 5kHz -> solid green
  fill). Mirrors the verified pulse-esp hw_test_main.c verbatim. board_devices.yaml
  no longer declares display_lcd/lcd_touch (board_manager does not touch the
  panel — avoids double-init + startup entanglement). main/idf_component.yml
  gained espressif/esp_lcd_st7701 ^2.0.2 (via idf.py add-dependency). Verified
  on hardware: full init sequence executes (DISP-ROM markers all reached incl
  init done + backlight on), no panic, single boot. ESP_LOGI in app_main stays
  silent post-bringup (IDF log system quirk under DSI init); esp_rom_printf
  works. The cerb platform/console still needs the post-bringup app_main stall
  triaged (separate).
