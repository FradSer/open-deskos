/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_vendor.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int busy_gpio_num;
    int reset_gpio_num;
    uint16_t width;
    uint16_t height;
} esp_lcd_m5paper_epd_config_t;

/**
 * @brief Create a new M5PaperColor ED2208 E-Paper LCD panel
 *
 * @param[in] io LCD panel IO handle
 * @param[in] epd_conf EPD configuration structure
 * @param[out] ret_panel Returned LCD panel handle
 * @return esp_err_t ESP_OK on success, or error code
 */
esp_err_t esp_lcd_new_panel_m5paper_epd(esp_lcd_panel_io_handle_t io,
                                        const esp_lcd_m5paper_epd_config_t *epd_conf,
                                        esp_lcd_panel_handle_t *ret_panel);

#ifdef __cplusplus
}
#endif
