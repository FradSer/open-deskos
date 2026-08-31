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
