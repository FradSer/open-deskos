#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#include "driver/i2c_master.h"

#include "esp_attr.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_co6300.h"
// #include "esp_lcd_touch_cst3530.h"  // 触摸暂禁 (旧 i2c 驱动与 IDF6 driver_ng 冲突, 迁移待做)
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lv_demos.h"

static const char *TAG = "Main";

#define MIPI_DSI_DPI_CLK_MHZ 16

#define MIPI_DSI_LCD_H_RES 262  // 厂家官方=262 (丝印 M262928); 例程原为 272
#define MIPI_DSI_LCD_V_RES 928

#define MIPI_DSI_LCD_HSYNC 2     // 厂家官方 hsync_pulse_width=2; 例程原为 4
#define MIPI_DSI_LCD_HBP 32
#define MIPI_DSI_LCD_HFP 32
#define MIPI_DSI_LCD_VSYNC 2     // 厂家官方 vsync_pulse_width=2; 例程原为 4
#define MIPI_DSI_LCD_VBP 8
#define MIPI_DSI_LCD_VFP 8

#define TEST_MIPI_DSI_PHY_PWR_LDO_CHAN 3
#define TEST_MIPI_DSI_PHY_PWR_LDO_VOLTAGE_MV 2500

// 引脚以 open-deskos 板原理图为准 (照图接, 非 osptek 例程随手脚)。
#define EXAMPLE_PIN_NUM_TOUCH_SCL (GPIO_NUM_8)
#define EXAMPLE_PIN_NUM_TOUCH_SDA (GPIO_NUM_7)
#define EXAMPLE_PIN_NUM_TOUCH_RST (GPIO_NUM_6)
#define EXAMPLE_PIN_NUM_TOUCH_INT (GPIO_NUM_21)

#define LCD_VCI_EN_GPIO GPIO_NUM_20  // 原理图 LCD_BL 网络复用为 VCI_EN

#define TOUCH_HOST I2C_NUM_0

#define LCD_DRAW_BUFF_HEIGHT (120)  // 降低缓冲区高度，节省内存

static esp_lcd_panel_io_handle_t mipi_dbi_io = NULL;
static esp_lcd_panel_handle_t mipi_dpi_panel = NULL;
static esp_lcd_touch_handle_t tp = NULL;

static lv_display_t *lvgl_disp = NULL;

