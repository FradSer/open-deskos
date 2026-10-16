/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * M5Stack PaperColor ESP32-S3 e-paper display bring-up.
 */
#include "odk_m5paper_display_bringup.h"

#include <stdlib.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_lcd_m5paper_epd.h"
#include "esp_lcd_panel_io.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "odk_m5paper_disp";

#define M5_I2C_SCL GPIO_NUM_2
#define M5_I2C_SDA GPIO_NUM_3
#define M5PM1_I2C_ADDR 0x6E

#define M5_SPI_HOST SPI2_HOST
#define M5_SPI_SCLK GPIO_NUM_15
#define M5_SPI_MOSI GPIO_NUM_13
#define M5_SPI_MISO GPIO_NUM_14
#define M5_LCD_DC GPIO_NUM_43
#define M5_LCD_CS GPIO_NUM_44
#define M5_LCD_RST GPIO_NUM_12
#define M5_LCD_BUSY GPIO_NUM_11
/* M5 docs: USER_KEY3/A = GPIO10 (left), USER_KEY2/B = GPIO9 (center),
 * USER_KEY1/C = GPIO1 (right). */
#define M5_BTN_LEFT GPIO_NUM_10
#define M5_BTN_CENTER GPIO_NUM_9
#define M5_BTN_RIGHT GPIO_NUM_1

static esp_lcd_panel_handle_t s_panel;
static esp_lcd_panel_io_handle_t s_panel_io;
static i2c_master_bus_handle_t s_i2c_bus;
static i2c_master_dev_handle_t s_pm1_dev;

static esp_err_t pm1_write_reg8(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t data[2] = {reg, val};
    return i2c_master_transmit(dev, data, 2, 100);
}

static esp_err_t pm1_read_reg8(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *val)
{
    return i2c_master_transmit_receive(dev, &reg, 1, val, 1, 100);
}

static esp_err_t pm1_bit_on(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t mask)
{
    uint8_t val = 0;
    pm1_read_reg8(dev, reg, &val);
    val |= mask;
    return pm1_write_reg8(dev, reg, val);
}

static esp_err_t pm1_bit_off(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t mask)
{
    uint8_t val = 0;
    pm1_read_reg8(dev, reg, &val);
    val &= ~mask;
    return pm1_write_reg8(dev, reg, val);
}

static esp_err_t init_m5pm1(void)
{
    const i2c_master_bus_config_t i2c_bus_cfg = {
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .i2c_port = 1,
        .scl_io_num = M5_I2C_SCL,
        .sda_io_num = M5_I2C_SDA,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&i2c_bus_cfg, &s_i2c_bus);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "I2C bus init: %s", esp_err_to_name(err));
        return err;
    }

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = M5PM1_I2C_ADDR,
        .scl_speed_hz = 100000,
    };
    err = i2c_master_bus_add_device(s_i2c_bus, &dev_cfg, &s_pm1_dev);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "PMIC dev add: %s", esp_err_to_name(err));
        return err;
    }

    // Disable PMIC watchdog & sleep
    pm1_write_reg8(s_pm1_dev, 0x0A, 0x00);
    pm1_write_reg8(s_pm1_dev, 0x09, 0x00);

    // EPD Power Enable on PM1 GPIO0
    pm1_bit_off(s_pm1_dev, 0x16, 0x03);
    pm1_bit_on(s_pm1_dev, 0x10, 0x01);
    pm1_bit_off(s_pm1_dev, 0x13, 0x01);
    pm1_bit_on(s_pm1_dev, 0x11, 0x01);

    // Mirror the vendor demo's M5PM1 charge and boost enables (PWR_CFG 0x06).
    pm1_bit_on(s_pm1_dev, 0x06, (1U << 0) | (1U << 3));

    vTaskDelay(pdMS_TO_TICKS(50));
    ESP_LOGI(TAG, "M5PM1 initialized, EPD power rail enabled");
    return ESP_OK;
}

static void init_buttons(void)
{
    const gpio_config_t btn_cfg = {
        .pin_bit_mask = (1ULL << M5_BTN_CENTER) | (1ULL << M5_BTN_RIGHT) | (1ULL << M5_BTN_LEFT),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&btn_cfg);
}

esp_err_t odk_m5paper_display_bringup(void)
{
    if (s_panel != NULL) {
        return ESP_OK;
    }

    init_m5pm1();
    init_buttons();

    const spi_bus_config_t bus_cfg = {
        .mosi_io_num = M5_SPI_MOSI,
        // Keep the vendor wiring even in 3-wire mode; the controller uses
        // MOSI for data while GPIO14 remains reserved for the shared bus.
        .miso_io_num = M5_SPI_MISO,
        .sclk_io_num = M5_SPI_SCLK,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = 4096,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(M5_SPI_HOST, &bus_cfg, SPI_DMA_CH_AUTO), TAG, "spi bus");

    const esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = M5_LCD_CS,
        .dc_gpio_num = M5_LCD_DC,
        .spi_mode = 0,
        .pclk_hz = 4000000,
        .trans_queue_depth = 4,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .flags.sio_mode = 1,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(M5_SPI_HOST, &io_cfg, &s_panel_io), TAG, "panel io");

    const esp_lcd_m5paper_epd_config_t panel_cfg = {
        .busy_gpio_num = M5_LCD_BUSY,
        .reset_gpio_num = M5_LCD_RST,
        .width = ODK_M5PAPER_H_RES,
        .height = ODK_M5PAPER_V_RES,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_m5paper_epd(s_panel_io, &panel_cfg, &s_panel), TAG, "m5epd");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "panel init");

    ESP_LOGI(TAG, "M5PaperColor ED2208 ready: %dx%d SPI2", ODK_M5PAPER_H_RES, ODK_M5PAPER_V_RES);
    return ESP_OK;
}

esp_lcd_panel_handle_t odk_m5paper_display_get_panel(void)
{
    return s_panel;
}

esp_lcd_panel_io_handle_t odk_m5paper_display_get_io(void)
{
    return NULL;
}

esp_lcd_touch_handle_t odk_m5paper_touch_get_handle(void)
{
    return NULL;
}

void odk_m5paper_display_get_size(int *width, int *height)
{
    if (width != NULL) {
        *width = ODK_M5PAPER_H_RES;
    }
    if (height != NULL) {
        *height = ODK_M5PAPER_V_RES;
    }
}

int odk_m5paper_get_btn_left(void)
{
    return gpio_get_level(M5_BTN_LEFT) == 0;
}

int odk_m5paper_get_btn_center(void)
{
    return gpio_get_level(M5_BTN_CENTER) == 0;
}

int odk_m5paper_get_btn_right(void)
{
    return gpio_get_level(M5_BTN_RIGHT) == 0;
}
