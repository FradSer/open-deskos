/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Open DeskOS ESP32-P4 SC2336 generic UVC camera. The firmware captures
 * frames, encodes MJPEG in hardware, and exposes a standard USB Video
 * Class device plus a standard USB Audio Class microphone to the CM5.
 * No on-device face or expression analysis exists in this image.
 */

#include <stdio.h>

#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "tinyusb.h"
#include "tinyusb_default_config.h"

#include "p4_sc2336.h"
#include "p4_usb_microphone.h"
#include "p4_uvc_stream.h"
#include "sdkconfig.h"

static const char *TAG = "p4_cam_main";

static esp_err_t usb_init(void)
{
    tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    usb_config.port = TINYUSB_PORT_HIGH_SPEED_0;
    usb_config.descriptor = *p4_usb_composite_descriptors();
    ESP_RETURN_ON_ERROR(tinyusb_driver_install(&usb_config), TAG, "install TinyUSB driver");
    ESP_LOGI(TAG, "TinyUSB initialized for CM5 UVC camera and microphone link");
    return ESP_OK;
}

void app_main(void)
{
    ESP_LOGI(TAG, "Open DeskOS ESP32-P4 SC2336 generic UVC camera booting");
    ESP_ERROR_CHECK(nvs_flash_init());

    i2c_master_bus_handle_t peripheral_i2c = NULL;
    ESP_ERROR_CHECK(p4_peripheral_i2c_init(&peripheral_i2c));

    const p4_sc2336_pin_config_t pins = {
        .sda_pin = CONFIG_APP_CAMERA_MIPI_SCCB_SDA_PIN,
        .scl_pin = CONFIG_APP_CAMERA_MIPI_SCCB_SCL_PIN,
        .reset_pin = CONFIG_APP_CAMERA_SC2336_MIPI_RESET_PIN,
        .pwdn_pin = CONFIG_APP_CAMERA_SC2336_MIPI_PWDN_PIN,
        .i2c_port = CONFIG_APP_CAMERA_SCCB_I2C_PORT,
        .i2c_freq = CONFIG_APP_CAMERA_SCCB_I2C_FREQ,
    };
    ESP_ERROR_CHECK(p4_sc2336_init_hardware(&pins, peripheral_i2c));
    ESP_ERROR_CHECK(usb_init());
    ESP_ERROR_CHECK(p4_usb_microphone_init(peripheral_i2c));
    ESP_ERROR_CHECK(p4_uvc_stream_init(CONFIG_APP_CAMERA_FRAME_WIDTH,
                                       CONFIG_APP_CAMERA_FRAME_HEIGHT));
    ESP_ERROR_CHECK(p4_uvc_stream_start());

    ESP_LOGI(TAG, "SC2336 UVC MJPEG stream and USB microphone ready");
}