// === ICNA3312 (CO6300) 厂家完整 init — 来自 AM319M262928ZS after-code (V0.4 20250403), MIPI 变体 ===
// 562 行 RFE 分页寄存器序列; QSPI/SPI 专属行已剔除 (RC4 80)。CASET=6..267 (262宽, 偏移6)。
static const co6300_lcd_init_cmd_t lcd_init_cmds[] = {
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0xF4, (uint8_t[]){0x5A}, 1, 0},
    {0xF5, (uint8_t[]){0x59}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0xD8, (uint8_t[]){0x33}, 1, 0},
    {0xD9, (uint8_t[]){0x12}, 1, 0},
    {0xDA, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0x1A, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x01, (uint8_t[]){0x2B}, 1, 0},
    {0x02, (uint8_t[]){0xA0}, 1, 0},
    {0x59, (uint8_t[]){0x01}, 1, 0},
    {0x5A, (uint8_t[]){0xAB}, 1, 0},
    {0x5B, (uint8_t[]){0x04}, 1, 0},
    {0x5C, (uint8_t[]){0x04}, 1, 0},
    {0x70, (uint8_t[]){0x01}, 1, 0},
    {0x71, (uint8_t[]){0xAB}, 1, 0},
    {0x72, (uint8_t[]){0x04}, 1, 0},
    {0x73, (uint8_t[]){0x04}, 1, 0},
    {0xFE, (uint8_t[]){0x1C}, 1, 0},
    {0x00, (uint8_t[]){0x02}, 1, 0},
    {0x1F, (uint8_t[]){0x10}, 1, 0},
    {0x20, (uint8_t[]){0x03}, 1, 0},
    {0xFE, (uint8_t[]){0x19}, 1, 0},
    {0x46, (uint8_t[]){0xDE}, 1, 0},
    {0x47, (uint8_t[]){0xF0}, 1, 0},
    {0x48, (uint8_t[]){0x03}, 1, 0},
    {0x78, (uint8_t[]){0x02}, 1, 0},
    {0xFE, (uint8_t[]){0xE0}, 1, 0},
    {0x00, (uint8_t[]){0x0A}, 1, 0},
    {0x01, (uint8_t[]){0x01}, 1, 0},
    {0x66, (uint8_t[]){0x19}, 1, 0},
    {0x02, (uint8_t[]){0x20}, 1, 0},
    {0x52, (uint8_t[]){0x01}, 1, 0},
    {0x04, (uint8_t[]){0x2A}, 1, 0},
    {0x06, (uint8_t[]){0x0A}, 1, 0},
    {0x08, (uint8_t[]){0x00}, 1, 0},
    {0x5E, (uint8_t[]){0x14}, 1, 0},
    {0x09, (uint8_t[]){0x0A}, 1, 0},
    {0x0A, (uint8_t[]){0x01}, 1, 0},
    {0x67, (uint8_t[]){0x19}, 1, 0},
    {0x0B, (uint8_t[]){0x20}, 1, 0},
    {0x53, (uint8_t[]){0x01}, 1, 0},
    {0x0C, (uint8_t[]){0x0A}, 1, 0},
    {0x0E, (uint8_t[]){0x0A}, 1, 0},
    {0x0F, (uint8_t[]){0x00}, 1, 0},
    {0x5F, (uint8_t[]){0x14}, 1, 0},
    {0x10, (uint8_t[]){0x0A}, 1, 0},
    {0x11, (uint8_t[]){0x18}, 1, 0},
    {0x54, (uint8_t[]){0x01}, 1, 0},
    {0x24, (uint8_t[]){0x00}, 1, 0},
    {0x21, (uint8_t[]){0xC2}, 1, 0},
    {0x2D, (uint8_t[]){0xC2}, 1, 0},
    {0x32, (uint8_t[]){0xC2}, 1, 0},
    {0x23, (uint8_t[]){0x1E}, 1, 0},
    {0x30, (uint8_t[]){0x03}, 1, 0},
    {0x50, (uint8_t[]){0x13}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x57, (uint8_t[]){0x43}, 1, 0},
    {0x58, (uint8_t[]){0x33}, 1, 0},
    {0x6E, (uint8_t[]){0x43}, 1, 0},
    {0x6F, (uint8_t[]){0x33}, 1, 0},
    {0x74, (uint8_t[]){0x43}, 1, 0},
    {0x75, (uint8_t[]){0x33}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x12, (uint8_t[]){0xFE}, 1, 0},
    {0x13, (uint8_t[]){0x04}, 1, 0},
    {0xC9, (uint8_t[]){0x16}, 1, 0},
    {0x96, (uint8_t[]){0x69}, 1, 0},
    {0x97, (uint8_t[]){0x02}, 1, 0},
    {0xA5, (uint8_t[]){0xFF}, 1, 0},
    {0xAA, (uint8_t[]){0x69}, 1, 0},
    {0xAB, (uint8_t[]){0x16}, 1, 0},
    {0x98, (uint8_t[]){0x00}, 1, 0},
    {0xA7, (uint8_t[]){0x69}, 1, 0},
    {0xA9, (uint8_t[]){0x16}, 1, 0},
    {0xFE, (uint8_t[]){0x80}, 1, 0},
    {0xCD, (uint8_t[]){0x0F}, 1, 0},
    {0xCE, (uint8_t[]){0x05}, 1, 0},
    {0xCF, (uint8_t[]){0x05}, 1, 0},
    {0xD0, (uint8_t[]){0x05}, 1, 0},
    {0x66, (uint8_t[]){0x22}, 1, 0},
    {0x67, (uint8_t[]){0x44}, 1, 0},
    {0x68, (uint8_t[]){0x0A}, 1, 0},
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0x71, (uint8_t[]){0x07}, 1, 0},
    {0x72, (uint8_t[]){0x00}, 1, 0},
    {0x73, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x9B, (uint8_t[]){0x1E}, 1, 0},
    {0x9C, (uint8_t[]){0x1E}, 1, 0},
    {0x9D, (uint8_t[]){0x08}, 1, 0},
    {0x9E, (uint8_t[]){0x1E}, 1, 0},
    {0x9F, (uint8_t[]){0x03}, 1, 0},
    {0xA0, (uint8_t[]){0x1E}, 1, 0},
    {0xA2, (uint8_t[]){0x02}, 1, 0},
    {0xA3, (uint8_t[]){0x1E}, 1, 0},
    {0xA4, (uint8_t[]){0x13}, 1, 0},
    {0xA5, (uint8_t[]){0x1E}, 1, 0},
    {0xA6, (uint8_t[]){0x12}, 1, 0},
    {0xA7, (uint8_t[]){0x1E}, 1, 0},
    {0xA9, (uint8_t[]){0x11}, 1, 0},
    {0xAA, (uint8_t[]){0x1E}, 1, 0},
    {0xAB, (uint8_t[]){0x1E}, 1, 0},
    {0xAC, (uint8_t[]){0x1E}, 1, 0},
    {0xAD, (uint8_t[]){0x00}, 1, 0},
    {0xAE, (uint8_t[]){0x00}, 1, 0},
    {0xAF, (uint8_t[]){0x00}, 1, 0},
    {0xB0, (uint8_t[]){0x00}, 1, 0},
    {0xB3, (uint8_t[]){0x1E}, 1, 0},
    {0xB4, (uint8_t[]){0x1E}, 1, 0},
    {0xB5, (uint8_t[]){0x0C}, 1, 0},
    {0xB6, (uint8_t[]){0x1E}, 1, 0},
    {0xB7, (uint8_t[]){0x01}, 1, 0},
    {0xB8, (uint8_t[]){0x1E}, 1, 0},
    {0xB9, (uint8_t[]){0x00}, 1, 0},
    {0xBA, (uint8_t[]){0x1E}, 1, 0},
    {0xBB, (uint8_t[]){0x34}, 1, 0},
    {0xBC, (uint8_t[]){0x1E}, 1, 0},
    {0xBD, (uint8_t[]){0xF5}, 1, 0},
    {0xBE, (uint8_t[]){0x1E}, 1, 0},
    {0xBF, (uint8_t[]){0x16}, 1, 0},
    {0xC0, (uint8_t[]){0x1E}, 1, 0},
    {0xC1, (uint8_t[]){0x1E}, 1, 0},
    {0xC2, (uint8_t[]){0x1E}, 1, 0},
    {0xC3, (uint8_t[]){0x00}, 1, 0},
    {0xC4, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x4C, (uint8_t[]){0x22}, 1, 0},
    {0x53, (uint8_t[]){0xA0}, 1, 0},
    {0xFE, (uint8_t[]){0xF0}, 1, 0},
    {0x72, (uint8_t[]){0x36}, 1, 0},
    {0x73, (uint8_t[]){0x63}, 1, 0},
    {0x74, (uint8_t[]){0x14}, 1, 0},
    {0x75, (uint8_t[]){0x41}, 1, 0},
    {0x76, (uint8_t[]){0x25}, 1, 0},
    {0x77, (uint8_t[]){0x52}, 1, 0},
    {0x78, (uint8_t[]){0x36}, 1, 0},
    {0x79, (uint8_t[]){0x63}, 1, 0},
    {0x7A, (uint8_t[]){0x14}, 1, 0},
    {0x7B, (uint8_t[]){0x41}, 1, 0},
    {0x7C, (uint8_t[]){0x25}, 1, 0},
    {0x7D, (uint8_t[]){0x52}, 1, 0},
    {0x7E, (uint8_t[]){0x14}, 1, 0},
    {0x7F, (uint8_t[]){0x41}, 1, 0},
    {0x80, (uint8_t[]){0x36}, 1, 0},
    {0x81, (uint8_t[]){0x63}, 1, 0},
    {0x82, (uint8_t[]){0x25}, 1, 0},
    {0x83, (uint8_t[]){0x52}, 1, 0},
    {0x84, (uint8_t[]){0x14}, 1, 0},
    {0x85, (uint8_t[]){0x41}, 1, 0},
    {0x86, (uint8_t[]){0x36}, 1, 0},
    {0x87, (uint8_t[]){0x63}, 1, 0},
    {0x88, (uint8_t[]){0x25}, 1, 0},
    {0x89, (uint8_t[]){0x52}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x00, (uint8_t[]){0xC0}, 1, 0},
    {0x01, (uint8_t[]){0x08}, 1, 0},
    {0x02, (uint8_t[]){0x04}, 1, 0},
    {0x03, (uint8_t[]){0x01}, 1, 0},
    {0x04, (uint8_t[]){0x00}, 1, 0},
    {0x05, (uint8_t[]){0x03}, 1, 0},
    {0x06, (uint8_t[]){0x30}, 1, 0},
    {0x07, (uint8_t[]){0x30}, 1, 0},
    {0x09, (uint8_t[]){0xC0}, 1, 0},
    {0x0A, (uint8_t[]){0x08}, 1, 0},
    {0x0B, (uint8_t[]){0x04}, 1, 0},
    {0x0C, (uint8_t[]){0x01}, 1, 0},
    {0x0D, (uint8_t[]){0x00}, 1, 0},
    {0x0E, (uint8_t[]){0x01}, 1, 0},
    {0x0F, (uint8_t[]){0x30}, 1, 0},
    {0x10, (uint8_t[]){0x30}, 1, 0},
    {0x12, (uint8_t[]){0xC0}, 1, 0},
    {0x13, (uint8_t[]){0x00}, 1, 0},
    {0x14, (uint8_t[]){0x02}, 1, 0},
    {0x15, (uint8_t[]){0x01}, 1, 0},
    {0x16, (uint8_t[]){0x08}, 1, 0},
    {0x17, (uint8_t[]){0x01}, 1, 0},
    {0x18, (uint8_t[]){0x27}, 1, 0},
    {0x19, (uint8_t[]){0x00}, 1, 0},
    {0x1B, (uint8_t[]){0xC0}, 1, 0},
    {0x1C, (uint8_t[]){0x00}, 1, 0},
    {0x1D, (uint8_t[]){0x02}, 1, 0},
    {0x1E, (uint8_t[]){0x01}, 1, 0},
    {0x1F, (uint8_t[]){0x08}, 1, 0},
    {0x20, (uint8_t[]){0x00}, 1, 0},
    {0x21, (uint8_t[]){0x27}, 1, 0},
    {0x22, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x4C, (uint8_t[]){0x80}, 1, 0},
    {0x4D, (uint8_t[]){0x00}, 1, 0},
    {0x4E, (uint8_t[]){0x01}, 1, 0},
    {0x4F, (uint8_t[]){0x00}, 1, 0},
    {0x50, (uint8_t[]){0x01}, 1, 0},
    {0x51, (uint8_t[]){0xF7}, 1, 0},
    {0x52, (uint8_t[]){0x30}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x53, (uint8_t[]){0xC6}, 1, 0},
    {0x54, (uint8_t[]){0x00}, 1, 0},
    {0x55, (uint8_t[]){0x03}, 1, 0},
    {0x56, (uint8_t[]){0x01}, 1, 0},
    {0x58, (uint8_t[]){0x00}, 1, 0},
    {0x65, (uint8_t[]){0xA8}, 1, 0},
    {0x66, (uint8_t[]){0x08}, 1, 0},
    {0x67, (uint8_t[]){0x30}, 1, 0},
    {0xFE, (uint8_t[]){0xF0}, 1, 0},
    {0xA3, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x76, (uint8_t[]){0x0C}, 1, 0},
    {0x77, (uint8_t[]){0x00}, 1, 0},
    {0x78, (uint8_t[]){0x05}, 1, 0},
    {0x68, (uint8_t[]){0x0C}, 1, 0},
    {0x69, (uint8_t[]){0x0C}, 1, 0},
    {0x6A, (uint8_t[]){0x0C}, 1, 0},
    {0x6B, (uint8_t[]){0x0C}, 1, 0},
    {0x6C, (uint8_t[]){0x0C}, 1, 0},
    {0x6D, (uint8_t[]){0x0C}, 1, 0},
    {0xFE, (uint8_t[]){0xF0}, 1, 0},
    {0xA9, (uint8_t[]){0x1F}, 1, 0},
    {0xAA, (uint8_t[]){0x1F}, 1, 0},
    {0xAB, (uint8_t[]){0x1F}, 1, 0},
    {0xAC, (uint8_t[]){0x1F}, 1, 0},
    {0xAD, (uint8_t[]){0x1F}, 1, 0},
    {0xAE, (uint8_t[]){0x1F}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x93, (uint8_t[]){0x0C}, 1, 0},
    {0x94, (uint8_t[]){0x00}, 1, 0},
    {0x96, (uint8_t[]){0x05}, 1, 0},
    {0xDB, (uint8_t[]){0x0C}, 1, 0},
    {0xDC, (uint8_t[]){0x0C}, 1, 0},
    {0xDD, (uint8_t[]){0x0C}, 1, 0},
    {0xDE, (uint8_t[]){0x0C}, 1, 0},
    {0xDF, (uint8_t[]){0x0C}, 1, 0},
    {0xE0, (uint8_t[]){0x0C}, 1, 0},
    {0xE7, (uint8_t[]){0x1F}, 1, 0},
    {0xE8, (uint8_t[]){0x1F}, 1, 0},
    {0xE9, (uint8_t[]){0x1F}, 1, 0},
    {0xEA, (uint8_t[]){0x1F}, 1, 0},
    {0xEB, (uint8_t[]){0x1F}, 1, 0},
    {0xEC, (uint8_t[]){0x1F}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0xD1, (uint8_t[]){0xF0}, 1, 0},
    {0xD2, (uint8_t[]){0xFF}, 1, 0},
    {0xD3, (uint8_t[]){0xF0}, 1, 0},
    {0xD4, (uint8_t[]){0xFF}, 1, 0},
    {0xD5, (uint8_t[]){0xA0}, 1, 0},
    {0xD6, (uint8_t[]){0xAA}, 1, 0},
    {0xD7, (uint8_t[]){0xF0}, 1, 0},
    {0xD8, (uint8_t[]){0xFF}, 1, 0},
    {0xFE, (uint8_t[]){0xF0}, 1, 0},
    {0xA4, (uint8_t[]){0xF0}, 1, 0},
    {0xA5, (uint8_t[]){0xFF}, 1, 0},
    {0xA6, (uint8_t[]){0xF0}, 1, 0},
    {0xA7, (uint8_t[]){0xFF}, 1, 0},
    {0xFE, (uint8_t[]){0x19}, 1, 0},
    {0x57, (uint8_t[]){0xF0}, 1, 0},
    {0x58, (uint8_t[]){0xFF}, 1, 0},
    {0x59, (uint8_t[]){0xF0}, 1, 0},
    {0x5A, (uint8_t[]){0xFF}, 1, 0},
    {0x5B, (uint8_t[]){0xF0}, 1, 0},
    {0x5C, (uint8_t[]){0xFF}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x4D, (uint8_t[]){0x2A}, 1, 0},
    {0x4E, (uint8_t[]){0x00}, 1, 0},
    {0x4F, (uint8_t[]){0x00}, 1, 0},
    {0x50, (uint8_t[]){0x00}, 1, 0},
    {0x51, (uint8_t[]){0xF3}, 1, 0},
    {0x52, (uint8_t[]){0x23}, 1, 0},
    {0x6B, (uint8_t[]){0xF3}, 1, 0},
    {0x6C, (uint8_t[]){0x13}, 1, 0},
    {0x8F, (uint8_t[]){0xFF}, 1, 0},
    {0x90, (uint8_t[]){0xFF}, 1, 0},
    {0x91, (uint8_t[]){0xFF}, 1, 0},
    {0xA2, (uint8_t[]){0x10}, 1, 0},
    {0x07, (uint8_t[]){0x21}, 1, 0},
    {0x35, (uint8_t[]){0x81}, 1, 0},
    {0xFE, (uint8_t[]){0x80}, 1, 0},
    {0x94, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x1B}, 1, 0},
    {0x00, (uint8_t[]){0x00}, 1, 0},
    {0x01, (uint8_t[]){0x00}, 1, 0},
    {0x02, (uint8_t[]){0x00}, 1, 0},
    {0x05, (uint8_t[]){0x00}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x33, (uint8_t[]){0x10}, 1, 0},
    {0x34, (uint8_t[]){0xC1}, 1, 0},
    {0xFE, (uint8_t[]){0x50}, 1, 0},
    {0xA9, (uint8_t[]){0x18}, 1, 0},
    {0xAA, (uint8_t[]){0x8D}, 1, 0},
    {0xAB, (uint8_t[]){0x01}, 1, 0},
    {0xFE, (uint8_t[]){0x60}, 1, 0},
    {0xA9, (uint8_t[]){0x18}, 1, 0},
    {0xAA, (uint8_t[]){0x8D}, 1, 0},
    {0xAB, (uint8_t[]){0x01}, 1, 0},
    {0xFE, (uint8_t[]){0x30}, 1, 0},
    {0xA9, (uint8_t[]){0x18}, 1, 0},
    {0xAA, (uint8_t[]){0x8D}, 1, 0},
    {0xAB, (uint8_t[]){0x01}, 1, 0},
    {0xFE, (uint8_t[]){0x90}, 1, 0},
    {0x17, (uint8_t[]){0x01}, 1, 0},
    {0x18, (uint8_t[]){0x01}, 1, 0},
    {0x19, (uint8_t[]){0x00}, 1, 0},
    {0x1A, (uint8_t[]){0x00}, 1, 0},
    {0x1B, (uint8_t[]){0x40}, 1, 0},
    {0x1C, (uint8_t[]){0x88}, 1, 0},
    {0x1D, (uint8_t[]){0xD0}, 1, 0},
    {0x1E, (uint8_t[]){0x11}, 1, 0},
    {0x1F, (uint8_t[]){0x0D}, 1, 0},
    {0x20, (uint8_t[]){0x00}, 1, 0},
    {0x21, (uint8_t[]){0x18}, 1, 0},
    {0x22, (uint8_t[]){0x18}, 1, 0},
    {0x23, (uint8_t[]){0x00}, 1, 0},
    {0x24, (uint8_t[]){0xD1}, 1, 0},
    {0x25, (uint8_t[]){0x85}, 1, 0},
    {0x26, (uint8_t[]){0x00}, 1, 0},
    {0x27, (uint8_t[]){0xFF}, 1, 0},
    {0x28, (uint8_t[]){0xD3}, 1, 0},
    {0x29, (uint8_t[]){0x01}, 1, 0},
    {0x2A, (uint8_t[]){0x88}, 1, 0},
    {0x2B, (uint8_t[]){0x00}, 1, 0},
    {0x2D, (uint8_t[]){0x40}, 1, 0},
    {0x2F, (uint8_t[]){0x88}, 1, 0},
    {0x30, (uint8_t[]){0xD0}, 1, 0},
    {0x31, (uint8_t[]){0xFF}, 1, 0},
    {0x32, (uint8_t[]){0x0D}, 1, 0},
    {0x33, (uint8_t[]){0x00}, 1, 0},
    {0x34, (uint8_t[]){0x18}, 1, 0},
    {0x35, (uint8_t[]){0x18}, 1, 0},
    {0x36, (uint8_t[]){0x00}, 1, 0},
    {0x37, (uint8_t[]){0xD1}, 1, 0},
    {0x38, (uint8_t[]){0x85}, 1, 0},
    {0x39, (uint8_t[]){0x00}, 1, 0},
    {0x3A, (uint8_t[]){0xFF}, 1, 0},
    {0x3B, (uint8_t[]){0xC3}, 1, 0},
    {0xA4, (uint8_t[]){0x01}, 1, 0},
    {0xA5, (uint8_t[]){0x00}, 1, 0},
    {0xA6, (uint8_t[]){0xD0}, 1, 0},
    {0xA7, (uint8_t[]){0x44}, 1, 0},
    {0xA9, (uint8_t[]){0x88}, 1, 0},
    {0xAA, (uint8_t[]){0xD0}, 1, 0},
    {0xAB, (uint8_t[]){0x11}, 1, 0},
    {0xAC, (uint8_t[]){0x93}, 1, 0},
    {0xAD, (uint8_t[]){0x0C}, 1, 0},
    {0xAE, (uint8_t[]){0x18}, 1, 0},
    {0xAF, (uint8_t[]){0x18}, 1, 0},
    {0xB0, (uint8_t[]){0x00}, 1, 0},
    {0xB1, (uint8_t[]){0xD1}, 1, 0},
    {0xB2, (uint8_t[]){0x85}, 1, 0},
    {0xB3, (uint8_t[]){0x00}, 1, 0},
    {0xB4, (uint8_t[]){0xFF}, 1, 0},
    {0xB5, (uint8_t[]){0xE3}, 1, 0},
    {0xFE, (uint8_t[]){0x11}, 1, 0},
    {0x00, (uint8_t[]){0x01}, 1, 0},
    {0x01, (uint8_t[]){0x88}, 1, 0},
    {0x02, (uint8_t[]){0xD0}, 1, 0},
    {0x03, (uint8_t[]){0x44}, 1, 0},
    {0x04, (uint8_t[]){0x88}, 1, 0},
    {0x05, (uint8_t[]){0xD0}, 1, 0},
    {0x06, (uint8_t[]){0xFF}, 1, 0},
    {0x07, (uint8_t[]){0x93}, 1, 0},
    {0x08, (uint8_t[]){0x0C}, 1, 0},
    {0x09, (uint8_t[]){0x18}, 1, 0},
    {0x0A, (uint8_t[]){0x18}, 1, 0},
    {0x0B, (uint8_t[]){0x00}, 1, 0},
    {0x0C, (uint8_t[]){0xD1}, 1, 0},
    {0x0D, (uint8_t[]){0x85}, 1, 0},
    {0x0E, (uint8_t[]){0x00}, 1, 0},
    {0x0F, (uint8_t[]){0xFF}, 1, 0},
    {0x10, (uint8_t[]){0xF3}, 1, 0},
    {0xFE, (uint8_t[]){0x90}, 1, 0},
    {0x4E, (uint8_t[]){0x07}, 1, 0},
    {0x4F, (uint8_t[]){0x07}, 1, 0},
    {0x50, (uint8_t[]){0x0C}, 1, 0},
    {0x49, (uint8_t[]){0x01}, 1, 0},
    {0x4A, (uint8_t[]){0xA0}, 1, 0},
    {0xC7, (uint8_t[]){0x0D}, 1, 0},
    {0xC8, (uint8_t[]){0x70}, 1, 0},
    {0x51, (uint8_t[]){0x00}, 1, 0},
    {0x52, (uint8_t[]){0x88}, 1, 0},
    {0x53, (uint8_t[]){0x00}, 1, 0},
    {0x54, (uint8_t[]){0x10}, 1, 0},
    {0x55, (uint8_t[]){0x00}, 1, 0},
    {0x56, (uint8_t[]){0x00}, 1, 0},
    {0x57, (uint8_t[]){0x00}, 1, 0},
    {0x58, (uint8_t[]){0x00}, 1, 0},
    {0x59, (uint8_t[]){0x00}, 1, 0},
    {0x5A, (uint8_t[]){0x08}, 1, 0},
    {0x5B, (uint8_t[]){0x10}, 1, 0},
    {0x5C, (uint8_t[]){0x00}, 1, 0},
    {0x5D, (uint8_t[]){0x08}, 1, 0},
    {0x5E, (uint8_t[]){0x80}, 1, 0},
    {0x5F, (uint8_t[]){0x00}, 1, 0},
    {0x60, (uint8_t[]){0x00}, 1, 0},
    {0x61, (uint8_t[]){0x08}, 1, 0},
    {0x62, (uint8_t[]){0x10}, 1, 0},
    {0x63, (uint8_t[]){0x00}, 1, 0},
    {0x64, (uint8_t[]){0x00}, 1, 0},
    {0x65, (uint8_t[]){0x00}, 1, 0},
    {0x66, (uint8_t[]){0x00}, 1, 0},
    {0x67, (uint8_t[]){0x00}, 1, 0},
    {0x68, (uint8_t[]){0x48}, 1, 0},
    {0x69, (uint8_t[]){0x00}, 1, 0},
    {0x6A, (uint8_t[]){0x00}, 1, 0},
    {0x6B, (uint8_t[]){0x08}, 1, 0},
    {0x6C, (uint8_t[]){0x00}, 1, 0},
    {0x6D, (uint8_t[]){0x40}, 1, 0},
    {0x6E, (uint8_t[]){0x00}, 1, 0},
    {0x6F, (uint8_t[]){0x10}, 1, 0},
    {0x70, (uint8_t[]){0x84}, 1, 0},
    {0x71, (uint8_t[]){0x00}, 1, 0},
    {0x72, (uint8_t[]){0x00}, 1, 0},
    {0x73, (uint8_t[]){0x00}, 1, 0},
    {0x74, (uint8_t[]){0x08}, 1, 0},
    {0x75, (uint8_t[]){0x04}, 1, 0},
    {0x76, (uint8_t[]){0x10}, 1, 0},
    {0x77, (uint8_t[]){0x04}, 1, 0},
    {0x78, (uint8_t[]){0x00}, 1, 0},
    {0x79, (uint8_t[]){0x00}, 1, 0},
    {0x7A, (uint8_t[]){0x00}, 1, 0},
    {0x7B, (uint8_t[]){0x00}, 1, 0},
    {0x7C, (uint8_t[]){0x44}, 1, 0},
    {0x7D, (uint8_t[]){0x10}, 1, 0},
    {0x7E, (uint8_t[]){0x00}, 1, 0},
    {0x7F, (uint8_t[]){0x08}, 1, 0},
    {0x80, (uint8_t[]){0x00}, 1, 0},
    {0x81, (uint8_t[]){0x08}, 1, 0},
    {0x82, (uint8_t[]){0x00}, 1, 0},
    {0x83, (uint8_t[]){0x44}, 1, 0},
    {0x84, (uint8_t[]){0x04}, 1, 0},
    {0x85, (uint8_t[]){0x00}, 1, 0},
    {0x86, (uint8_t[]){0x00}, 1, 0},
    {0x87, (uint8_t[]){0x00}, 1, 0},
    {0x88, (uint8_t[]){0x08}, 1, 0},
    {0x89, (uint8_t[]){0x00}, 1, 0},
    {0x8A, (uint8_t[]){0x10}, 1, 0},
    {0x8B, (uint8_t[]){0x08}, 1, 0},
    {0x8C, (uint8_t[]){0x00}, 1, 0},
    {0x8D, (uint8_t[]){0x00}, 1, 0},
    {0x8E, (uint8_t[]){0x00}, 1, 0},
    {0x8F, (uint8_t[]){0x00}, 1, 0},
    {0x90, (uint8_t[]){0x00}, 1, 0},
    {0x91, (uint8_t[]){0x10}, 1, 0},
    {0x92, (uint8_t[]){0x08}, 1, 0},
    {0x93, (uint8_t[]){0x08}, 1, 0},
    {0x94, (uint8_t[]){0x80}, 1, 0},
    {0x95, (uint8_t[]){0x00}, 1, 0},
    {0x96, (uint8_t[]){0x00}, 1, 0},
    {0x97, (uint8_t[]){0x80}, 1, 0},
    {0x98, (uint8_t[]){0x10}, 1, 0},
    {0x99, (uint8_t[]){0x00}, 1, 0},
    {0x9A, (uint8_t[]){0x00}, 1, 0},
    {0x9B, (uint8_t[]){0x00}, 1, 0},
    {0x9C, (uint8_t[]){0x00}, 1, 0},
    {0x9D, (uint8_t[]){0x00}, 1, 0},
    {0x9E, (uint8_t[]){0x40}, 1, 0},
    {0x9F, (uint8_t[]){0x08}, 1, 0},
    {0xA0, (uint8_t[]){0x00}, 1, 0},
    {0xA2, (uint8_t[]){0x08}, 1, 0},
    {0xFE, (uint8_t[]){0x19}, 1, 0},
    {0x49, (uint8_t[]){0x03}, 1, 0},
    {0x4B, (uint8_t[]){0x45}, 1, 0},
    {0x4C, (uint8_t[]){0x05}, 1, 0},
    {0x4D, (uint8_t[]){0x45}, 1, 0},
    {0x4E, (uint8_t[]){0x05}, 1, 0},
    {0x4F, (uint8_t[]){0x45}, 1, 0},
    {0x50, (uint8_t[]){0x05}, 1, 0},
    {0xFE, (uint8_t[]){0x70}, 1, 0},
    {0x97, (uint8_t[]){0x77}, 1, 0},
    {0x98, (uint8_t[]){0x77}, 1, 0},
    {0xC9, (uint8_t[]){0x05}, 1, 0},
    {0xCA, (uint8_t[]){0x05}, 1, 0},
    {0xCB, (uint8_t[]){0x05}, 1, 0},
    {0xCC, (uint8_t[]){0x05}, 1, 0},
    {0xCD, (uint8_t[]){0x05}, 1, 0},
    {0xCE, (uint8_t[]){0x85}, 1, 0},
    {0xCF, (uint8_t[]){0x05}, 1, 0},
    {0xD0, (uint8_t[]){0x45}, 1, 0},
    {0xFE, (uint8_t[]){0xE0}, 1, 0},
    {0x19, (uint8_t[]){0x44}, 1, 0},
    {0x1E, (uint8_t[]){0x44}, 1, 0},
    {0x1C, (uint8_t[]){0x41}, 1, 0},
    {0x18, (uint8_t[]){0x00}, 1, 0},
    {0x1B, (uint8_t[]){0x34}, 1, 0},
    {0x1A, (uint8_t[]){0x1A}, 1, 0},
    {0x1D, (uint8_t[]){0x52}, 1, 0},
    {0x71, (uint8_t[]){0x3F}, 1, 0},
    {0x72, (uint8_t[]){0x40}, 1, 0},
    {0x28, (uint8_t[]){0x58}, 1, 0},
    {0x05, (uint8_t[]){0x04}, 1, 0},
    {0x0D, (uint8_t[]){0x04}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x54, (uint8_t[]){0xAC}, 1, 0},
    {0x55, (uint8_t[]){0xA0}, 1, 0},
    {0x48, (uint8_t[]){0xAA}, 1, 0},
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0x34, (uint8_t[]){0x33}, 1, 0},
    {0x37, (uint8_t[]){0x03}, 1, 0},
    {0x39, (uint8_t[]){0x33}, 1, 0},
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0x43, (uint8_t[]){0x8B}, 1, 0},
    {0x60, (uint8_t[]){0x11}, 1, 0},
    {0x64, (uint8_t[]){0x11}, 1, 0},
    {0x6C, (uint8_t[]){0x11}, 1, 0},
    {0x6D, (uint8_t[]){0x25}, 1, 0},
    {0x6A, (uint8_t[]){0x15}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x25, (uint8_t[]){0x22}, 1, 0},
    {0x21, (uint8_t[]){0xAA}, 1, 0},
    {0x1C, (uint8_t[]){0xAC}, 1, 0},
    {0xFE, (uint8_t[]){0xE0}, 1, 0},
    {0x75, (uint8_t[]){0x11}, 1, 0},
    {0xFE, (uint8_t[]){0xE0}, 1, 0},
    {0x4D, (uint8_t[]){0x10}, 1, 0},
    {0x58, (uint8_t[]){0x10}, 1, 0},
    {0x56, (uint8_t[]){0x22}, 1, 0},
    {0x4E, (uint8_t[]){0x19}, 1, 0},
    {0x59, (uint8_t[]){0x19}, 1, 0},
    {0x6D, (uint8_t[]){0x01}, 1, 0},
    {0x6F, (uint8_t[]){0x01}, 1, 0},
    {0xFE, (uint8_t[]){0x20}, 1, 0},
    {0x1D, (uint8_t[]){0x80}, 1, 0},
    {0xFE, (uint8_t[]){0x40}, 1, 0},
    {0x37, (uint8_t[]){0x25}, 1, 0},
    {0xFE, (uint8_t[]){0xE0}, 1, 0},
    {0x13, (uint8_t[]){0x2A}, 1, 0},
    {0x14, (uint8_t[]){0x00}, 1, 0},
    {0x15, (uint8_t[]){0x09}, 1, 0},
    {0x7A, (uint8_t[]){0x15}, 1, 0},
    {0xFE, (uint8_t[]){0x00}, 1, 0},
    {0x35, (uint8_t[]){0x00}, 1, 0},
    {0x53, (uint8_t[]){0x20}, 1, 0},
    {0x51, (uint8_t[]){0xFF}, 1, 0},
    {0x63, (uint8_t[]){0xFF}, 1, 0},
    {0x2A, (uint8_t[]){0x00, 0x06, 0x01, 0x0B}, 4, 0},
    {0x2B, (uint8_t[]){0x00, 0x00, 0x03, 0x9F}, 4, 0},
    {0x11, NULL, 0, 60},
    {0x29, NULL, 0, 0},
};

