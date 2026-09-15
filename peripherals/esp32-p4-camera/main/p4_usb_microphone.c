/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_usb_microphone.h"

#include <math.h>
#include <string.h>

#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "usb_device_uac.h"

static const char *TAG = "p4_usb_mic";
static esp_codec_dev_handle_t s_microphone;
static i2s_chan_handle_t s_i2s_rx;

static esp_err_t microphone_input(uint8_t *buffer, size_t length, size_t *bytes_read, void *context)
{
    (void)context;
    if (s_microphone == NULL || esp_codec_dev_read(s_microphone, buffer, (int)length) != ESP_CODEC_DEV_OK) {
        memset(buffer, 0, length);
    }
    *bytes_read = length;
    return ESP_OK;
}

static esp_err_t init_i2s(void)
{
    i2s_chan_config_t channel_config = I2S_CHANNEL_DEFAULT_CONFIG(CONFIG_APP_AUDIO_I2S_PORT, I2S_ROLE_MASTER);
    channel_config.auto_clear = true;
    channel_config.dma_desc_num = 8;
    channel_config.dma_frame_num = 96;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel_config, NULL, &s_i2s_rx), TAG, "create I2S RX channel");

    i2s_std_config_t stream_config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(16, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = CONFIG_APP_AUDIO_I2S_MCLK_PIN,
            .bclk = CONFIG_APP_AUDIO_I2S_BCLK_PIN,
            .ws = CONFIG_APP_AUDIO_I2S_WS_PIN,
            .dout = I2S_GPIO_UNUSED,
            .din = CONFIG_APP_AUDIO_I2S_DIN_PIN,
        },
    };
    stream_config.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_i2s_rx, &stream_config), TAG, "configure I2S RX channel");
    return i2s_channel_enable(s_i2s_rx);
}

static esp_err_t read_self_test_samples(int16_t *samples, uint32_t sample_count)
{
    const uint32_t discard_count = 512;
    int16_t discard[discard_count];
    ESP_RETURN_ON_FALSE(esp_codec_dev_read(s_microphone, discard, sizeof(discard)) == ESP_CODEC_DEV_OK,
                        ESP_FAIL, TAG, "discard microphone startup samples");
    ESP_RETURN_ON_FALSE(esp_codec_dev_read(s_microphone, samples, sample_count * sizeof(*samples)) == ESP_CODEC_DEV_OK,
                        ESP_FAIL, TAG, "read microphone self-test samples");
    return ESP_OK;
}

