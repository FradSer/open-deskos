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
