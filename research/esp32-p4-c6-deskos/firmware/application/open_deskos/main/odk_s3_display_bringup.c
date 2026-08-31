/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Waveshare ESP32-S3 Touch LCD 2.8 bring-up. Pin map and controller choices
 * follow xiaozhi-esp32-2.2.6 and the existing pulse-esp IDF driver.
 */
#include "odk_s3_display_bringup.h"

#include <stdlib.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_heap_caps.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_st7789.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "odk_s3_disp";

#define S3_WIDTH 240
#define S3_HEIGHT 320
#define S3_SPI_HOST SPI2_HOST
#define S3_SPI_MOSI GPIO_NUM_45
#define S3_SPI_SCLK GPIO_NUM_40
#define S3_LCD_CS GPIO_NUM_42
#define S3_LCD_DC GPIO_NUM_41
#define S3_LCD_RST GPIO_NUM_39
#define S3_LCD_BL GPIO_NUM_5
#define S3_LCD_PWR GPIO_NUM_7
#define S3_LCD_PWR_KEY GPIO_NUM_6
#define S3_BL_LEDC_CHANNEL LEDC_CHANNEL_1
#define S3_BL_LEDC_TIMER LEDC_TIMER_0
#define S3_BL_LEDC_MODE LEDC_LOW_SPEED_MODE
#define S3_BL_LEDC_FREQ_HZ 20000
#define S3_BL_LEDC_RESOLUTION LEDC_TIMER_10_BIT
#define S3_TOUCH_SDA GPIO_NUM_1
#define S3_TOUCH_SCL GPIO_NUM_3
#define S3_TOUCH_INT GPIO_NUM_4
#define S3_TOUCH_RST GPIO_NUM_2
#define S3_TOUCH_ADDR 0x1A

static esp_lcd_panel_handle_t s_panel;
static esp_lcd_panel_io_handle_t s_panel_io;
static i2c_master_bus_handle_t s_i2c;
static esp_lcd_touch_handle_t s_touch;

static esp_err_t init_panel_power(void)
{
    const gpio_config_t key_cfg = {
        .pin_bit_mask = 1ULL << S3_LCD_PWR_KEY,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&key_cfg), TAG, "panel power key gpio");

    const gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << S3_LCD_PWR,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&cfg), TAG, "panel power gpio");
    ESP_RETURN_ON_ERROR(gpio_set_level(S3_LCD_PWR, 0), TAG, "panel power off");
    vTaskDelay(pdMS_TO_TICKS(100));
    /* Match the vendor demo: GPIO7 is latched high only when the physical
     * power key on GPIO6 is held during startup. */
    if (gpio_get_level(S3_LCD_PWR_KEY) == 0) {
        ESP_RETURN_ON_ERROR(gpio_set_level(S3_LCD_PWR, 1), TAG, "panel power on");
    }
    return ESP_OK;
}

static esp_err_t init_backlight(void)
{
    const ledc_timer_config_t timer_cfg = {
        .speed_mode = S3_BL_LEDC_MODE,
        .duty_resolution = S3_BL_LEDC_RESOLUTION,
        .timer_num = S3_BL_LEDC_TIMER,
        .freq_hz = S3_BL_LEDC_FREQ_HZ,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer_cfg), TAG, "backlight timer");

    const ledc_channel_config_t channel_cfg = {
        .gpio_num = S3_LCD_BL,
        .speed_mode = S3_BL_LEDC_MODE,
        .channel = S3_BL_LEDC_CHANNEL,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = S3_BL_LEDC_TIMER,
        .duty = 500,
        .hpoint = 0,
        .flags.output_invert = 0,
    };
    ESP_RETURN_ON_ERROR(ledc_channel_config(&channel_cfg), TAG, "backlight channel");
    ESP_RETURN_ON_ERROR(ledc_set_duty(S3_BL_LEDC_MODE, S3_BL_LEDC_CHANNEL, 500), TAG,
                        "backlight duty");
    return ledc_update_duty(S3_BL_LEDC_MODE, S3_BL_LEDC_CHANNEL);
}

