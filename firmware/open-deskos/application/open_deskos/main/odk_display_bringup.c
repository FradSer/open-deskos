/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guition JC4880P443C direct display bring-up — bypasses the fork's
 * board_manager DSI path (which entangles with wifi/app_claw startup).
 *
 * Authoritative hardware reference (strict):
 *   https://github.com/csvke/esp32_p4_jc4880p433c_bsp
 *   (src/bsp_display.c, Kconfig defaults, WIFI_ARCHITECTURE.md)
 * Cross-check: pulse-esp hw_test_p4 (same ST7701S bring-up sequence).
 */
#include "esp_log.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_ldo_regulator.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_dev.h"
#include "esp_lcd_st7701.h"
#include "driver/ledc.h"
#include "soc/soc_caps.h"
#include "odk_display_bringup.h"

static const char *TAG = "odk_disp";
#define LCD_RST_GPIO     5
#define LCD_BL_GPIO      23

/* ST7701S init table — ESPHome guition.py sequence, verified on this board. */
#define CMD(c, ...) \
    { (c), (const uint8_t[]){__VA_ARGS__}, sizeof((const uint8_t[]){__VA_ARGS__}), 0 }
static const st7701_lcd_init_cmd_t s_init_cmds[] = {
    CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x13),
    CMD(0xEF, 0x08),
    CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x10),
    CMD(0xC0, 0x63, 0x00),
    CMD(0xC1, 0x0D, 0x02),
    CMD(0xC2, 0x10, 0x08),
    CMD(0xCC, 0x10),
    CMD(0xB0, 0x80, 0x09, 0x53, 0x0C, 0xD0, 0x07, 0x0C, 0x09, 0x09, 0x28, 0x06, 0xD4, 0x13, 0x69, 0x2B, 0x71),
    CMD(0xB1, 0x80, 0x94, 0x5A, 0x10, 0xD3, 0x06, 0x0A, 0x08, 0x08, 0x25, 0x03, 0xD3, 0x12, 0x66, 0x6A, 0x0D),
    CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x11),
    CMD(0xB0, 0x5D),
    CMD(0xB1, 0x58),
    CMD(0xB2, 0x87),
    CMD(0xB3, 0x80),
    CMD(0xB5, 0x4E),
    CMD(0xB7, 0x85),
    CMD(0xB8, 0x21),
    CMD(0xB9, 0x10, 0x1F),
    CMD(0xBB, 0x03),
    CMD(0xBC, 0x00),
    CMD(0xC1, 0x78),
    CMD(0xC2, 0x78),
    CMD(0xD0, 0x88),
    CMD(0xE0, 0x00, 0x3A, 0x02),
    CMD(0xE1, 0x04, 0xA0, 0x00, 0xA0, 0x05, 0xA0, 0x00, 0xA0, 0x00, 0x40, 0x40),
    CMD(0xE2, 0x30, 0x00, 0x40, 0x40, 0x32, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00),
    CMD(0xE3, 0x00, 0x00, 0x33, 0x33),
    CMD(0xE4, 0x44, 0x44),
    CMD(0xE5, 0x09, 0x2E, 0xA0, 0xA0, 0x0B, 0x30, 0xA0, 0xA0, 0x05, 0x2A, 0xA0, 0xA0, 0x07, 0x2C, 0xA0, 0xA0),
    CMD(0xE6, 0x00, 0x00, 0x33, 0x33),
    CMD(0xE7, 0x44, 0x44),
    CMD(0xE8, 0x08, 0x2D, 0xA0, 0xA0, 0x0A, 0x2F, 0xA0, 0xA0, 0x04, 0x29, 0xA0, 0xA0, 0x06, 0x2B, 0xA0, 0xA0),
    CMD(0xEB, 0x00, 0x00, 0x4E, 0x4E, 0x00, 0x00, 0x00),
    CMD(0xEC, 0x08, 0x01),
    CMD(0xED, 0xB0, 0x2B, 0x98, 0xA4, 0x56, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xF7, 0x65, 0x4A, 0x89, 0xB2, 0x0B),
    CMD(0xEF, 0x08, 0x08, 0x08, 0x45, 0x3F, 0x54),
    CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x00),
    { 0x11, NULL, 0, 120 },  /* SLPOUT + 120ms */
    { 0x29, NULL, 0, 20 },   /* DISPON + 20ms */
};
#undef CMD

