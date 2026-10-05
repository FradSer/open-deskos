# Guition P4 research hardware reference

Use this reference to reproduce the P4 display and touch tests. These records came from pulse-esp work on 2026-07-02 to 07-03 and DeskOS tests in August 2026. This is research evidence. It does not define the active Electron Shell. Check the selected board definition and the installed ESP-IDF headers before you use these values.

## Board and pin values

| Item | Recorded value |
|---|---|
| Board marking | JC4880P443C_I_W |
| Processor / network chip | ESP32-P4 / ESP32-C6-MINI-1U-N4 |
| Display / touch | ST7701 MIPI-DSI 480×800 / GT911 |
| Memory | 32MB Hex PSRAM at 200MHz; 16MB flash |
| LCD reset / backlight | GPIO5 / GPIO23 |
| Touch bus / SDA / SCL | I2C_NUM_1 / GPIO7 / GPIO8 |
| Touch bus clock | 100kHz |
| Touch addresses | Probe 0x5D and 0x14; both gave ACK in the recorded test |
| Touch reset / interrupt | GPIO_NUM_NC; polling was required |
| Codec | ES8311; the source project did not test simultaneous playback and wake-word capture |

Do not apply the old 262×928 AMOLED proposal or its CST3530 pin map to this board. The P4 has no native wireless radio. The C6 shares one radio across Wi-Fi, BLE and ESP-NOW. The C6 USB-Serial/JTAG interface cannot supply a general USB-HID device.

## Display configuration

Use two DSI data lanes at 500Mbps with a 34MHz DPI clock and the custom sequence below. The recorded 550Mbps/28MHz combination failed. The generic component sequence produced a black display.

| Timing field | Value |
|---|---:|
| h_size / v_size | 480 / 800 |
| hsync pulse / back / front | 12 / 42 / 42 |
| vsync pulse / back / front | 2 / 8 / 166 |

Set both input and output color format to RGB565. Set bits_per_pixel to 16 and RGB element order to RGB. The COLMOD command is 0x3A, 0x55. Acquire LDO channel 3 at 2500mV for the DSI PHY. Use DBI virtual channel 0 with 8-bit commands and parameters.

The backlight record uses LEDC low-speed timer 0, channel 0, 20kHz and 10-bit resolution. The initial level is 50%. The source mapping uses duty = Light * 10 and clamps duty 1000 to 1024. A diagnostic app used 5kHz. No documented power-latch GPIO was found in that source project.

## Panel initialization bytes

The recorded sequence matches the source repository and ESPHome PR #12068. The code below is preserved byte for byte, including comments. It is reference code, not a claim that the current firmware uses it.

```c
#define ST7701_CMD(cmd, ...) \
    { cmd, (const uint8_t[]){__VA_ARGS__}, sizeof((const uint8_t[]){__VA_ARGS__}), 0 }

static const st7701_lcd_init_cmd_t s_st7701_init_cmds[] = {
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x13),
    ST7701_CMD(0xEF, 0x08),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x10),
    ST7701_CMD(0xC0, 0x63, 0x00),
    ST7701_CMD(0xC1, 0x0D, 0x02),
    ST7701_CMD(0xC2, 0x10, 0x08),
    ST7701_CMD(0xCC, 0x10),
    ST7701_CMD(0xB0, 0x80, 0x09, 0x53, 0x0C, 0xD0, 0x07, 0x0C, 0x09, 0x09, 0x28, 0x06, 0xD4, 0x13, 0x69, 0x2B, 0x71),
    ST7701_CMD(0xB1, 0x80, 0x94, 0x5A, 0x10, 0xD3, 0x06, 0x0A, 0x08, 0x08, 0x25, 0x03, 0xD3, 0x12, 0x66, 0x6A, 0x0D),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x11),
    ST7701_CMD(0xB0, 0x5D),
    ST7701_CMD(0xB1, 0x58),
    ST7701_CMD(0xB2, 0x87),
    ST7701_CMD(0xB3, 0x80),
    ST7701_CMD(0xB5, 0x4E),
    ST7701_CMD(0xB7, 0x85),
    ST7701_CMD(0xB8, 0x21),
    ST7701_CMD(0xB9, 0x10, 0x1F),
    ST7701_CMD(0xBB, 0x03),
    ST7701_CMD(0xBC, 0x00),
    ST7701_CMD(0xC1, 0x78),
    ST7701_CMD(0xC2, 0x78),
    ST7701_CMD(0xD0, 0x88),
    ST7701_CMD(0xE0, 0x00, 0x3A, 0x02),
    ST7701_CMD(0xE1, 0x04, 0xA0, 0x00, 0xA0, 0x05, 0xA0, 0x00, 0xA0, 0x00, 0x40, 0x40),
    ST7701_CMD(0xE2, 0x30, 0x00, 0x40, 0x40, 0x32, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00),
    ST7701_CMD(0xE3, 0x00, 0x00, 0x33, 0x33),
    ST7701_CMD(0xE4, 0x44, 0x44),
    ST7701_CMD(0xE5, 0x09, 0x2E, 0xA0, 0xA0, 0x0B, 0x30, 0xA0, 0xA0, 0x05, 0x2A, 0xA0, 0xA0, 0x07, 0x2C, 0xA0, 0xA0),
    ST7701_CMD(0xE6, 0x00, 0x00, 0x33, 0x33),
    ST7701_CMD(0xE7, 0x44, 0x44),
    ST7701_CMD(0xE8, 0x08, 0x2D, 0xA0, 0xA0, 0x0A, 0x2F, 0xA0, 0xA0, 0x04, 0x29, 0xA0, 0xA0, 0x06, 0x2B, 0xA0, 0xA0),
    ST7701_CMD(0xEB, 0x00, 0x00, 0x4E, 0x4E, 0x00, 0x00, 0x00),
    ST7701_CMD(0xEC, 0x08, 0x01),
    ST7701_CMD(0xED, 0xB0, 0x2B, 0x98, 0xA4, 0x56, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xF7, 0x65, 0x4A, 0x89, 0xB2, 0x0B),
    ST7701_CMD(0xEF, 0x08, 0x08, 0x08, 0x45, 0x3F, 0x54),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x00),
    // 以下是标准 MIPI DCS 命令，ESPHome 框架本会自动追加（不在上面的面板专
    // 属伽马/GIP 数据里）：
    ST7701_CMD(0x36, 0x00),  // MADCTL：不镜像/不翻转（如画面镜像需调整）
    ST7701_CMD(0x3A, 0x55),  // COLMOD：RGB565，与 DPI 像素格式一致
    { 0x11, nullptr, 0, 120 },  // SLPOUT，之后延时 120ms（ST7701 数据手册最小值）
    { 0x29, nullptr, 0, 20 },   // DISPON，之后延时 20ms
};
```