esp_err_t odk_s3_display_bringup(void)
{
    if (s_panel != NULL) {
        return ESP_OK;
    }

    ESP_RETURN_ON_ERROR(init_panel_power(), TAG, "panel power");

    const spi_bus_config_t bus_cfg = {
        .mosi_io_num = S3_SPI_MOSI,
        .miso_io_num = GPIO_NUM_NC,
        .sclk_io_num = S3_SPI_SCLK,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = S3_WIDTH * S3_HEIGHT * 2,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(S3_SPI_HOST, &bus_cfg, SPI_DMA_CH_AUTO), TAG, "spi bus");

    const esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = S3_LCD_CS,
        .dc_gpio_num = S3_LCD_DC,
        .spi_mode = 0,
        .pclk_hz = 80000000,
        .trans_queue_depth = 4,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(S3_SPI_HOST, &io_cfg, &s_panel_io), TAG, "panel io");

    gpio_set_direction(S3_LCD_RST, GPIO_MODE_OUTPUT);
    gpio_set_level(S3_LCD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(50));
    gpio_set_level(S3_LCD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));

    const esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = GPIO_NUM_NC,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(s_panel_io, &panel_cfg, &s_panel), TAG, "st7789");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "panel init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(s_panel, false, false), TAG, "panel mirror");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(s_panel, false), TAG, "panel swap xy");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(s_panel, true), TAG, "panel invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(s_panel, true), TAG, "panel on");
    static uint8_t *black_buf;
    const size_t black_bytes = S3_WIDTH * 40 * 2;
    black_buf = heap_caps_calloc(1, black_bytes, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_RETURN_ON_FALSE(black_buf != NULL, ESP_ERR_NO_MEM, TAG, "black buffer");
    for (int y = 0; y < S3_HEIGHT; y += 40) {
        int y2 = y + 40;
        if (y2 > S3_HEIGHT) {
            y2 = S3_HEIGHT;
        }
        ESP_RETURN_ON_ERROR(esp_lcd_panel_draw_bitmap(s_panel, 0, y, S3_WIDTH, y2, black_buf),
                            TAG, "black fill");
        vTaskDelay(pdMS_TO_TICKS(3));
    }
    free(black_buf);
    ESP_RETURN_ON_ERROR(init_backlight(), TAG, "backlight");
    ESP_LOGI(TAG, "panel power/backlight: GPIO6=%d GPIO7=%d GPIO5=LEDC duty 500/1023",
             gpio_get_level(S3_LCD_PWR_KEY), gpio_get_level(S3_LCD_PWR));
    ESP_LOGI(TAG, "ST7789 ready: %dx%d SPI2", S3_WIDTH, S3_HEIGHT);
    return ESP_OK;
}

/* The CST328 has no esp_lcd_touch component in the current dependency graph.
 * Keep the touch object compatible with lua_module_lvgl by implementing the
 * standard esp_lcd_touch interface around its native 16-bit register protocol.
 */
typedef struct {
    esp_lcd_touch_t base;
    esp_lcd_panel_io_handle_t io;
    i2c_master_dev_handle_t dev;
} s3_touch_t;

static esp_err_t cst328_read(s3_touch_t *touch, uint16_t reg, uint8_t *buf, size_t len)
{
    const uint8_t reg_buf[2] = {(uint8_t)(reg >> 8), (uint8_t)reg};
    return i2c_master_transmit_receive(touch->dev, reg_buf, sizeof(reg_buf), buf, len, 50);
}

static esp_err_t cst328_write(s3_touch_t *touch, uint16_t reg, const uint8_t *buf, size_t len)
{
    uint8_t out[3] = {(uint8_t)(reg >> 8), (uint8_t)reg, 0};
    if (len > 1) {
        return ESP_ERR_INVALID_SIZE;
    }
    if (len > 0) {
        out[2] = buf[0];
    }
    return i2c_master_transmit(touch->dev, out, 2 + len, 50);
}