static esp_err_t run_microphone_self_test(void)
{
    const uint32_t sample_count = 1600;
    int16_t *samples = heap_caps_malloc(sample_count * sizeof(*samples), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    ESP_RETURN_ON_FALSE(samples != NULL, ESP_ERR_NO_MEM, TAG, "allocate microphone self-test buffer");

    const esp_err_t read_status = read_self_test_samples(samples, sample_count);
    if (read_status != ESP_OK) {
        heap_caps_free(samples);
        return read_status;
    }

    int16_t minimum = INT16_MAX;
    int16_t maximum = INT16_MIN;
    int64_t sum = 0;
    uint32_t clipped = 0;
    for (uint32_t i = 0; i < sample_count; i++) {
        if (samples[i] < minimum) minimum = samples[i];
        if (samples[i] > maximum) maximum = samples[i];
        if (samples[i] == INT16_MIN || samples[i] == INT16_MAX) clipped++;
        sum += samples[i];
    }

    const int32_t mean = (int32_t)(sum / sample_count);
    uint32_t ac_peak = 0;
    uint64_t square_sum = 0;
    for (uint32_t i = 0; i < sample_count; i++) {
        const int32_t centered = (int32_t)samples[i] - mean;
        const uint32_t amplitude = centered < 0 ? (uint32_t)-centered : (uint32_t)centered;
        if (amplitude > ac_peak) ac_peak = amplitude;
        square_sum += (uint64_t)((int64_t)centered * centered);
    }
    heap_caps_free(samples);

    const uint32_t ac_rms = (uint32_t)sqrt((double)square_sum / sample_count);
    ESP_LOGI(TAG, "Microphone self-test: samples=%u min=%d max=%d mean=%d ac_peak=%u ac_rms=%u clipped=%u",
             (unsigned)sample_count, minimum, maximum, (int)mean,
             (unsigned)ac_peak, (unsigned)ac_rms, (unsigned)clipped);
    ESP_RETURN_ON_FALSE(ac_peak >= 32 && ac_rms >= 8, ESP_ERR_INVALID_RESPONSE, TAG,
                        "microphone self-test detected silence or a constant signal");
    ESP_RETURN_ON_FALSE(clipped <= sample_count / 100, ESP_ERR_INVALID_RESPONSE, TAG,
                        "microphone self-test detected excessive clipping");
    return ESP_OK;
}

static esp_err_t init_codec(i2c_master_bus_handle_t i2c_bus)
{
    ESP_RETURN_ON_FALSE(i2c_bus != NULL, ESP_ERR_INVALID_ARG, TAG, "audio I2C bus is unavailable");
    ESP_RETURN_ON_FALSE(CONFIG_APP_AUDIO_I2S_MCLK_PIN >= 0 && CONFIG_APP_AUDIO_I2S_BCLK_PIN >= 0
                        && CONFIG_APP_AUDIO_I2S_WS_PIN >= 0 && CONFIG_APP_AUDIO_I2S_DIN_PIN >= 0,
                        ESP_ERR_INVALID_STATE, TAG, "audio I2S pins are not configured");
    ESP_RETURN_ON_ERROR(init_i2s(), TAG, "initialize microphone I2S bus");

    audio_codec_i2s_cfg_t data_config = {
        .port = CONFIG_APP_AUDIO_I2S_PORT,
        .rx_handle = s_i2s_rx,
    };
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&data_config);

    audio_codec_i2c_cfg_t control_config = {
        .port = CONFIG_APP_CAMERA_SCCB_I2C_PORT,
        .addr = ES8311_CODEC_DEFAULT_ADDR,
        .bus_handle = i2c_bus,
    };
    const audio_codec_ctrl_if_t *control_if = audio_codec_new_i2c_ctrl(&control_config);
    const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();
    ESP_RETURN_ON_FALSE(data_if && control_if && gpio_if, ESP_ERR_NO_MEM, TAG, "create codec interfaces");

    es8311_codec_cfg_t codec_config = {
        .ctrl_if = control_if,
        .gpio_if = gpio_if,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_ADC,
        .pa_pin = -1,
        .master_mode = false,
        .use_mclk = true,
        .digital_mic = false,
    };
    const audio_codec_if_t *codec_if = es8311_codec_new(&codec_config);
    ESP_RETURN_ON_FALSE(codec_if != NULL, ESP_ERR_NO_MEM, TAG, "create ES8311 codec");

    esp_codec_dev_cfg_t device_config = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    s_microphone = esp_codec_dev_new(&device_config);
    ESP_RETURN_ON_FALSE(s_microphone != NULL, ESP_ERR_NO_MEM, TAG, "create microphone device");

    esp_codec_dev_sample_info_t format = {
        .sample_rate = 16000,
        .channel = 1,
        .channel_mask = 0x01,
        .bits_per_sample = 16,
    };
    ESP_RETURN_ON_FALSE(esp_codec_dev_open(s_microphone, &format) == ESP_CODEC_DEV_OK, ESP_FAIL, TAG, "open microphone device");
    ESP_RETURN_ON_FALSE(esp_codec_dev_set_in_gain(s_microphone, CONFIG_APP_AUDIO_INPUT_GAIN_DB) == ESP_CODEC_DEV_OK,
                        ESP_FAIL, TAG, "set microphone gain");
    return run_microphone_self_test();
}

esp_err_t p4_usb_microphone_init(i2c_master_bus_handle_t i2c_bus)
{
    const esp_err_t codec_status = init_codec(i2c_bus);
    if (codec_status != ESP_OK) {
        ESP_LOGW(TAG, "ES8311 capture unavailable; USB microphone will stream silence: %s", esp_err_to_name(codec_status));
    }

    uac_device_config_t config = {
        .skip_tinyusb_init = true,
        .input_cb = microphone_input,
        .mic_itf_num = 3,
        .spk_itf_num = -1,
    };
    ESP_RETURN_ON_ERROR(uac_device_init(&config), TAG, "initialize USB Audio Class microphone");
    ESP_LOGI(TAG, "USB microphone ready: signed 16-bit mono PCM at 16 kHz");
    return ESP_OK;
}
