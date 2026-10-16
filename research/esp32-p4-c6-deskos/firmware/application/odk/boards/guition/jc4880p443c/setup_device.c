/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guition JC4880P443C board setup — ST7701S MIPI-DSI display + GT911 touch.
 *
 * Display + touch init values mirror the verified reference driver in
 * ~/Developer/FradSer/pulse-esp/src/display_driver_p4.cpp (confirmed lit on
 * this exact board 2026-07-02): DSI 2 lanes @ 500 Mbps, DPI 34 MHz, 480x800,
 * RGB565, LDO chan 3 @ 2500 mV, LCD RST GPIO5, backlight GPIO23 LEDC, and the
 * ESPHome guition.py ST7701 init-command sequence (43 cmds incl. MADCTL/
 * COLMOD/SLPOUT/DISPON). Without the custom init array the panel stays black
 * or garbled — driver defaults are NOT sufficient for this panel variant.
 *
 * Touch: GT911 over I2C1 (SDA=7/SCL=8, 100kHz), RST/INT NC (polled, address
 * 0x5D with 0x14 fallback). The IO quirk flags.disable_control_phase=1 is
 * mandatory or GT911 reads all-zeros.
 *
 * The on-board ESP32-C6 Wi-Fi co-processor is NOT initialized here — pulse-esp
 * drives the panel fully on the P4 alone with zero C6/esp-hosted involvement.
 */
#include "esp_log.h"
#include "dev_display_lcd.h"
#include "esp_lcd_st7701.h"
#include "esp_lcd_touch_gt911.h"

static const char *TAG = "GUITION_JC4880";

/* ST7701S init sequence — ESPHome guition.py model (verified on this board).
 * Standard MIPI DCS SLPOUT/DISPON appended with post-delays. */
#define ST7701_CMD(c, ...) \
    { (c), (const uint8_t[]){__VA_ARGS__}, sizeof((const uint8_t[]){__VA_ARGS__}), 0 }
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
    ST7701_CMD(0x36, 0x00),  /* MADCTL: no mirror/flip */
    ST7701_CMD(0x3A, 0x55),  /* COLMOD: RGB565 */
    { 0x11, NULL, 0, 120 },  /* SLPOUT, 120ms */
    { 0x29, NULL, 0, 20 },   /* DISPON, 20ms */
};

esp_err_t lcd_dsi_panel_factory_entry_t(esp_lcd_dsi_bus_handle_t dsi_handle,
                                        dev_display_lcd_config_t *lcd_cfg,
                                        dev_display_lcd_handles_t *lcd_handles)
{
    /* board_manager already acquires the DSI PHY LDO (ldo_mipi peripheral in
     * board_peripherals.yaml) and creates the DSI bus + DBI IO before calling
     * this factory. Only the panel creation is the factory's job. */

    st7701_vendor_config_t vendor_config = {0};
    vendor_config.init_cmds = s_st7701_init_cmds;
    vendor_config.init_cmds_size = sizeof(s_st7701_init_cmds) / sizeof(s_st7701_init_cmds[0]);
    vendor_config.mipi_config.dsi_bus = dsi_handle;
    vendor_config.mipi_config.dpi_config = &lcd_cfg->sub_cfg.dsi.dpi_config;
    vendor_config.flags.use_mipi_interface = 1;

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = 5,   /* LCD RST is wired to GPIO5 on this board */
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_config,
    };

    esp_err_t ret = esp_lcd_new_panel_st7701(lcd_handles->io_handle, &panel_config,
                                   &lcd_handles->panel_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_lcd_new_panel_st7701 failed: %s", esp_err_to_name(ret));
        return ret;
    }
    return ESP_OK;
}

esp_err_t lcd_touch_factory_entry_t(const esp_lcd_panel_io_handle_t io,
                                    const esp_lcd_touch_config_t *touch_dev_config,
                                    esp_lcd_touch_handle_t *ret_touch)
{
    esp_err_t ret = esp_lcd_touch_new_i2c_gt911(io, touch_dev_config, ret_touch);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_lcd_touch_new_i2c_gt911 failed: %s", esp_err_to_name(ret));
        return ret;
    }
    return ESP_OK;
}

static void __attribute__((constructor)) guition_jc4880_early_init(void)
{
    ESP_LOGI(TAG, "Guition JC4880P443C early init (ST7701 DSI + GT911 touch, pulse-esp reference)");
}