static esp_err_t s3_touch_read_data(esp_lcd_touch_handle_t tp)
{
    s3_touch_t *touch = (s3_touch_t *)tp;
    uint8_t count_buf[1] = {0};
    uint8_t points_buf[27] = {0};
    uint8_t clear = 0;
    if (cst328_read(touch, 0xD005, count_buf, sizeof(count_buf)) != ESP_OK) {
        return ESP_FAIL;
    }
    const uint8_t points = count_buf[0] & 0x0F;
    touch->base.data.points = points > 1 ? 1 : points;
    if (touch->base.data.points > 0 && cst328_read(touch, 0xD000, points_buf, sizeof(points_buf)) != ESP_OK) {
        return ESP_FAIL;
    }
    if (touch->base.data.points > 0) {
        touch->base.data.coords[0].x = ((uint16_t)points_buf[1] << 4) | ((points_buf[3] & 0xF0) >> 4);
        touch->base.data.coords[0].y = ((uint16_t)points_buf[2] << 4) | (points_buf[3] & 0x0F);
    }
    return cst328_write(touch, 0xD005, &clear, sizeof(clear));
}

static bool s3_touch_get_xy(esp_lcd_touch_handle_t tp, uint16_t *x, uint16_t *y,
                            uint16_t *strength, uint8_t *point_num, uint8_t max_point_num)
{
    if (max_point_num == 0 || point_num == NULL) {
        return false;
    }
    s3_touch_t *touch = (s3_touch_t *)tp;
    *point_num = touch->base.data.points;
    if (*point_num == 0) {
        return false;
    }
    x[0] = touch->base.data.coords[0].x;
    y[0] = touch->base.data.coords[0].y;
    if (strength != NULL) {
        strength[0] = touch->base.data.coords[0].strength;
    }
    return true;
}

static esp_err_t s3_touch_del(esp_lcd_touch_handle_t tp)
{
    free(tp);
    return ESP_OK;
}

esp_err_t odk_s3_touch_bringup(void)
{
    if (s_touch != NULL) {
        return ESP_OK;
    }

    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_1,
        .sda_io_num = S3_TOUCH_SDA,
        .scl_io_num = S3_TOUCH_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_i2c), TAG, "touch i2c bus");

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = S3_TOUCH_ADDR,
        .scl_speed_hz = 400000,
    };
    s3_touch_t *touch = calloc(1, sizeof(*touch));
    ESP_RETURN_ON_FALSE(touch != NULL, ESP_ERR_NO_MEM, TAG, "touch alloc");
    esp_err_t err = i2c_master_bus_add_device(s_i2c, &dev_cfg, &touch->dev);
    if (err != ESP_OK) {
        free(touch);
        return err;
    }

    gpio_set_direction(S3_TOUCH_RST, GPIO_MODE_OUTPUT);
    gpio_set_level(S3_TOUCH_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(5));
    gpio_set_level(S3_TOUCH_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));

    touch->base.read_data = s3_touch_read_data;
    touch->base.get_xy = s3_touch_get_xy;
    touch->base.del = s3_touch_del;
    touch->base.config.x_max = S3_WIDTH;
    touch->base.config.y_max = S3_HEIGHT;
    touch->base.config.rst_gpio_num = S3_TOUCH_RST;
    touch->base.config.int_gpio_num = S3_TOUCH_INT;
    touch->base.io = NULL;
    s_touch = &touch->base;
    ESP_LOGI(TAG, "CST328 ready: I2C1 SDA=%d SCL=%d addr=0x%02x", S3_TOUCH_SDA, S3_TOUCH_SCL, S3_TOUCH_ADDR);
    return ESP_OK;
}

esp_lcd_panel_handle_t odk_s3_display_get_panel(void)
{
    return s_panel;
}

esp_lcd_panel_io_handle_t odk_s3_display_get_io(void)
{
    return s_panel_io;
}

esp_lcd_touch_handle_t odk_s3_touch_get_handle(void)
{
    return s_touch;
}

void odk_s3_display_get_size(int *width, int *height)
{
    if (width != NULL) {
        *width = S3_WIDTH;
    }
    if (height != NULL) {
        *height = S3_HEIGHT;
    }
}