## Touch configuration

Set glitch_ignore_cnt to 7 and enable internal pull-ups. Probe with a 50ms timeout. Set x_max=480 and y_max=800. Set disable_control_phase=1, control_phase_bytes=1, dc_bit_offset=0 and lcd_cmd_bits=16. An extra control byte corrupts the GT911 register address.

Call esp_lcd_touch_read_data() before esp_lcd_touch_get_data(). The latter reads the cache. The ID register must return ASCII 911 (0x39, 0x31, 0x31). Delete the panel IO handle if touch creation fails. Check the current component header before you use a designated-initializer macro in C++.

## Memory, build and USB limits

- The recorded silicon was rev v1.0. Its configuration used CONFIG_ESP32P4_SELECTS_REV_LESS_V3=y, CONFIG_SPIRAM_MODE_HEX=y and CONFIG_SPIRAM_SPEED_200M=y.
- The record used 16MB QIO flash, a 16384-byte main task stack and CONFIG_FREERTOS_HZ=1000. Select settings for the actual board. Do not copy these values to an S3 target.
- Read generated flash_args for offsets. The record used P4 bootloader offset 0x2000; the S3 offset was 0x0.
- Call nvs_flash_init() before native NVS access.
- A binary USB-Serial/JTAG protocol must own the interface. In the pulse-esp test, both CONFIG_ESP_CONSOLE_NONE and CONFIG_ESP_CONSOLE_SECONDARY_NONE were required to prevent log bytes in protocol frames.
- The factory C6 version was 0.0.0 while the host expected 2.8.0. That mismatch came from the factory image. The source pulse-esp project did not use the C6.

## Render and touch experiments

Use an off-screen buffer when the display can scan pixels during a CPU write. The first test used two 480×80 RGB565 strips (76800 bytes each), 64-byte alignment and internal SRAM first, with PSRAM as fallback. Flush through esp_lcd_panel_draw_bitmap(); a memcpy alone does not supply the required cache writeback. Convert LVGL inclusive x2/y2 to the exclusive panel end coordinates with +1.

Later tests used Direct mode with two display frame buffers. Partial mode remained the fallback if the runtime could not obtain them. The experiment used refresh_period=12ms, PPA burst=64, 64-byte draw/cache alignment, a cache-safe DSI ISR and compiler PERF optimization. Check generated sdkconfig.h. Dependency updates can replace managed patches.

The August input test moved I2C reads to a core-0 task at 4ms intervals. The LVGL callback consumed one cached PRESS/MOVE/RELEASE sample. Two empty samples confirmed release; read errors had a 12ms grace period. Five automatic swipes on a simple Direct page measured 15.8–16.8ms per frame. Complex snapshot pages measured 26.2–29.5ms. These are programmatic results, not finger-input acceptance.