static esp_lcd_panel_handle_t s_panel = NULL;

static void backlight_on(void)
{
    /* Match csvke BSP Kconfig defaults: timer 1 / channel 1 / 20 kHz / 10-bit. */
    ledc_timer_config_t tcfg = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_1,
        .freq_hz = 20000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ledc_timer_config(&tcfg);
    ledc_channel_config_t ccfg = {
        .gpio_num = LCD_BL_GPIO,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_1,
        .timer_sel = LEDC_TIMER_1,
        .duty = 1023,  /* 100% */
        .hpoint = 0,
    };
    ledc_channel_config(&ccfg);
    ESP_LOGI(TAG, "backlight ON (GPIO%d, LEDC 20kHz, csvke BSP)", LCD_BL_GPIO);
}

/* Direct ST7701S bring-up — drives the panel without board_manager.
 * Sequence aligned to csvke/esp32_p4_jc4880p433c_bsp src/bsp_display.c:
 * LDO ch3@2.5V, DSI 2-lane 500Mbps, 50ms PHY settle, DPI 34MHz RGB565
 * 480x800 (porches identical), ST7701 init table, disp_on, GPIO5 RST /
 * GPIO23 backlight. Returns the panel handle or NULL. */
esp_lcd_panel_handle_t odk_display_bringup(void)
{
    ESP_LOGI(TAG, "Open DeskOS display bring-up (ST7701 DSI, csvke JC4880 BSP)");

    /* MIPI DPHY power: internal LDO channel 3 @ 2.5V (BSP Kconfig default) */
    esp_ldo_channel_handle_t ldo = NULL;
    esp_ldo_channel_config_t ldo_cfg = { .chan_id = 3, .voltage_mv = 2500 };
    if (esp_ldo_acquire_channel(&ldo_cfg, &ldo) != ESP_OK) {
        ESP_LOGE(TAG, "MIPI DPHY LDO ch3 acquire failed");
        return NULL;
    }

    /* DSI bus: 2 lanes @ 500 Mbps */
    esp_lcd_dsi_bus_handle_t dsi_bus = NULL;
    esp_lcd_dsi_bus_config_t bus_cfg = {
        .bus_id = 0,
        .num_data_lanes = 2,
        .phy_clk_src = MIPI_DSI_PHY_CLK_SRC_DEFAULT,
        .lane_bit_rate_mbps = 500,
    };
    if (esp_lcd_new_dsi_bus(&bus_cfg, &dsi_bus) != ESP_OK) {
        ESP_LOGE(TAG, "esp_lcd_new_dsi_bus failed");
        return NULL;
    }
    /* Give PHY a moment to stabilize before DBI transfers (csvke BSP). */
    vTaskDelay(pdMS_TO_TICKS(50));

    esp_lcd_panel_io_handle_t dbi_io = NULL;
    esp_lcd_dbi_io_config_t dbi_cfg = {
        .virtual_channel = 0,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    if (esp_lcd_new_panel_io_dbi(dsi_bus, &dbi_cfg, &dbi_io) != ESP_OK) {
        ESP_LOGE(TAG, "esp_lcd_new_panel_io_dbi failed");
        return NULL;
    }

    /* DPI panel: 34 MHz, RGB565 in+out */
    static esp_lcd_dpi_panel_config_t dpi_cfg;
    dpi_cfg.virtual_channel = 0;
    dpi_cfg.dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT;
    dpi_cfg.dpi_clock_freq_mhz = 34;
    dpi_cfg.in_color_format = LCD_COLOR_FMT_RGB565;
    dpi_cfg.out_color_format = LCD_COLOR_FMT_RGB565;
    /* The snapshot pager changes most of the viewport every drag frame, so
     * its adapter route is TRIPLE_FULL: LVGL draws whole frames directly into
     * non-visible DPI buffers and the panel swaps only at the frame boundary.
     * 3 × 480 × 800 × 2 ≈ 2.3 MB PSRAM. */
    dpi_cfg.num_fbs = 3;
    dpi_cfg.video_timing.h_size = ODK_DISPLAY_H_RES;
    dpi_cfg.video_timing.v_size = ODK_DISPLAY_V_RES;
    dpi_cfg.video_timing.hsync_pulse_width = 12;
    dpi_cfg.video_timing.hsync_back_porch = 42;
    dpi_cfg.video_timing.hsync_front_porch = 42;
    dpi_cfg.video_timing.vsync_pulse_width = 2;
    dpi_cfg.video_timing.vsync_back_porch = 8;
    dpi_cfg.video_timing.vsync_front_porch = 166;

    st7701_vendor_config_t vendor_cfg = {0};
    vendor_cfg.init_cmds = s_init_cmds;
    vendor_cfg.init_cmds_size = sizeof(s_init_cmds) / sizeof(s_init_cmds[0]);
    vendor_cfg.mipi_config.dsi_bus = dsi_bus;
    vendor_cfg.mipi_config.dpi_config = &dpi_cfg;
    vendor_cfg.flags.use_mipi_interface = 1;

    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = LCD_RST_GPIO,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_cfg,
    };
    if (esp_lcd_new_panel_st7701(dbi_io, &panel_cfg, &s_panel) != ESP_OK) {
        ESP_LOGE(TAG, "esp_lcd_new_panel_st7701 failed");
        return NULL;
    }
    esp_lcd_panel_reset(s_panel);
    esp_lcd_panel_init(s_panel);
    /* Some ST7701 sequences need an explicit display-on (csvke BSP). */
    esp_lcd_panel_disp_on_off(s_panel, true);
#if SOC_DMA2D_SUPPORTED
    /* IDF 6: DMA2D is enabled via API (not dpi flags.use_dma2d). Speeds up
     * esp_lcd_panel_draw_bitmap used by LVGL flush. */
    if (esp_lcd_dpi_panel_enable_dma2d(s_panel) != ESP_OK) {
        ESP_LOGW(TAG, "DMA2D enable failed — falling back to CPU blit");
    } else {
        ESP_LOGI(TAG, "DPI DMA2D draw_bitmap enabled");
    }
#endif
    ESP_LOGI(TAG, "ST7701 panel init done (RST GPIO%d, 34MHz DPI ~60Hz, 3 FB triple-full, 500Mbps x2)",
             LCD_RST_GPIO);

    backlight_on();

    /* Full-screen solid fill via draw_bitmap: lights the panel AND exercises
     * the real CPU->PSRAM->DMA pixel path the UI will use (the driver does the
     * esp_cache_msync writeback internally). Mirrors the verified pulse-esp
     * hw_test_p4 Stage B, which is confirmed visible on this exact board. A
     * hardware pattern (set_pattern) is more robust against DMA starvation but
     * validates none of the framebuffer path, so prefer the fill and fall back
     * to the pattern only if the PSRAM buffer cannot be allocated. */
    static uint16_t *s_fill = NULL;
    s_fill = heap_caps_malloc(ODK_DISPLAY_H_RES * ODK_DISPLAY_V_RES * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
    if (s_fill) {
        for (int i = 0; i < ODK_DISPLAY_H_RES * ODK_DISPLAY_V_RES; i++) {
            s_fill[i] = 0x0000; /* RGB565 black — neutral behind AIODI bg (#000000) */
        }
        esp_lcd_panel_draw_bitmap(s_panel, 0, 0, ODK_DISPLAY_H_RES, ODK_DISPLAY_V_RES, s_fill);
        ESP_LOGI(TAG, "Open DeskOS display bring-up complete (solid fill %dx%d)",
                 ODK_DISPLAY_H_RES, ODK_DISPLAY_V_RES);
    } else {
        ESP_LOGE(TAG, "fill buffer alloc failed; falling back to hardware pattern");
        esp_lcd_dpi_panel_set_pattern(s_panel, MIPI_DSI_PATTERN_BAR_VERTICAL);
    }
    return s_panel;
}

esp_lcd_panel_handle_t odk_display_get_panel(void)
{
    return s_panel;
}

void odk_display_get_size(int *width, int *height)
{
    if (width) {
        *width = ODK_DISPLAY_H_RES;
    }
    if (height) {
        *height = ODK_DISPLAY_V_RES;
    }
}