static void lcd_vci_en_init(void) {
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << LCD_VCI_EN_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&cfg);

    gpio_set_level(LCD_VCI_EN_GPIO, 0);
    vTaskDelay(pdMS_TO_TICKS(60));

    gpio_set_level(LCD_VCI_EN_GPIO, 1);

    vTaskDelay(pdMS_TO_TICKS(50));
}

// IDF6: 改用新 i2c_master 驱动。bus handle 在 app_touch_init 里创建并复用。
static i2c_master_bus_handle_t s_i2c_bus = NULL;

static void i2c_scan(void) {
    ESP_LOGI(TAG, "Scanning I2C bus...");
    int found = 0;
    for (uint8_t addr = 1; addr < 127; addr++) {
        if (i2c_master_probe(s_i2c_bus, addr, 1000) == ESP_OK) {
            ESP_LOGI(TAG, "Found I2C device at address 0x%02x", addr);
            found++;
        }
    }
    ESP_LOGI(TAG, "I2C scan completed, %d device(s).", found);
}

esp_err_t app_lcd_init() {
    esp_lcd_dsi_bus_handle_t mipi_dsi_bus;
    esp_ldo_channel_handle_t ldo_mipi_phy = NULL;

    ESP_LOGI(TAG, "MIPI DSI PHY Powered on");
    esp_ldo_channel_config_t ldo_mipi_phy_config = {
        .chan_id = TEST_MIPI_DSI_PHY_PWR_LDO_CHAN,
        .voltage_mv = TEST_MIPI_DSI_PHY_PWR_LDO_VOLTAGE_MV,
    };
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&ldo_mipi_phy_config, &ldo_mipi_phy));

    // 屏实际为 1-lane/360 (osptek 原值, IDF5.5.1 上点亮验证)。
    esp_lcd_dsi_bus_config_t bus_config = {
        .bus_id = 0,
        .num_data_lanes = 1,
        .lane_bit_rate_mbps = 360,
    };
    ESP_LOGI(TAG, "esp_lcd_new_dsi_bus!");
    ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&bus_config, &mipi_dsi_bus));

    esp_lcd_dbi_io_config_t dbi_config = {
        .virtual_channel = 0,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_LOGI(TAG, "esp_lcd_new_panel_io_dbi!");
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(mipi_dsi_bus, &dbi_config, &mipi_dbi_io));

    esp_lcd_dpi_panel_config_t dpi_config = {
        .dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT,
        .dpi_clock_freq_mhz = 16,
        .virtual_channel = 0,
        .in_color_format = LCD_COLOR_FMT_RGB565,
        .out_color_format = LCD_COLOR_FMT_RGB565,
        .num_fbs = 1,
        .video_timing =
            {
                .h_size = MIPI_DSI_LCD_H_RES,
                .v_size = MIPI_DSI_LCD_V_RES,
                .hsync_back_porch = MIPI_DSI_LCD_HBP,
                .hsync_pulse_width = MIPI_DSI_LCD_HSYNC,
                .hsync_front_porch = MIPI_DSI_LCD_HFP,
                .vsync_back_porch = MIPI_DSI_LCD_VBP,
                .vsync_pulse_width = MIPI_DSI_LCD_VSYNC,
                .vsync_front_porch = MIPI_DSI_LCD_VFP,
            },
    };

    co6300_vendor_config_t vendor_config = {0};
    vendor_config.init_cmds = lcd_init_cmds;
    vendor_config.init_cmds_size = sizeof(lcd_init_cmds) / sizeof(lcd_init_cmds[0]);
    vendor_config.flags.use_mipi_interface = 1;
    vendor_config.mipi_config.dsi_bus = mipi_dsi_bus;
    vendor_config.mipi_config.dpi_config = &dpi_config;

    esp_lcd_panel_dev_config_t lcd_dev_config = {
        // 硬件复位: LCD_RST 接 GPIO5 (原理图为准; pin20)。低有效, 高→低10ms→高120ms。
        .reset_gpio_num = 5,
        .flags.reset_active_high = 0,  // 低有效 (标准)
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_config,
    };

    ESP_ERROR_CHECK(esp_lcd_new_panel_co6300(mipi_dbi_io, &lcd_dev_config, &mipi_dpi_panel));
    esp_lcd_panel_reset(mipi_dpi_panel);
    esp_lcd_panel_init(mipi_dpi_panel);

    assert(mipi_dbi_io);
    assert(mipi_dpi_panel);

    return ESP_OK;
}