## Reproduction and acceptance

1. Follow the [firmware build instructions](../firmware/README.md). Flashing requires an authorized device task.
2. First test the DSI pattern generator. Then test solid RGB/white/black fills through the panel draw API. Then scan I2C addresses 0x08–0x77 and test touch coordinates.
3. Wait for the console to accept cerb ui, then run cerb ui demo. Check the selected render path, memory faults, underrun and callback timeouts.
4. Record touch-read, input callback, scroll, render, flush, frame-buffer-complete and VSYNC timestamps. Do not log each event on the critical path.
5. Change one variable at a time. Compare input polling, frame completion, render mode, snap/momentum, snapshot buffers, task scheduling and DPI clock.
6. Test at least 20 swipes in each direction in cold and steady states. Include fast reversal. Record release animation separately from drag latency.

The proposed gates were touch-to-scroll p95 ≤16ms, scroll-to-presentation p95 ≤16.67ms, no frame above 33ms, and no tear, blank frame or underrun. These are research targets, not verified guarantees. FULL buffers permit overlap but still render the full screen. A buffer-release callback does not prove that the panel has displayed a frame. FPS alone does not prove touch latency.

## Recorded sources

- [JC4880P433C LVGL reference](https://github.com/buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation) (the repository name differs from the board marking).
- ESPHome PR #12068, components/mipi_dsi/models/guition.py.
- pulse-esp display/touch drivers, board configuration and hw_test_p4 records.
- [ESP-IDF DSI API](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html).
- [LVGL display modes](https://docs.lvgl.io/9.0/porting/display.html) and [snapshot API](https://docs.lvgl.io/9.0/others/snapshot.html).
- [Espressif LVGL adapter](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html).

The sources and measurements were not checked again during this document edit.


<a id="application-open-deskos-boards-m5stack-m5papercolor-readme"></a>

# M5Stack PaperColor (ESP32-S3)

Board definition for the **M5Stack PaperColor** e-paper terminal.

## Hardware Specifications

- **SoC**: ESP32-S3 (Dual-core Xtensa @ 240MHz, 16MB Flash, 8MB PSRAM)
- **Display**: 4.3-inch 400×600 ED2208 reflective e-paper panel (SPI interface)
- **PMIC**: M5PM1 on I2C (address `0x6E`), controls EPD power rail on PM1 GPIO0
- **Buttons**: GPIO 1, GPIO 9, GPIO 10 (Active Low)
- **RGB LED**: GPIO 21 (WS2812, 2 LEDs)
- **Touch**: None (physical buttons only)

## Pin Assignments

### ED2208 SPI Display
| Signal | GPIO | Description |
|---|---|---|
| SCLK | GPIO 15 | SPI Clock |
| MOSI | GPIO 13 | SPI Data Out |
| MISO | GPIO 14 | SPI Data In |
| DC | GPIO 43 | Data / Command Select |
| CS | GPIO 44 | Chip Select |
| RST | GPIO 12 | Hardware Reset |
| BUSY | GPIO 11 | Busy Status (Active Low: 0=Busy, 1=Ready) |

### Power Management (M5PM1 I2C)
| Signal | GPIO / Reg | Description |
|---|---|---|
| I2C SCL | GPIO 2 | PMIC I2C Clock |
| I2C SDA | GPIO 3 | PMIC I2C Data |
| EPD_EN | PM1 GPIO0 | High to enable EPD power rail |

## Reference
- Vendor Demo: [M5PaperColor-UserDemo](https://github.com/m5stack/M5PaperColor-UserDemo)


<a id="application-open-deskos-boards-waveshare-esp32-s3-touch-lcd-2-8-readme"></a>

# Waveshare ESP32-S3 Touch LCD 2.8

This board definition is based on the matching xiaozhi-esp32 2.2.6 hardware
sources and the existing IDF driver in `pulse-esp`.

## Hardware

- SoC: ESP32-S3
- Display: 240x320 ST7789 SPI, RGB565
- Display SPI: SPI2, SCLK GPIO40, MOSI GPIO45, CS GPIO42, DC GPIO41, RST GPIO39
- Backlight: GPIO5, LEDC 20 kHz
- Touch: CST328, I2C1, SDA GPIO1, SCL GPIO3, INT GPIO4, RST GPIO2, address `0x1A`
- Console: USB Serial/JTAG

The source repositories do not use one consistent product name for this pin
map, so the board ID describes the SoC and display size rather than claiming a
specific hardware revision.

## Build with ESP-IDF

```sh
eim run 'idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8' v6.0.1
eim run 'idf.py -B build-s3 build' v6.0.1
```

Use ESP-IDF for this target. PlatformIO is not supported.
