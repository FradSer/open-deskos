/* SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 * No on-device face or expression analysis exists in this image.
 */
#include "esp_check.h"
#include "esp_log.h"
#include "esp_video_device.h"
#include "esp_video_init.h"
#include "nvs_flash.h"
#include "tinyusb_default_config.h"
#include "p4_sc2336.h"
#include "p4_usb_microphone.h"
#include "p4_uvc_stream.h"
#include "p4_plugins.h"
#include "p4_camera_plugins.h"
#include "sdkconfig.h"

static const char *TAG = "p4_cam_main";
static odk_plugin_host_t s_host;
static bool s_nvs_owned, s_camera_owned, s_usb_installed;
static bool s_stream_ready;
static p4_i2c_port_t s_i2c;
static const p4_camera_port_t s_camera = {
    .capture_name=ESP_VIDEO_MIPI_CSI_DEVICE_NAME, .encoder_name=ESP_VIDEO_JPEG_DEVICE_NAME,
};

static esp_err_t storage_init(void *context, const void *config)
{
    (void)config;
    ESP_RETURN_ON_ERROR(nvs_flash_init(), TAG, "initialize storage");
    s_nvs_owned = true;
    return odk_plugin_publish(context, P4_PORT_NVS, &s_nvs_owned);
}
static esp_err_t storage_destroy(void)
{
    if (s_nvs_owned) {
        ESP_RETURN_ON_ERROR(nvs_flash_deinit(), TAG, "release storage");
        s_nvs_owned = false;
    }
    return ESP_OK;
}
static esp_err_t i2c_init(void *context, const void *config)
{
    (void)config;
    ESP_RETURN_ON_ERROR(p4_peripheral_i2c_init(&s_i2c.bus), TAG, "initialize peripheral I2C");
    return odk_plugin_publish(context, P4_PORT_I2C, &s_i2c);
}
static esp_err_t i2c_destroy(void)
{
    if (s_i2c.bus != NULL) {
        ESP_RETURN_ON_ERROR(i2c_del_master_bus(s_i2c.bus), TAG, "release peripheral I2C");
        s_i2c.bus = NULL;
    }
    return ESP_OK;
}
static esp_err_t camera_init(void *context, const void *config)
{
    (void)config;
    const p4_i2c_port_t *i2c = odk_plugin_get(context, P4_PORT_I2C);
    ESP_RETURN_ON_FALSE(i2c != NULL, ESP_ERR_INVALID_STATE, TAG, "camera I2C is unavailable");
    const p4_sc2336_pin_config_t pins = {
        .sda_pin=CONFIG_APP_CAMERA_MIPI_SCCB_SDA_PIN, .scl_pin=CONFIG_APP_CAMERA_MIPI_SCCB_SCL_PIN,
        .reset_pin=CONFIG_APP_CAMERA_SC2336_MIPI_RESET_PIN, .pwdn_pin=CONFIG_APP_CAMERA_SC2336_MIPI_PWDN_PIN,
        .i2c_port=CONFIG_APP_CAMERA_SCCB_I2C_PORT, .i2c_freq=CONFIG_APP_CAMERA_SCCB_I2C_FREQ,
    };
    s_camera_owned = true;
    ESP_RETURN_ON_ERROR(p4_sc2336_init_hardware(&pins, i2c->bus), TAG, "initialize sensor");
    return odk_plugin_publish(context, P4_PORT_CAMERA, (void *)&s_camera);
}
static esp_err_t camera_destroy(void)
{
    if (s_camera_owned) {
        ESP_RETURN_ON_ERROR(esp_video_deinit(), TAG, "release sensor");
        s_camera_owned = false;
    }
    return ESP_OK;
}
static esp_err_t usb_init(void *context, const void *config)
{
    (void)config;
    tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    usb_config.port = TINYUSB_PORT_HIGH_SPEED_0;
    usb_config.descriptor = *p4_usb_composite_descriptors();
    s_usb_installed = true; /* Retain partial SDK initialization until uninstall succeeds. */
    ESP_RETURN_ON_ERROR(tinyusb_driver_install(&usb_config), TAG, "install TinyUSB driver");
    ESP_LOGI(TAG, "TinyUSB initialized for CM5 UVC camera and microphone link");
    return odk_plugin_publish(context, P4_PORT_USB, (void *)p4_usb_default_port());
}
static esp_err_t usb_destroy(void)
{
    if (s_usb_installed) {
        ESP_RETURN_ON_ERROR(tinyusb_driver_uninstall(), TAG, "stop shared USB callbacks");
        s_usb_installed = false;
    }
    return p4_usb_audio_deinit_after_usb_stop();
}
static esp_err_t microphone_init(void *context, const void *config)
{
    (void)config;
    const p4_i2c_port_t *i2c = odk_plugin_get(context, P4_PORT_I2C);
    const p4_usb_port_t *usb = odk_plugin_get(context, P4_PORT_USB);
    ESP_RETURN_ON_FALSE(i2c != NULL && usb != NULL, ESP_ERR_INVALID_STATE, TAG, "audio ports are unavailable");
    ESP_RETURN_ON_ERROR(p4_usb_microphone_init_with_transport(i2c->bus, usb), TAG, "initialize microphone");
    return odk_plugin_publish(context, P4_PORT_AUDIO, (void *)p4_microphone_source());
}
static esp_err_t stream_init(void *context, const void *config)
{
    (void)config;
    const p4_camera_port_t *camera = odk_plugin_get(context, P4_PORT_CAMERA);
    const p4_usb_port_t *usb = odk_plugin_get(context, P4_PORT_USB);
    ESP_RETURN_ON_FALSE(camera != NULL && usb != NULL, ESP_ERR_INVALID_STATE, TAG, "video ports are unavailable");
    ESP_RETURN_ON_ERROR(p4_uvc_stream_init_with_ports(CONFIG_APP_CAMERA_FRAME_WIDTH,
        CONFIG_APP_CAMERA_FRAME_HEIGHT, camera, &usb->video), TAG, "initialize video stream");
    s_stream_ready = true;
    return odk_plugin_publish(context, P4_PORT_STREAM, &s_stream_ready);
}
static esp_err_t stream_destroy(void)
{
    ESP_RETURN_ON_ERROR(p4_uvc_stream_deinit(), TAG, "release video stream");
    s_stream_ready = false;
    return ESP_OK;
}
const odk_plugin_lifecycle_t p4_storage_lifecycle = {.init=storage_init, .destroy=storage_destroy};
const odk_plugin_lifecycle_t p4_i2c_lifecycle = {.init=i2c_init, .destroy=i2c_destroy};
const odk_plugin_lifecycle_t p4_camera_lifecycle = {.init=camera_init, .destroy=camera_destroy};
const odk_plugin_lifecycle_t p4_usb_lifecycle = {.init=usb_init, .destroy=usb_destroy};
const odk_plugin_lifecycle_t p4_microphone_lifecycle = {
    .init=microphone_init, .stop=p4_usb_microphone_stop, .destroy=p4_usb_microphone_deinit,
};
const odk_plugin_lifecycle_t p4_stream_lifecycle = {
    .init=stream_init, .start=p4_uvc_stream_start, .stop=p4_uvc_stream_stop, .destroy=stream_destroy,
};
odk_plugin_host_t *p4_camera_plugin_host(void) { return &s_host; }

void app_main(void)
{
    ESP_LOGI(TAG, "Open DeskOS ESP32-P4 SC2336 generic UVC camera booting");
    ESP_ERROR_CHECK(odk_plugin_host_init(&s_host, g_odk_plugins, g_odk_plugins_count, NULL));
    ESP_ERROR_CHECK(odk_plugin_host_start(&s_host));
    ESP_LOGI(TAG, "SC2336 UVC MJPEG stream and USB microphone ready");
}