// 触摸暂禁: CST3530 组件用旧 i2c 驱动, 与 IDF6 driver_ng 启动期冲突 abort。
// 迁移到新 i2c_master 后恢复。这里留空桩避免编译引用。
esp_err_t app_touch_init(void) {
    ESP_LOGW(TAG, "touch disabled (CST3530 旧 i2c 驱动与 IDF6 冲突; 待迁移)");
    return ESP_OK;
}

esp_err_t app_lvgl_init() {
    const lvgl_port_cfg_t lvgl_cfg = {
        .task_priority = 4,      /* LVGL task priority */
        .task_stack = 4096 * 2,  /* LVGL task stack size */
        .task_affinity = -1,     /* LVGL task pinned to core (-1 is no affinity) */
        .task_max_sleep_ms = 500,
        .timer_period_ms = 5
    };
    ESP_RETURN_ON_ERROR(lvgl_port_init(&lvgl_cfg), TAG, "LVGL port initialization failed");

    ESP_LOGD(TAG, "Add LCD screen");
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = mipi_dbi_io,
        .panel_handle = mipi_dpi_panel,
        .buffer_size = MIPI_DSI_LCD_H_RES * LCD_DRAW_BUFF_HEIGHT,
        .double_buffer = true,
        .hres = MIPI_DSI_LCD_H_RES,
        .vres = MIPI_DSI_LCD_V_RES,
        .monochrome = false,
        .color_format = LV_COLOR_FORMAT_RGB565,
        .rotation =
            {
                .swap_xy = false,
                .mirror_x = false,
                .mirror_y = false,
            },
        .flags =
            {
                .buff_dma = true,
                .buff_spiram = false,
                .swap_bytes = false,
            }
    };
    const lvgl_port_display_dsi_cfg_t dsi_cfg = {
        .flags =
            {
                .avoid_tearing = false,
            },
    };
    lvgl_disp = lvgl_port_add_disp_dsi(&disp_cfg, &dsi_cfg);

    // 触摸暂禁 (CST3530 旧 i2c 驱动冲突); 仅显示
    // const lvgl_port_touch_cfg_t touch_cfg = {
    //     .disp = lvgl_disp,
    //     .handle = tp,
    // };
    // lvgl_port_add_touch(&touch_cfg);

    return ESP_OK;
}

