# ESP32-C6 Fast Charging + ESP-NOW + SPI AMOLED Research

> Open-source building blocks for a fast charging module with ESP-NOW data broadcast and AMOLED display.

**Date**: 2026-06-25

---

## Summary

No single open-source project combines all three requirements (fast charging + ESP32-C6 + ESP-NOW + SPI AMOLED display). However, well-tested building blocks exist that can be integrated into a custom design.

---

## Fast Charging IC Drivers (ESP-IDF Component Registry)

### BQ25896 PMIC Driver (Most Mature)

- **Component**: `kodediy/kode_bq25896` v1.0.1
- **IC**: Texas Instruments BQ25896 — high-efficiency single-cell Li-Ion charger, up to 5A
- **Features**: Input source control (100mA-3.25A), fast charge current (0-3040mA), boost/OTG mode, battery/system/VBUS voltage monitoring, thermal regulation, JEITA compliance
- **Install**: `idf.py add-dependency "kodediy/kode_bq25896^1.0.1"`
- **License**: Apache-2.0
- **Downloads**: 42

### HUSB238 USB-PD Sink Controller

- **Component**: `drfhaust/husb238` v1.0.1
- **IC**: Hynetek HUSB238 — USB Power Delivery sink controller
- **Features**: 5V-20V voltage selection, automatic hot-plug handling, event callbacks, thread-safe I2C communication
- **Compatible targets**: ESP32, ESP32-S2, ESP32-S3, ESP32-C3, ESP32-C5, **ESP32-C6**, ESP32-H2
- **Install**: `idf.py add-dependency "drfhaust/husb238"`
- **License**: MIT

### MP2660 Linear Charger (Lower Power)

- **Component**: `esp-idf-lib/mp2660` v1.0.7
- **IC**: MP2660 — 500mA single-cell linear charger
- **Note**: Standard rate charging only, not fast charging

---

## USB-PD Protocol Libraries

### Spark Analyzer (Most Popular — 164 stars)

