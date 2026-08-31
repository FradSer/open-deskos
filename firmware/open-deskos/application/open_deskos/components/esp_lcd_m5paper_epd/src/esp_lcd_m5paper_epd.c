/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */
#include "esp_lcd_m5paper_epd.h"

#include <stdlib.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_interface.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "esp_lcd_m5epd";

#define EPD_COLOR_BLACK  0x0
#define EPD_COLOR_WHITE  0x1
#define EPD_COLOR_YELLOW 0x2
#define EPD_COLOR_RED    0x3
#define EPD_COLOR_BLUE   0x5
#define EPD_COLOR_GREEN  0x6

typedef struct {
    esp_lcd_panel_t base;
    esp_lcd_panel_io_handle_t io;
    int busy_gpio_num;
    int reset_gpio_num;
    uint16_t width;
    uint16_t height;
    uint8_t *frame_buffer;
    uint8_t *tx_buffer;
    SemaphoreHandle_t frame_mutex;
    volatile bool dirty;
    volatile bool refreshing;
    TaskHandle_t refresh_task;
} m5paper_epd_panel_t;

static const uint8_t s_init_cmds[] = {
    0xAA, 6, 0x49, 0x55, 0x20, 0x08, 0x09, 0x18, // CMDH
    0x01, 1, 0x3F,
    0x00, 2, 0x5F, 0x69,
    0x05, 4, 0x40, 0x1F, 0x1F, 0x2C,
    0x08, 4, 0x6F, 0x1F, 0x1F, 0x22,
    0x06, 4, 0x6F, 0x1F, 0x17, 0x17,
    0x03, 4, 0x03, 0x54, 0x00, 0x44,
    0x60, 2, 0x02, 0x00,
    0x30, 1, 0x08,
    0x50, 1, 0x3F,
    0xE3, 1, 0x2F,
    0x84, 1, 0x01,
};

