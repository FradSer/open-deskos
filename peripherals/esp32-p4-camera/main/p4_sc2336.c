/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_sc2336.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_video_device.h"
#include "esp_video_init.h"

static const char *TAG = "p4_sc2336";

esp_err_t p4_peripheral_i2c_init(i2c_master_bus_handle_t *bus_handle)
{
    if (bus_handle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const i2c_master_bus_config_t config = {
        .i2c_port = CONFIG_APP_CAMERA_SCCB_I2C_PORT,
        .scl_io_num = CONFIG_APP_CAMERA_MIPI_SCCB_SCL_PIN,
        .sda_io_num = CONFIG_APP_CAMERA_MIPI_SCCB_SDA_PIN,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    return i2c_new_master_bus(&config, bus_handle);
}

esp_err_t p4_sc2336_init_hardware(const p4_sc2336_pin_config_t *pins,
                                  i2c_master_bus_handle_t bus_handle)
{
    if (pins == NULL || bus_handle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ESP_LOGI(TAG, "Initializing SC2336 hardware (SCCB SDA=%d, SCL=%d, RST=%d)",
             pins->sda_pin, pins->scl_pin, pins->reset_pin);

    static esp_video_init_csi_config_t csi_config[1];
    memset(csi_config, 0, sizeof(csi_config));
    csi_config[0].sccb_config.init_sccb = false;
    csi_config[0].sccb_config.i2c_handle = bus_handle;
    csi_config[0].sccb_config.freq = pins->i2c_freq;
    csi_config[0].reset_pin = pins->reset_pin;
    csi_config[0].pwdn_pin = pins->pwdn_pin;

    const esp_video_init_config_t cam_config = {
        .csi = csi_config,
    };

    esp_err_t ret = esp_video_init(&cam_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_video_init failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_LOGI(TAG, "esp_video_init initialized SC2336 MIPI CSI interface");
    return ESP_OK;
}