// 诊断: 扫描 15-pin 排线上的触摸 I2C (SDA=GPIO7, SCL=GPIO8)。
// 扫到设备 = 排线供电/GND/信号都通 → 暗屏是 DSI 或复位问题。
// 扫不到 = 排线根本没接触(或屏侧没供电)。
static void probe_ribbon_i2c(void) {
    const i2c_master_bus_config_t cfg = {
        .i2c_port = TOUCH_HOST,
        .sda_io_num = EXAMPLE_PIN_NUM_TOUCH_SDA,
        .scl_io_num = EXAMPLE_PIN_NUM_TOUCH_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    if (i2c_new_master_bus(&cfg, &s_i2c_bus) != ESP_OK) {
        ESP_LOGW(TAG, "PROBE I2C: bus create failed");
        return;
    }
    ESP_LOGW(TAG, "PROBE I2C scan on SDA=%d SCL=%d ...", EXAMPLE_PIN_NUM_TOUCH_SDA, EXAMPLE_PIN_NUM_TOUCH_SCL);
    i2c_scan();
    i2c_del_master_bus(s_i2c_bus);
    s_i2c_bus = NULL;
}

void app_main(void) {
    lcd_vci_en_init();
    probe_ribbon_i2c();   // 诊断: 先测排线是否接触

    ESP_ERROR_CHECK(app_lcd_init());
    ESP_ERROR_CHECK(app_touch_init());  // 桩: 触摸暂禁
    ESP_ERROR_CHECK(app_lvgl_init());

    lvgl_port_lock(-1);
    lv_demo_widgets();
    // lv_demo_music();
    lvgl_port_unlock();
}
