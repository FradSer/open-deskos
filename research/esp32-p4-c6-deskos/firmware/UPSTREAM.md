# UPSTREAM — esp-claw vendored fork provenance

`research/esp32-p4-c6-deskos/firmware/` is a vendored fork of Espressif's `esp-claw`, used as the
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
  build carries no Open DeskOS DSI panel init path. Mirrors
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
  `.gitignore` (`research/esp32-p4-c6-deskos/firmware/**/build/`, `managed_components/`,
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

- 2026-08-20 — Added M5Stack PaperColor (ESP32-S3) e-paper board support.
  Added board definition `application/open_deskos/boards/m5stack/m5papercolor/`
  (`board_info.yaml`, `board_devices.yaml`, `board_peripherals.yaml`,
  `sdkconfig.defaults.board`, `README.md`), ED2208 EPD driver component
  `application/open_deskos/components/esp_lcd_m5paper_epd/` (`CMakeLists.txt`,
  `idf_component.yml`, `include/esp_lcd_m5paper_epd.h`,
  `src/esp_lcd_m5paper_epd.c`), direct bring-up
  `application/open_deskos/main/odk_m5paper_display_bringup.{c,h}`, board
  selection `application/open_deskos/Kconfig.projbuild`, BDD feature
  `tests/features/m5papercolor-board.feature`, and host contract
  `tests/host/m5papercolor_board_contract.cmake`.
  Modified fork files:
  - `application/open_deskos/main/main.c`: added `odk_m5paper_display_bringup`
    branch under `CONFIG_ODK_BOARD_M5PAPERCOLOR`.
  - `application/open_deskos/main/odk_voice_ui.c`: added 6 branch points for
    `CONFIG_ODK_BOARD_M5PAPERCOLOR` (panel, IO, touch, size, PANEL_IF_IO).
  - `application/open_deskos/main/CMakeLists.txt`: added source filtering for
    M5PaperColor and `PRIV_REQUIRES esp_lcd_m5paper_epd`.
  - `tests/features/firmware-scope.feature` and `tests/host/firmware_scope_contract.cmake`:
    updated production board count from two to three.
  - `tests/host/CMakeLists.txt`: registered `m5papercolor_board_contract`.



<a id="trim"></a>

## TRIM.md

# Preserved firmware boundary

This is the historical ESP-Claw fork used by P4+C6 research. Supported board-manager targets are Guition JC4880P443C, Waveshare ESP32-S3 Touch LCD 2.8, and M5Stack PaperColor; see [build instructions](README.md). This directory does not define the active Electron Shell release.

## Removed upstream surfaces

- Standalone MCP sample application and the upstream application identity (renamed to `open_deskos`).
- Upstream Astro documentation, web simulator, emsdk simulator and GitLab CI. The [native SDL simulator](sim/native_sdl/README.md) preserves the host UI path.
- Standalone CO6300 AMOLED bring-up archive; hardware conclusions remain in the historical specifications.

## Retained runtime contract

The LLM HTTP transport and anthropic/openai-compatible/custom backends under `components/claw_modules/claw_core/src/llm/` remain part of this research firmware. The historical OS design restored runtime LLM use after an earlier proposal to remove it; see [protocol and safety design](README.md#preserved-protocol-and-safety-design).

Consult [UPSTREAM.md](UPSTREAM.md) for dependency provenance and local deltas. This boundary describes the preserved tree, not proof that a feature has passed hardware acceptance.


<a id="application-open-deskos-components-cmake-utilities-readme"></a>

## application/open_deskos/components/cmake_utilities/README.md

# Cmake utilities

[![Component Registry](https://components.espressif.com/components/espressif/cmake_utilities/badge.svg)](https://components.espressif.com/components/espressif/cmake_utilities)

This component is aiming to provide some useful CMake utilities outside of ESP-IDF.

## Use

1. Add dependency of this component in your component or project's idf_component.yml.

    ```yml
    dependencies:
      espressif/cmake_utilities: "0.*"
    ```

2. Include the CMake file you need in your component's CMakeLists.txt after `idf_component_register`, or in your project's CMakeLists.txt

    ```cmake
    // Note: should remove .cmake postfix when using include(), otherwise the requested file will not found
    // Note: should place this line after `idf_component_register` function
    // only include the one you needed.
    include(package_manager)
    ```

3. Then you can use the corresponding CMake function which is provided by the CMake file.

## Supported features

1. [relinker](https://github.com/espressif/esp-iot-solution/blob/master/tools/cmake_utilities/docs/relinker.md)
2. [gen_compressed_ota](https://github.com/espressif/esp-iot-solution/blob/master/tools/cmake_utilities/docs/gen_compressed_ota.md)
3. [GCC Optimization](https://github.com/espressif/esp-iot-solution/blob/master/tools/cmake_utilities/docs/gcc.md)

<a id="application-open-deskos-components-cmake-utilities-docs-relinker"></a>

## application/open_deskos/components/cmake_utilities/docs/relinker.md

# Relinker

In ESP-IDF, some functions are put in SRAM when link stage, the reason is that some functions are critical, we need to put them in SRAM to speed up the program, or the functions will be executed when the cache is disabled. But actually, some functions can be put into Flash, here, we provide a script to let the user set the functions which are located in SRAM by default to put them into Flash, in order to save more SRAM which can be used as heap region later. This happens in the linker stage, so we call it as relinker.

## Use

In order to use this feature, you need to include the needed CMake file in your project's CMakeLists.txt after `project(XXXX)`.

```cmake
project(XXXX)

include(relinker)
```

The relinker feature is disabled by default, in order to use it, you need to enable the option `CU_RELINKER_ENABLE` in menuconfig.

Here are the default configuration files in the folder `cmake_utilities/scripts/relinker/examples/esp32c2`, it's just used as a reference. If you would like to use your own configuration files, please enable option `CU_RELINKER_ENABLE_CUSTOMIZED_CONFIGURATION_FILES` and set the path of your configuration files as following, this path is evaluated relative to the project root directory:

```
[*]     Enable customized relinker configuration files
(path of your configuration files) Customized relinker configuration files path
```

> Note: Currently only esp32c2 is supported.

## Configuration Files

You can refer to the files in the directory of `cmake_utilities/scripts/relinker/examples/esp32c2`:

- library.csv
- object.csv
- function.csv

For example, if you want to link function `__getreent` from SRAM to Flash, firstly you should add it to `function.csv` file as following:

```
libfreertos.a,tasks.c.obj,__getreent,
```

This means function `__getreent` is in object file `tasks.c.obj`, and object file `tasks.c.obj` is in library `libfreertos.a`.

If function `__getreent` depends on the option `FREERTOS_PLACE_FUNCTIONS_INTO_FLASH` in menuconfig, then it should be:

```
libfreertos.a,tasks.c.obj,__getreent,CONFIG_FREERTOS_PLACE_FUNCTIONS_INTO_FLASH
```

This means when only `FREERTOS_PLACE_FUNCTIONS_INTO_FLASH` is enabled in menuconfig, function `__getreent` will be linked from SRAM to Flash.

Next step you should add the path of the object file to `object.csv`:

```
libfreertos.a,tasks.c.obj,esp-idf/freertos/CMakeFiles/__idf_freertos.dir/FreeRTOS-Kernel/tasks.c.obj
```

This means the object file `tasks.c.obj` is in library `libfreertos.a` and its location is `esp-idf/freertos/CMakeFiles/__idf_freertos.dir/FreeRTOS-Kernel/tasks.c.obj` relative to directory of `build`.

Next step you should add path of library to `library.csv`:

```
libfreertos.a,./esp-idf/freertos/libfreertos.a
```

This means library `libfreertos.a`'s location is `./esp-idf/freertos/libfreertos.a` relative to `build`.

If above related data has exists in corresponding files, please don't add this repeatedly.

<a id="application-open-deskos-components-esp-lcd-st7701-readme"></a>

## application/open_deskos/components/esp_lcd_st7701/README.md

# ESP LCD ST7701(S)

[![Component Registry](https://components.espressif.com/components/espressif/esp_lcd_st7701/badge.svg)](https://components.espressif.com/components/espressif/esp_lcd_st7701)

Implementation of the ST7701(S) LCD controller with esp_lcd component.

| LCD controller | Communication interface | Component name |                              Link to datasheet                               |
| :------------: | :---------------------: | :------------: | :--------------------------------------------------------------------------: |
|    ST7701(S)     |    3-wire SPI + RGB / MIPI-DSI     | esp_lcd_st7701 | [PDF](https://dl.espressif.com/AE/esp-iot-solution/ST7701S_SPEC_%20V1.4.pdf) |

**Note**: MIPI-DSI interface only supports ESP-IDF v5.3 and above versions.

For more information on LCD, please refer to the [LCD documentation](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/lcd/index.html).

## Add to project

Packages from this repository are uploaded to [Espressif's component service](https://components.espressif.com/).
You can add them to your project via `idf.py add-dependency`, e.g.

```
    idf.py add-dependency "espressif/esp_lcd_st7701"
```

Alternatively, you can create `idf_component.yml`. More is in [Espressif's documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/tools/idf-component-manager.html).

## Example use

### RGB Interface

For most RGB LCDs, they typically use a "3-Wire SPI + Parallel RGB" interface. The "3-Wire SPI" interface is used for transmitting command data and the "Parallel RGB" interface is used for sending pixel data.

It's recommended to use the [esp_lcd_panel_io_additions](https://components.espressif.com/components/espressif/esp_lcd_panel_io_additions) component to bit-bang the "3-Wire SPI" interface through **GPIO** or an **IO expander** (like [TCA9554](https://components.espressif.com/components/espressif/esp_io_expander_tca9554)). To do this, please first add this component to your project manually. Then, refer to the following code to initialize the ST7701 controller.

```c
    ESP_LOGI(TAG, "Install 3-wire SPI panel IO");
    spi_line_config_t line_config = {
        .cs_io_type = IO_TYPE_EXPANDER,             // Set to `IO_TYPE_GPIO` if using GPIO, same to below
        .cs_gpio_num = EXAMPLE_LCD_IO_SPI_CS,
        .scl_io_type = IO_TYPE_GPIO,
        .scl_gpio_num = EXAMPLE_LCD_IO_SPI_SCK,
        .sda_io_type = IO_TYPE_GPIO,
        .sda_gpio_num = EXAMPLE_LCD_IO_SPI_SDO,
        .io_expander = NULL,                        // Set to NULL if not using IO expander
    };
    esp_lcd_panel_io_3wire_spi_config_t io_config = ST7701_PANEL_IO_3WIRE_SPI_CONFIG(line_config, 0);
    esp_lcd_panel_io_handle_t io_handle = NULL;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_3wire_spi(&io_config, &io_handle));

/**
 * Uncomment these line if use custom initialization commands.
 * The array should be declared as static const and positioned outside the function.
 */
// static const st7701_lcd_init_cmd_t lcd_init_cmds[] = {
// //   cmd   data        data_size  delay_ms
//    {0xFF, (uint8_t []){0x77, 0x01, 0x00, 0x00, 0x13}, 5, 0},
//    {0xEF, (uint8_t []){0x08}, 1, 0},
//    {0xFF, (uint8_t []){0x77, 0x01, 0x00, 0x00, 0x10}, 5, 0},
//    {0xC0, (uint8_t []){0x3B, 0x00}, 2, 0},
//     ...
// };

    ESP_LOGI(TAG, "Install ST7701 panel driver");
    esp_lcd_rgb_panel_config_t rgb_config = {
        .clk_src = LCD_CLK_SRC_DEFAULT,
        .psram_trans_align = 64,
        .data_width = 16,
        .bits_per_pixel = 16,
        .de_gpio_num = EXAMPLE_LCD_IO_RGB_DE,
        .pclk_gpio_num = EXAMPLE_LCD_IO_RGB_PCLK,
        .vsync_gpio_num = EXAMPLE_LCD_IO_RGB_VSYNC,
        .hsync_gpio_num = EXAMPLE_LCD_IO_RGB_HSYNC,
        .disp_gpio_num = EXAMPLE_LCD_IO_RGB_DISP,
        .data_gpio_nums = {
            EXAMPLE_LCD_IO_RGB_DATA0,
            EXAMPLE_LCD_IO_RGB_DATA1,
            EXAMPLE_LCD_IO_RGB_DATA2,
            EXAMPLE_LCD_IO_RGB_DATA3,
            EXAMPLE_LCD_IO_RGB_DATA4,
            EXAMPLE_LCD_IO_RGB_DATA5,
            EXAMPLE_LCD_IO_RGB_DATA6,
            EXAMPLE_LCD_IO_RGB_DATA7,
            EXAMPLE_LCD_IO_RGB_DATA8,
            EXAMPLE_LCD_IO_RGB_DATA9,
            EXAMPLE_LCD_IO_RGB_DATA10,
            EXAMPLE_LCD_IO_RGB_DATA11,
            EXAMPLE_LCD_IO_RGB_DATA12,
            EXAMPLE_LCD_IO_RGB_DATA13,
            EXAMPLE_LCD_IO_RGB_DATA14,
            EXAMPLE_LCD_IO_RGB_DATA15,
        },
        .timings = ST7701_480_480_PANEL_60HZ_RGB_TIMING(),
        ...
    };
    st7701_vendor_config_t vendor_config = {
        .rgb_config = &rgb_config,
        // .init_cmds = lcd_init_cmds,      // Uncomment these line if use custom initialization commands
        // .init_cmds_size = sizeof(lcd_init_cmds) / sizeof(st7701_lcd_init_cmd_t),
        .flags = {
            .mirror_by_cmd = 1,             // Only work when `enable_io_multiplex` is set to 0
            .enable_io_multiplex = 0,         /**
                                             * Set to 1 if panel IO is no longer needed after LCD initialization.
                                             * If the panel IO pins are sharing other pins of the RGB interface to save GPIOs,
                                             * Please set it to 1 to release the pins.
                                             */
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = EXAMPLE_LCD_IO_RST,           // Set to -1 if not use
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,     // Implemented by LCD command `36h`
        .bits_per_pixel = EXAMPLE_LCD_BIT_PER_PIXEL,    // Implemented by LCD command `3Ah` (16/18/24)
        .vendor_config = &vendor_config,
    };
    esp_lcd_panel_handle_t panel_handle = NULL;
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7701(io_handle, &panel_config, &panel_handle));    /**
                                                                                             * Only create RGB when `enable_io_multiplex` is set to 0,
                                                                                             * or initialize st7701 meanwhile
                                                                                             */
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel_handle));     // Only reset RGB when `enable_io_multiplex` is set to 1, or reset st7701 meanwhile
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel_handle));      // Only initialize RGB when `enable_io_multiplex` is set to 1, or initialize st7701 meanwhile
```

### MIPI Interface

```c
/**
 * Uncomment these line if use custom initialization commands.
 * The array should be declared as static const and positioned outside the function.
 */
// static const st7701_lcd_init_cmd_t lcd_init_cmds[] = {
// //   cmd   data        data_size  delay_ms
//    {0xFF, (uint8_t []){0x77, 0x01, 0x00, 0x00, 0x13}, 5, 0},
//    {0xEF, (uint8_t []){0x08}, 1, 0},
//    {0xFF, (uint8_t []){0x77, 0x01, 0x00, 0x00, 0x10}, 5, 0},
//    {0xC0, (uint8_t []){0x3B, 0x00}, 2, 0},
//     ...
// };
    ESP_LOGI(TAG, "MIPI DSI PHY Powered on");
    esp_ldo_channel_config_t ldo_mipi_phy_config = {
        .chan_id = EXAMPLE_MIPI_DSI_PHY_PWR_LDO_CHAN,
        .voltage_mv = EXAMPLE_MIPI_DSI_PHY_PWR_LDO_VOLTAGE_MV,
    };
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&ldo_mipi_phy_config, &ldo_mipi_phy));

    ESP_LOGI(TAG, "Initialize MIPI DSI bus");
    esp_lcd_dsi_bus_config_t bus_config = ST7701_PANEL_BUS_DSI_2CH_CONFIG();
    ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&bus_config, &mipi_dsi_bus));

    ESP_LOGI(TAG, "Install panel IO");
    esp_lcd_dbi_io_config_t dbi_config = ST7701_PANEL_IO_DBI_CONFIG();
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(mipi_dsi_bus, &dbi_config, &mipi_dbi_io));

    ESP_LOGI(TAG, "Install LCD driver of st7701");
    esp_lcd_panel_handle_t panel_handle = NULL;
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(6, 0, 0)
    esp_lcd_dpi_panel_config_t dpi_config = ST7701_480_360_PANEL_60HZ_DPI_CONFIG(EXAMPLE_MIPI_DPI_PX_FORMAT);
#else
    esp_lcd_dpi_panel_config_t dpi_config = ST7701_480_360_PANEL_60HZ_DPI_CONFIG_CF(EXAMPLE_MIPI_DPI_PX_FORMAT);
#endif
    st7701_vendor_config_t vendor_config = {
        // .init_cmds = lcd_init_cmds,      // Uncomment these line if use custom initialization commands
        // .init_cmds_size = sizeof(lcd_init_cmds) / sizeof(st7701_lcd_init_cmd_t),
        .flags.use_mipi_interface = 1,
        .mipi_config = {
            .dsi_bus = mipi_dsi_bus,
            .dpi_config = &dpi_config,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = EXAMPLE_PIN_NUM_LCD_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = EXAMPLE_LCD_BIT_PER_PIXEL,
        .vendor_config = &vendor_config,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7701(mipi_dbi_io, &panel_config, &panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel_handle));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel_handle, true));
```


<a id="application-open-deskos-components-esp-lcd-touch-readme"></a>

## application/open_deskos/components/esp_lcd_touch/README.md

# ESP LCD Touch Component

[![Component Registry](https://components.espressif.com/components/espressif/esp_lcd_touch/badge.svg)](https://components.espressif.com/components/espressif/esp_lcd_touch)

This componnent is main esp_lcd_touch component which defines main functions and types for easy adding specific touch controller component.

## Supported features

- [x] Read XY
- [x] Swap XY
- [x] Mirror X
- [x] Mirror Y
- [x] Interrupt callback
- [x] Sleep mode
- [ ] Calibration



<a id="application-open-deskos-components-esp-lcd-touch-gt911-readme"></a>

## application/open_deskos/components/esp_lcd_touch_gt911/README.md

# ESP LCD Touch GT911 Controller

[![Component Registry](https://components.espressif.com/components/espressif/esp_lcd_touch_gt911/badge.svg)](https://components.espressif.com/components/espressif/esp_lcd_touch_gt911)

Implementation of the GT911 touch controller with esp_lcd_touch component.

| Touch controller | Communication interface | Component name | Link to datasheet |
| :--------------: | :---------------------: | :------------: | :---------------: |
| GT911            | I2C                     | esp_lcd_touch_gt911 | [WIKI](https://www.waveshare.com/wiki/7inch-Capacitive-Touch-LCD-C_Datasheets) |

## Add to project

Packages from this repository are uploaded to [Espressif's component service](https://components.espressif.com/).
You can add them to your project via `idf.py add-dependancy`, e.g.
```
    idf.py add-dependency esp_lcd_touch_gt911==1.1.1
```

Alternatively, you can create `idf_component.yml`. More is in [Espressif's documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/tools/idf-component-manager.html).

## Example use

Initialization of the touch component.

``` c
    esp_lcd_panel_io_i2c_config_t io_config = ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();

    esp_lcd_touch_io_gt911_config_t tp_gt911_config = {
        .dev_addr = io_config.dev_addr,
    };

    esp_lcd_touch_config_t tp_cfg = {
        .x_max = CONFIG_LCD_HRES,
        .y_max = CONFIG_LCD_VRES,
        .rst_gpio_num = -1,
        .int_gpio_num = -1,
        .levels = {
            .reset = 0,
            .interrupt = 0,
        },
        .flags = {
            .swap_xy = 0,
            .mirror_x = 0,
            .mirror_y = 0,
        },
        .driver_data = &tp_gt911_config,
    };

    esp_lcd_touch_handle_t tp;
    esp_lcd_touch_new_i2c_gt911(io_handle, &tp_cfg, &tp);
```

Read data from the touch controller and store it in RAM memory. It should be called regularly in poll.

``` c
    esp_lcd_touch_read_data(tp);
```

Get attributes of a single touch point.

``` c
    esp_lcd_touch_point_data_t touch_point_data[1];
    uint8_t touch_cnt = 0;

    ESP_ERROR_CHECK(esp_lcd_touch_get_data(tp, touch_point_data, &touch_cnt, 1));
```


<a id="components-claw-modules-claw-utils-readme"></a>

## components/claw_modules/claw_utils/README.md

# claw_utils

Small dependency-light helpers shared by ESP-Claw modules and capabilities.

Functions here should not depend on any ESP-Claw components.


<a id="application-open-deskos-components-cmake-utilities-docs-gcc"></a>

## application/open_deskos/components/cmake_utilities/docs/gcc.md

# Link Time Optimization(LTO)

Link time optimization(LTO) improves the optimization effect of GCC, such as reducing binary size, increasing performance, and so on. For more details please refer to related [GCC documents](https://gcc.gnu.org/onlinedocs/gccint/LTO.html).

## Use

To use this feature, you need to include the required CMake file in your project's CMakeLists.txt after `project(XXXX)`.

```cmake
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(XXXX)

include(gcc)
```

The LTO feature is disabled by default. To use it, you should enable the option `CU_GCC_LTO_ENABLE` in menuconfig. Then specify target components or dependencies to be optimized by LTO after `include(gcc)` as follows:

```cmake
include(gcc)

cu_gcc_lto_set(COMPONENTS component_a component_b
               DEPENDS dependence_a dependence_b)

cu_gcc_string_1byte_align(COMPONENTS component_c component_d
                          DEPENDS dependence_c dependence_d)
```

Based on your requirement, set compiling optimization level in the option `COMPILER_OPTIMIZATION`.

* Note

    ```
    1. Reducing firmware size may decrease performance
    2. Increasing performance may increase firmware size
    3. Enable LTO cause compiling time cost increases a lot
    4. Enable LTO may increase task stack cost
    5. Enable string 1-byte align may decrease string process speed
    ```

## Limitation

At the linking stage, the LTO generates new function indexes instead of the file path as follows:

- LTO

    ```txt
    .text          0x00000000420016f4        0x6 /tmp/ccdjwYMH.ltrans51.ltrans.o
                   0x00000000420016f4                app_main
    ```

- Without LTO

    ```txt
    .text.app_main 0x00000000420016f4        0x6 esp-idf/main/libmain.a(app_main.c.obj)
                   0x00000000420016f4                app_main
    ```

So tools used to relink functions between flash and IRAM can't affect these optimized components and dependencies again. It is recommended that users had better optimize application components and dependencies than kernel and hardware driver ones.

## Example

The example applies LTO in `light` of `esp-matter` because its application code is much larger. Add LTO configuration into project script `CMakeLists.txt` as follows:

```cmake

project(light)

include(gcc)

# Add
set(app_lto_components main chip esp_matter)
# Add
set(idf_lto_components lwip wpa_supplicant nvs_flash)
# Add
set(lto_depends mbedcrypto)

# Add
cu_gcc_lto_set(COMPONENTS ${app_lto_components} ${idf_lto_components}
               DEPENDS ${lto_depends})
```

Configure `ESP32-C2` as the target platform, enable `CU_GCC_LTO_ENABLE` and `CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_DISABLE`, set `COMPILER_OPTIMIZATION` to be `-Os`.
Increase the `main` task stack size to `5120` by option `ESP_MAIN_TASK_STACK_SIZE`.
Compile the project, and then you can see the firmware size decrease a lot:

Option | Firmware size | Stask cost
|:-:|:-:|:-:|
 -Os | 1,113,376 | 2508
 -Os + LTO | 1,020,640 | 4204

Then add `cu_gcc_string_1byte_align` after `cu_gcc_lto_set`:

```cmake
# Add
cu_gcc_lto_set(COMPONENTS ${app_lto_components} ${idf_lto_components}
               DEPENDS ${lto_depends})

cu_gcc_string_1byte_align(COMPONENTS ${app_lto_components} ${idf_lto_components}
                          DEPENDS ${lto_depends})
```

Build the project and the firmware size is:

Option | Firmware size |
|:-:|:-:|
 -Os + LTO | 1,020,640 |
 -Os + LTO + string 1-byte align | 1,018,340 |


<a id="application-open-deskos-components-cmake-utilities-docs-gen-compressed-ota"></a>

## application/open_deskos/components/cmake_utilities/docs/gen_compressed_ota.md

# Gen Compressed OTA

When using the compressed OTA, we need to generate the compressed app firmware. This document mainly describes how to generate the compressed app firmware.

For more information about compressed OTA, refer to [bootloader_support_plus](https://github.com/espressif/esp-iot-solution/tree/master/components/bootloader_support_plus).

## Use
In order to use this feature, you need to include the needed CMake file in your project's CMakeLists.txt after `project(XXXX)`.

```cmake
project(XXXX)

include(gen_compressed_ota)
```

Generate the compressed app firmware in an ESP-IDF "project" directory by running:

```plaintext
idf.py gen_compressed_ota
```

This command will compile your project first, then it will generate the compressed app firmware. For example, run the command under the project `simple_ota_examples` folder. If there are no errors, the `custom_ota_binaries` folder will be created and contains the following files:

```plaintext
simple_ota.bin.xz
simple_ota.bin.xz.packed
```

The file named `simple_ota.bin.xz.packed` is the actual compressed app binary file to be transferred.

In addition, if [secure boot](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/security/secure-boot-v2.html) is enabled, the command will generate the signed compressed app binary file:

```plaintext
simple_ota.bin.xz.packed.signed
```

you can also use the script [gen_custom_ota.py](https://github.com/espressif/esp-iot-solution/tree/master/tools/cmake_utilities/scripts/gen_custom_ota.py) to compress the specified app:

```plaintext
python3 gen_custom_ota.py -i simple_ota.bin
```
