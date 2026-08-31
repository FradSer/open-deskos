/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guition JC4880P443C GT911 — mirrors csvke bsp_touch.c / pulse-esp hw_test_p4.
 * Authoritative: https://github.com/csvke/esp32_p4_jc4880p433c_bsp
 */
#include "odk_touch_bringup.h"

#include "odk_display_bringup.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_lcd_io_i2c.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_touch_gt911.h"
#include "esp_log.h"

static const char *TAG = "odk_touch";

#define ODK_TOUCH_I2C_PORT   I2C_NUM_1
#define ODK_TOUCH_SDA_GPIO   GPIO_NUM_7
#define ODK_TOUCH_SCL_GPIO   GPIO_NUM_8
#define ODK_TOUCH_I2C_HZ     400000

static i2c_master_bus_handle_t s_i2c;
static esp_lcd_panel_io_handle_t s_tp_io;
static esp_lcd_touch_handle_t s_tp;

esp_lcd_touch_handle_t odk_touch_get_handle(void)
{
    return s_tp;
}

esp_err_t odk_touch_bringup(void)
{
    if (s_tp != NULL) {
        return ESP_OK;
    }

    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port = ODK_TOUCH_I2C_PORT,
        .sda_io_num = ODK_TOUCH_SDA_GPIO,
        .scl_io_num = ODK_TOUCH_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_i2c), TAG, "i2c bus");

    uint8_t addr = 0;
    if (i2c_master_probe(s_i2c, ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS, 50) == ESP_OK) {
        addr = ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS;
    } else if (i2c_master_probe(s_i2c, ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS_BACKUP, 50) == ESP_OK) {
        addr = ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS_BACKUP;
    }
    if (addr == 0) {
        ESP_LOGE(TAG, "GT911 not found on I2C (SDA=%d SCL=%d)",
                 (int)ODK_TOUCH_SDA_GPIO, (int)ODK_TOUCH_SCL_GPIO);
        return ESP_ERR_NOT_FOUND;
    }
    ESP_LOGI(TAG, "GT911 at 0x%02X (I2C SDA=%d SCL=%d)", addr,
             (int)ODK_TOUCH_SDA_GPIO, (int)ODK_TOUCH_SCL_GPIO);

    esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();
    io_cfg.dev_addr = addr;
    io_cfg.scl_speed_hz = ODK_TOUCH_I2C_HZ;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_i2c(s_i2c, &io_cfg, &s_tp_io), TAG, "tp io");

    const esp_lcd_touch_config_t tp_cfg = {
        .x_max = ODK_DISPLAY_H_RES,
        .y_max = ODK_DISPLAY_V_RES,
        .rst_gpio_num = GPIO_NUM_NC,
        .int_gpio_num = GPIO_NUM_NC,
        .levels = {
            .reset = 0,
            .interrupt = 0,
        },
        .flags = {
            .swap_xy = 0,
            .mirror_x = 0,
            .mirror_y = 0,
        },
    };
    ESP_RETURN_ON_ERROR(esp_lcd_touch_new_i2c_gt911(s_tp_io, &tp_cfg, &s_tp), TAG, "gt911");
    ESP_LOGI(TAG, "GT911 ready (polled; RST/INT NC)");
    return ESP_OK;
}