static bool m5paper_epd_wait_busy(m5paper_epd_panel_t *epd, uint32_t timeout_ms)
{
    if (epd->busy_gpio_num < 0) {
        return true;
    }
    TickType_t start = xTaskGetTickCount();
    TickType_t timeout_ticks = pdMS_TO_TICKS(timeout_ms);
    while (gpio_get_level(epd->busy_gpio_num) == 0) {
        if ((xTaskGetTickCount() - start) > timeout_ticks) {
            ESP_LOGW(TAG, "BUSY timeout (%lu ms)", (unsigned long)timeout_ms);
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    return true;
}

static esp_err_t m5paper_epd_reset(esp_lcd_panel_t *panel)
{
    m5paper_epd_panel_t *epd = __containerof(panel, m5paper_epd_panel_t, base);
    if (epd->reset_gpio_num >= 0) {
        gpio_set_level(epd->reset_gpio_num, 0);
        vTaskDelay(pdMS_TO_TICKS(20));
        gpio_set_level(epd->reset_gpio_num, 1);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    return ESP_OK;
}

static esp_err_t m5paper_epd_init(esp_lcd_panel_t *panel)
{
    m5paper_epd_panel_t *epd = __containerof(panel, m5paper_epd_panel_t, base);

    if (epd->busy_gpio_num >= 0) {
        const gpio_config_t busy_cfg = {
            .pin_bit_mask = 1ULL << epd->busy_gpio_num,
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_ENABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        gpio_config(&busy_cfg);
    }
    if (epd->reset_gpio_num >= 0) {
        const gpio_config_t rst_cfg = {
            .pin_bit_mask = 1ULL << epd->reset_gpio_num,
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        gpio_config(&rst_cfg);
    }

    m5paper_epd_reset(panel);

    size_t idx = 0;
    while (idx < sizeof(s_init_cmds)) {
        uint8_t cmd = s_init_cmds[idx++];
        uint8_t len = s_init_cmds[idx++];
        const uint8_t *data = &s_init_cmds[idx];
        idx += len;

        m5paper_epd_wait_busy(epd, 5000);
        esp_lcd_panel_io_tx_param(epd->io, cmd, data, len);
    }

    m5paper_epd_wait_busy(epd, 5000);
    const uint8_t res_data[4] = {
        (uint8_t)((epd->width >> 8) & 0xFF),
        (uint8_t)(epd->width & 0xFF),
        (uint8_t)((epd->height >> 8) & 0xFF),
        (uint8_t)(epd->height & 0xFF),
    };
    esp_lcd_panel_io_tx_param(epd->io, 0x61, res_data, sizeof(res_data));
    return ESP_OK;
}

static inline uint8_t rgb_to_epd_color(int32_t r, int32_t g, int32_t b)
{
    int32_t max_c = r > g ? (r > b ? r : b) : (g > b ? g : b);
    int32_t min_c = r < g ? (r < b ? r : b) : (g < b ? g : b);

    // Grayscale: invert for reflective e-paper (dark AIODI background -> White Paper, bright text -> Black Ink)
    if (max_c - min_c < 32) {
        int32_t lum = (r * 77 + g * 150 + b * 29) >> 8;
        return (lum > 70) ? EPD_COLOR_BLACK : EPD_COLOR_WHITE;
    }

    // Color pigments
    static const struct { uint8_t r, g, b, idx; } pal[] = {
        { 255, 243,  56, EPD_COLOR_YELLOW },
        { 191,   0,   0, EPD_COLOR_RED },
        { 100,  64, 255, EPD_COLOR_BLUE },
        {  67, 138,  28, EPD_COLOR_GREEN },
    };
    uint32_t min_dist = UINT32_MAX;
    uint8_t best = EPD_COLOR_WHITE;
    for (size_t i = 0; i < 4; i++) {
        int32_t dr = r - pal[i].r;
        int32_t dg = g - pal[i].g;
        int32_t db = b - pal[i].b;
        uint32_t dist = dr * dr + dg * dg + db * db;
        if (dist < min_dist) {
            min_dist = dist;
            best = pal[i].idx;
        }
    }
    return best;
}

static void m5paper_refresh_task(void *arg)
{
    m5paper_epd_panel_t *epd = (m5paper_epd_panel_t *)arg;

    while (1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        // Debounce: wait for continuous UI drawing to settle. The initial
        // launcher also pre-renders page snapshots, so allow that work to
        // finish before capturing the frame for physical refresh.
        while (1) {
            vTaskDelay(pdMS_TO_TICKS(3000));
            if (ulTaskNotifyTake(pdTRUE, 0) > 0) {
                continue;
            }
            break;
        }

        if (!epd->dirty) {
            continue;
        }

        epd->refreshing = true;
        epd->dirty = false;

        ESP_LOGI(TAG, "Starting physical EPD refresh (400x600)...");
        m5paper_epd_wait_busy(epd, 5000);

        // Snapshot the render buffer before starting the controller transfer.
        size_t total_bytes = ((size_t)epd->width / 2) * epd->height;
        if (xSemaphoreTake(epd->frame_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
            epd->refreshing = false;
            epd->dirty = true;
            continue;
        }
        memcpy(epd->tx_buffer, epd->frame_buffer, total_bytes);
        xSemaphoreGive(epd->frame_mutex);

        // Keep CS asserted for DATA_START and the complete frame. The SPI
        // panel IO performs any transfer-size splitting internally.
        esp_lcd_panel_io_tx_color(epd->io, 0x10, epd->tx_buffer, total_bytes);
        esp_lcd_panel_io_tx_param(epd->io, 0x04, NULL, 0); // POWER ON
        m5paper_epd_wait_busy(epd, 5000);
        vTaskDelay(pdMS_TO_TICKS(200));

        const uint8_t boost_data[4] = {0x6F, 0x1F, 0x17, 0x27};
        esp_lcd_panel_io_tx_param(epd->io, 0x06, boost_data, sizeof(boost_data));
        vTaskDelay(pdMS_TO_TICKS(200));

        const uint8_t refr_data[1] = {0x00};
        esp_lcd_panel_io_tx_param(epd->io, 0x12, refr_data, sizeof(refr_data)); // REFRESH
        m5paper_epd_wait_busy(epd, 25000);

        const uint8_t pwr_off_data[1] = {0x00};
        esp_lcd_panel_io_tx_param(epd->io, 0x02, pwr_off_data, sizeof(pwr_off_data)); // POWER OFF
        m5paper_epd_wait_busy(epd, 5000);
        vTaskDelay(pdMS_TO_TICKS(200));

        epd->refreshing = false;
        ESP_LOGI(TAG, "Physical EPD refresh complete.");
        continue;


    }
}

static esp_err_t m5paper_epd_draw_bitmap(esp_lcd_panel_t *panel, int x_start, int y_start,
                                         int x_end, int y_end, const void *color_data)
{
    m5paper_epd_panel_t *epd = __containerof(panel, m5paper_epd_panel_t, base);
    const uint16_t *src = (const uint16_t *)color_data;
    int bw = x_end - x_start;
    int bh = y_end - y_start;
    if (bw <= 0 || bh <= 0 || !epd->frame_buffer) {
        return ESP_OK;
    }

    int row_bytes = epd->width / 2;
    if (xSemaphoreTake(epd->frame_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    for (int y = 0; y < bh; y++) {
        int dst_y = y_start + y;
        if (dst_y >= epd->height) {
            break;
        }
        for (int x = 0; x < bw; x++) {
            int dst_x = x_start + x;
            if (dst_x >= epd->width) {
                break;
            }

            // LVGL omits the IO handle for this synchronous panel, so the
            // source remains in native RGB565 byte order.
            uint16_t raw = src[y * bw + x];
            uint32_t r5 = (raw >> 11) & 0x1F;
            uint32_t g6 = (raw >> 5) & 0x3F;
            uint32_t b5 = raw & 0x1F;
            uint8_t r = (r5 * 527 + 23) >> 6;
            uint8_t g = (g6 * 259 + 33) >> 6;
            uint8_t b = (b5 * 527 + 23) >> 6;

            uint8_t epd_c = rgb_to_epd_color(r, g, b);

            int byte_idx = dst_y * row_bytes + (dst_x / 2);
            if (dst_x % 2 == 0) {
                epd->frame_buffer[byte_idx] = (epd->frame_buffer[byte_idx] & 0x0F) | (epd_c << 4);
            } else {
                epd->frame_buffer[byte_idx] = (epd->frame_buffer[byte_idx] & 0xF0) | (epd_c & 0x0F);
            }
        }
    }

    xSemaphoreGive(epd->frame_mutex);
    epd->dirty = true;
    if (epd->refresh_task) {
        xTaskNotifyGive(epd->refresh_task);
    }

    return ESP_OK;
}

static esp_err_t m5paper_epd_invert_color(esp_lcd_panel_t *panel, bool invert_color_data)
{
    return ESP_OK;
}

static esp_err_t m5paper_epd_mirror(esp_lcd_panel_t *panel, bool mirror_x, bool mirror_y)
{
    return ESP_OK;
}

static esp_err_t m5paper_epd_swap_xy(esp_lcd_panel_t *panel, bool swap_axes)
{
    return ESP_OK;
}

static esp_err_t m5paper_epd_set_gap(esp_lcd_panel_t *panel, int x_gap, int y_gap)
{
    return ESP_OK;
}

static esp_err_t m5paper_epd_disp_on_off(esp_lcd_panel_t *panel, bool on_off)
{
    return ESP_OK;
}

static esp_err_t m5paper_epd_del(esp_lcd_panel_t *panel)
{
    m5paper_epd_panel_t *epd = __containerof(panel, m5paper_epd_panel_t, base);
    if (epd->refresh_task) {
        vTaskDelete(epd->refresh_task);
    }
    if (epd->frame_mutex) {
        vSemaphoreDelete(epd->frame_mutex);
    }
    if (epd->tx_buffer) {
        free(epd->tx_buffer);
    }
    if (epd->frame_buffer) {
        free(epd->frame_buffer);
    }
    free(epd);
    return ESP_OK;
}

esp_err_t esp_lcd_new_panel_m5paper_epd(esp_lcd_panel_io_handle_t io,
                                        const esp_lcd_m5paper_epd_config_t *epd_conf,
                                        esp_lcd_panel_handle_t *ret_panel)
{
    ESP_RETURN_ON_FALSE(io && epd_conf && ret_panel, ESP_ERR_INVALID_ARG, TAG, "invalid argument");

    m5paper_epd_panel_t *epd = calloc(1, sizeof(m5paper_epd_panel_t));
    ESP_RETURN_ON_FALSE(epd, ESP_ERR_NO_MEM, TAG, "no mem for panel");

    epd->io = io;
    epd->busy_gpio_num = epd_conf->busy_gpio_num;
    epd->reset_gpio_num = epd_conf->reset_gpio_num;
    epd->width = epd_conf->width;
    epd->height = epd_conf->height;

    size_t frame_bytes = ((size_t)epd->width / 2) * epd->height;
    epd->frame_buffer = heap_caps_malloc(frame_bytes, MALLOC_CAP_DMA | MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!epd->frame_buffer) {
        epd->frame_buffer = malloc(frame_bytes);
    }
    if (!epd->frame_buffer) {
        free(epd);
        return ESP_ERR_NO_MEM;
    }
    epd->tx_buffer = heap_caps_malloc(frame_bytes, MALLOC_CAP_DMA | MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!epd->tx_buffer) {
        epd->tx_buffer = malloc(frame_bytes);
    }
    if (!epd->tx_buffer) {
        free(epd->frame_buffer);
        free(epd);
        return ESP_ERR_NO_MEM;
    }
    epd->frame_mutex = xSemaphoreCreateMutex();
    if (!epd->frame_mutex) {
        free(epd->tx_buffer);
        free(epd->frame_buffer);
        free(epd);
        return ESP_ERR_NO_MEM;
    }
    memset(epd->frame_buffer, 0x11, frame_bytes); // 0x11 = White Paper
    memset(epd->tx_buffer, 0x11, frame_bytes);

    epd->base.reset = m5paper_epd_reset;
    epd->base.init = m5paper_epd_init;
    epd->base.draw_bitmap = m5paper_epd_draw_bitmap;
    epd->base.invert_color = m5paper_epd_invert_color;
    epd->base.mirror = m5paper_epd_mirror;
    epd->base.swap_xy = m5paper_epd_swap_xy;
    epd->base.set_gap = m5paper_epd_set_gap;
    epd->base.disp_on_off = m5paper_epd_disp_on_off;
    epd->base.del = m5paper_epd_del;

    xTaskCreatePinnedToCore(m5paper_refresh_task, "m5epd_refr", 8192, epd, 3, &epd->refresh_task, 1);

    *ret_panel = &epd->base;
    return ESP_OK;
}