- **Repository**: [tooyipjee/Spark-Analyzer](https://github.com/tooyipjee/Spark-Analyzer)
- **Hardware**: ESP32-C3 + FUSB302MPX + TPS62175 DC-DC
- **Features**: USB PD 5V/9V/15V/20V + PPS (3.3V-21V in 20mV steps), current limiting (0-3A in 50mA steps), BLE/WiFi control, Flutter mobile app, current logging to CSV
- **Max Power**: 100W (5A at 20V)
- **License**: MIT
- **Note**: Uses ESP32-C3, but architecture adaptable to C6

### FUSB302 ESP32 Library (18 stars)

- **Repository**: [tatulea/FUSB302_ESP32](https://github.com/tatulea/FUSB302_ESP32)
- **Features**: USB-PD 2.0/3.0 negotiation, 5V/9V/12V/15V/20V profiles, VID/PID recognition
- **Hardware**: FUSB302B controller + I2C interface

### USB-C Power Delivery for Arduino/ESP32 (18 stars)

- **Repository**: [Helsinki1/USB-C-Power-Delivery](https://github.com/Helsinki1/USB-C-Power-Delivery)
- **Features**: Complete USB-PD state machine, interrupt-driven attach/detach, VDM support
- **Hardware**: FUSB302B controller

---

## ESP-NOW (Official Espressif Component)

- **Component**: `espressif/esp-now`
- **Install**: `idf.py add-dependency "espressif/esp-now=*"`
- **Features**: One-to-many/many-to-many communication, millisecond latency, up to 250 bytes per packet (v2.0: 1470 bytes), WiFi channel locking, ECDH + AES128-CCM security
- **Examples**: get-started, control, OTA, security, solution, wireless_debug
- **Data Pattern**: Sender reads sensor data -> broadcasts via ESP-NOW -> Receivers output to display/serial
- **Docs**: [English](https://github.com/espressif/esp-now/tree/master/User_Guide.md) / [Chinese](https://github.com/espressif/esp-now/tree/master/User_Guide_CN.md)

---

## ESP32-C6 + AMOLED Reference Projects

### AstraFW Smartwatch Firmware (Most Complete Reference)

- **Repository**: [astrixgame/astrafw](https://github.com/astrixgame/astrafw)
- **Hardware**: Waveshare ESP32-C6 Touch AMOLED 2.06" (410x502, CO5300 driver, QSPI)
- **Power Management**: AXP2101 PMIC with battery monitoring, charge state tracking, hardware interrupt callbacks
- **Architecture**: Modular drivers (i2c_driver, display_driver, power_driver, rtc_driver, spiffs_driver, nvs_driver)
- **Build System**: ESP-IDF 5.5+
- **License**: Apache 2.0

### Waveshare ESP32-C6 Touch AMOLED 1.8"

- **Repository**: [waveshareteam/ESP32-C6-Touch-AMOLED-1.8](https://github.com/waveshareteam/ESP32-C6-Touch-AMOLED-1.8)
- **Hardware**: 1.8" AMOLED (368x488, QSPI), dual digital microphones
- **Examples**: Arduino v3.3.5, ESP-IDF v5.5.1
- **License**: Apache 2.0

### ESP32-C6 AMOLED Watch

- **Repository**: [englebert/ESP32-C6-AMOLED-WATCH](https://github.com/englebert/ESP32-C6-AMOLED-WATCH)
- **Hardware**: Waveshare ESP32-C6 AMOLED with AXP2101 PMU
- **Features**: Light sleep with AXP2101 power management, dynamic CPU scaling (40-160MHz), auto-dimming, double-tap/lift-to-wake via IMU
- **License**: MIT

---

## Recommended Architecture

### Hardware Components

| Component | Role | Example IC |
|-----------|------|------------|
| **ESP32-C6** | Main MCU (WiFi 6, BLE 5, 802.15.4, ESP-NOW) | ESP32-C6 |
| **Fast Charger IC** | Battery charging (I2C control) | BQ25896 (5A) or IP2368 (multi-cell) |
| **USB-PD Controller** | Fast charging protocol negotiation | HUSB238 or FUSB302B |
| **AMOLED Display** | SPI/QSPI display with touch | CO5300 driver (like Waveshare boards) |
| **Battery** | Single-cell Li-Ion/LiPo | 3.7V 18650 or LiPo pack |

### Software Stack

```
┌─────────────────────────────────────────────┐
│  Application Layer                          │
│  - Charging data collection & display       │
│  - ESP-NOW data transmission                │
│  - LVGL UI for AMOLED                       │
├─────────────────────────────────────────────┤
│  Middleware                                  │
│  - ESP-NOW component (espressif/esp-now)    │
│  - LVGL graphics library                    │
│  - FreeRTOS tasks                           │
├─────────────────────────────────────────────┤
│  Drivers                                     │
│  - kode_bq25896 (charging IC)               │
│  - drfhaust/husb238 (USB-PD)                │
│  - esp_lcd_panel_io_spi (AMOLED)            │
│  - esp_lcd_touch_i2c (touch)                │
├─────────────────────────────────────────────┤
│  ESP-IDF 5.5+                               │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **Charging IC** (BQ25896) monitors battery voltage, current, temperature via I2C
2. **ESP32-C6** reads charging data at regular intervals (e.g., 1Hz)
3. **LVGL UI** displays charging status, voltage, current, battery % on AMOLED
4. **ESP-NOW** broadcasts charging data packets to paired receiver devices
5. **Receiver devices** (e.g., Open DeskOS P4 main unit) display remote charging status

---

## Caveats

1. **No integrated project** — you wire these components together yourself
2. **IP2368 (multi-cell) has no ESP-IDF driver** — BQ25896 (single-cell) is better supported
3. **Fast charging + ESP-NOW on same ESP32-C6** requires careful FreeRTOS task scheduling to avoid timing conflicts
4. **AMOLED power consumption** — use AXP2101-style PMIC for hardware power gating during sleep
5. **Open DeskOS project already has ESP-NOW planned** in Phase 3 (`DESIGN-EXTENSIONS.md`) for fast charging station expansion

---

## Sources

- [ESP-IDF Component Registry — BQ25896](https://components.espressif.com/components/kodediy/kode_bq25896)
- [ESP-IDF Component Registry — HUSB238](https://components.espressif.com/components/drfhaust/husb238)
- [Espressif ESP-NOW GitHub](https://github.com/espressif/esp-now)
- [AstraFW Smartwatch Firmware](https://github.com/astrixgame/astrafw)
- [Waveshare ESP32-C6 Touch AMOLED 1.8"](https://github.com/waveshareteam/ESP32-C6-Touch-AMOLED-1.8)
- [Spark Analyzer USB-PD ESP32](https://github.com/tooyipjee/Spark-Analyzer)
- [FUSB302 ESP32 Library](https://github.com/tatulea/FUSB302_ESP32)
- [USB-C Power Delivery for ESP32](https://github.com/Helsinki1/USB-C-Power-Delivery)
- [ESP32-C6 AMOLED Watch](https://github.com/englebert/ESP32-C6-AMOLED-WATCH)
