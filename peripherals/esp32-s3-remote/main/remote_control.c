#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "class/hid/hid_device.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "navigation_gesture.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_st7789.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "tinyusb.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_default_config.h"

#define DISPLAY_WIDTH 240
#define DISPLAY_HEIGHT 320
#define DISPLAY_SPI_HOST SPI2_HOST
#define DISPLAY_SPI_MOSI GPIO_NUM_45
#define DISPLAY_SPI_SCLK GPIO_NUM_40
#define DISPLAY_CS GPIO_NUM_42
#define DISPLAY_DC GPIO_NUM_41
#define DISPLAY_RST GPIO_NUM_39
#define DISPLAY_BACKLIGHT GPIO_NUM_5
#define DISPLAY_POWER GPIO_NUM_7
#define DISPLAY_POWER_KEY GPIO_NUM_6
#define DISPLAY_BACKLIGHT_CHANNEL LEDC_CHANNEL_1
#define DISPLAY_BACKLIGHT_TIMER LEDC_TIMER_0

#define TOUCH_I2C_PORT I2C_NUM_1
#define TOUCH_SDA GPIO_NUM_1
#define TOUCH_SCL GPIO_NUM_3
#define TOUCH_RST GPIO_NUM_2
#define TOUCH_ADDRESS 0x1A
#define TOUCH_REGISTER_COUNT 0xD005
#define TOUCH_REGISTER_POINTS 0xD000

#define TOUCH_POLL_INTERVAL_MS 16
#define HID_RELEASE_DELAY_MS 12
#define CDC_STATE_MAX_BYTES 255
#define STATE_NAME_MAX_BYTES 47
#define STATE_COUNTER_MAX_BYTES 15

#define COLOR_BACKGROUND 0x0000
#define COLOR_TEXT 0xFFFF
#define COLOR_MUTED 0x9CD3
#define COLOR_LEFT 0xF988
#define COLOR_RIGHT 0x1D7C

static const char *TAG = "odk_remote";

typedef struct {
    bool received;
    uint16_t page;
    uint16_t pages;
    bool can_prev;
    bool can_next;
    char name[STATE_NAME_MAX_BYTES + 1];
} remote_state_t;

static esp_lcd_panel_handle_t s_panel;
static uint16_t *s_framebuffer;
static i2c_master_dev_handle_t s_touch;
static QueueHandle_t s_state_queue;
static remote_state_t s_state;
static remote_state_t s_rendered_state;
static bool s_has_rendered = false;
static navigation_gesture_t s_gesture;
static char s_cdc_line[CDC_STATE_MAX_BYTES + 1];
static size_t s_cdc_line_length;
static bool s_cdc_line_overflow;

#define REMOTE_USB_DESC_LEN (TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_HID_DESC_LEN)

static const uint8_t s_hid_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD(),
};

static const char *s_usb_string_descriptors[] = {
    (char[]){0x09, 0x04},
    "Open DeskOS",
    "Open DeskOS Remote",
    "remote-s3",
    "Open DeskOS Remote CDC",
    "Open DeskOS Remote Keyboard",
};

static const uint8_t s_usb_configuration_descriptor[] = {
    TUD_CONFIG_DESCRIPTOR(1, 3, 0, REMOTE_USB_DESC_LEN,
                          TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),
    TUD_CDC_DESCRIPTOR(0, 4, 0x81, 8, 0x02, 0x82, 64),
    TUD_HID_DESCRIPTOR(2, 5, HID_ITF_PROTOCOL_KEYBOARD,
                       sizeof(s_hid_report_descriptor), 0x83, 8, 10),
};

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance)
{
    (void)instance;
    return s_hid_report_descriptor;
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                               hid_report_type_t report_type, uint8_t *buffer,
                               uint16_t requested_length)
{
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)requested_length;
    return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                           hid_report_type_t report_type,
                           uint8_t const *buffer, uint16_t buffer_size)
{
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)buffer_size;
}

static esp_err_t display_power_init(void)
{
    const gpio_config_t key_config = {
        .pin_bit_mask = 1ULL << DISPLAY_POWER_KEY,
        .mode = GPIO_MODE_INPUT,
    };
    const gpio_config_t power_config = {
        .pin_bit_mask = 1ULL << DISPLAY_POWER,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&key_config), TAG, "power key GPIO");
    ESP_RETURN_ON_ERROR(gpio_config(&power_config), TAG, "panel power GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level(DISPLAY_POWER, 0), TAG, "power off");
    vTaskDelay(pdMS_TO_TICKS(100));
    if (gpio_get_level(DISPLAY_POWER_KEY) == 0) {
        ESP_RETURN_ON_ERROR(gpio_set_level(DISPLAY_POWER, 1), TAG, "power on");
    }
    return ESP_OK;
}

static esp_err_t display_backlight_init(void)
{
    const ledc_timer_config_t timer_config = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = DISPLAY_BACKLIGHT_TIMER,
        .freq_hz = 20000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    const ledc_channel_config_t channel_config = {
        .gpio_num = DISPLAY_BACKLIGHT,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = DISPLAY_BACKLIGHT_CHANNEL,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = DISPLAY_BACKLIGHT_TIMER,
        .duty = 600,
        .hpoint = 0,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer_config), TAG, "backlight timer");
    ESP_RETURN_ON_ERROR(ledc_channel_config(&channel_config), TAG, "backlight channel");
    return ledc_update_duty(LEDC_LOW_SPEED_MODE, DISPLAY_BACKLIGHT_CHANNEL);
}

static esp_err_t display_init(void)
{
    ESP_RETURN_ON_ERROR(display_power_init(), TAG, "display power");

    const spi_bus_config_t bus_config = {
        .mosi_io_num = DISPLAY_SPI_MOSI,
        .miso_io_num = GPIO_NUM_NC,
        .sclk_io_num = DISPLAY_SPI_SCLK,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(DISPLAY_SPI_HOST, &bus_config, SPI_DMA_CH_AUTO),
                        TAG, "display SPI bus");

    esp_lcd_panel_io_handle_t panel_io;
    const esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = DISPLAY_CS,
        .dc_gpio_num = DISPLAY_DC,
        .spi_mode = 0,
        .pclk_hz = 80000000,
        .trans_queue_depth = 4,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(DISPLAY_SPI_HOST, &io_config, &panel_io),
                        TAG, "display panel IO");

    ESP_RETURN_ON_ERROR(gpio_set_direction(DISPLAY_RST, GPIO_MODE_OUTPUT), TAG, "display reset GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level(DISPLAY_RST, 0), TAG, "display reset low");
    vTaskDelay(pdMS_TO_TICKS(50));
    ESP_RETURN_ON_ERROR(gpio_set_level(DISPLAY_RST, 1), TAG, "display reset high");
    vTaskDelay(pdMS_TO_TICKS(50));

    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = GPIO_NUM_NC,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .data_endian = LCD_RGB_DATA_ENDIAN_LITTLE,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(panel_io, &panel_config, &s_panel), TAG, "ST7789 panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "ST7789 init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(s_panel, true), TAG, "ST7789 invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(s_panel, true), TAG, "ST7789 on");
    return display_backlight_init();
}

static esp_err_t touch_write(uint16_t register_address, const uint8_t *data, size_t length)
{
    uint8_t buffer[3] = {
        (uint8_t)(register_address >> 8),
        (uint8_t)register_address,
        0,
    };
    if (length > 1) {
        return ESP_ERR_INVALID_SIZE;
    }
    if (length == 1) {
        buffer[2] = data[0];
    }
    return i2c_master_transmit(s_touch, buffer, 2 + length, 50);
}

static esp_err_t touch_read(uint16_t register_address, uint8_t *data, size_t length)
{
    const uint8_t command[] = {
        (uint8_t)(register_address >> 8),
        (uint8_t)register_address,
    };
    return i2c_master_transmit_receive(s_touch, command, sizeof(command), data, length, 50);
}

static esp_err_t touch_init(void)
{
    const i2c_master_bus_config_t bus_config = {
        .i2c_port = TOUCH_I2C_PORT,
        .sda_io_num = TOUCH_SDA,
        .scl_io_num = TOUCH_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t touch_bus;
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_config, &touch_bus), TAG, "touch I2C bus");

    const i2c_device_config_t touch_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TOUCH_ADDRESS,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(touch_bus, &touch_config, &s_touch), TAG, "CST328");

    ESP_RETURN_ON_ERROR(gpio_set_direction(TOUCH_RST, GPIO_MODE_OUTPUT), TAG, "touch reset GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level(TOUCH_RST, 0), TAG, "touch reset low");
    vTaskDelay(pdMS_TO_TICKS(5));
    ESP_RETURN_ON_ERROR(gpio_set_level(TOUCH_RST, 1), TAG, "touch reset high");
    vTaskDelay(pdMS_TO_TICKS(50));
    return ESP_OK;
}

static bool touch_read_point(int16_t *x, int16_t *y)
{
    uint8_t count = 0;
    uint8_t point_data[27] = {0};
    const uint8_t clear = 0;
    if (touch_read(TOUCH_REGISTER_COUNT, &count, sizeof(count)) != ESP_OK) {
        return false;
    }
    if ((count & 0x0F) == 0) {
        touch_write(TOUCH_REGISTER_COUNT, &clear, sizeof(clear));
        return false;
    }
    if (touch_read(TOUCH_REGISTER_POINTS, point_data, sizeof(point_data)) != ESP_OK) {
        return false;
    }
    touch_write(TOUCH_REGISTER_COUNT, &clear, sizeof(clear));
    *x = ((int16_t)point_data[1] << 4) | ((point_data[3] & 0xF0) >> 4);
    *y = ((int16_t)point_data[2] << 4) | (point_data[3] & 0x0F);
    return true;
}

static const char *display_page_label(uint16_t page)
{
    switch (page) {
    case 1:
        return "HOME";
    case 2:
        return "APPS";
    case 3:
        return "USAGE";
    default:
        return "PAGE";
    }
}

static void fb_fill_rect(int x, int y, int width, int height, uint16_t color)
{
    if (s_framebuffer == NULL) return;
    if (x < 0) { width += x; x = 0; }
    if (y < 0) { height += y; y = 0; }
    if (x + width > DISPLAY_WIDTH) width = DISPLAY_WIDTH - x;
    if (y + height > DISPLAY_HEIGHT) height = DISPLAY_HEIGHT - y;
    if (width <= 0 || height <= 0) return;

    for (int r = y; r < y + height; ++r) {
        uint16_t *row = &s_framebuffer[r * DISPLAY_WIDTH + x];
        for (int c = 0; c < width; ++c) {
            row[c] = color;
        }
    }
}

static void fb_draw_text(int x, int y, const char *text, uint16_t color, uint8_t scale)
{
    static const uint8_t glyphs[][5] = {
        [' '] = {0x00, 0x00, 0x00, 0x00, 0x00}, ['-'] = {0x08, 0x08, 0x08, 0x08, 0x08},
        ['.'] = {0x00, 0x60, 0x60, 0x00, 0x00}, [':'] = {0x00, 0x36, 0x36, 0x00, 0x00},
        ['/'] = {0x20, 0x10, 0x08, 0x04, 0x02},
        ['<'] = {0x08, 0x14, 0x22, 0x41, 0x00}, ['>'] = {0x41, 0x22, 0x14, 0x08, 0x00},
        ['0'] = {0x3E, 0x51, 0x49, 0x45, 0x3E}, ['1'] = {0x00, 0x42, 0x7F, 0x40, 0x00},
        ['2'] = {0x42, 0x61, 0x51, 0x49, 0x46}, ['3'] = {0x21, 0x41, 0x45, 0x4B, 0x31},
        ['4'] = {0x18, 0x14, 0x12, 0x7F, 0x10}, ['5'] = {0x27, 0x45, 0x45, 0x45, 0x39},
        ['6'] = {0x3C, 0x4A, 0x49, 0x49, 0x30}, ['7'] = {0x01, 0x71, 0x09, 0x05, 0x03},
        ['8'] = {0x36, 0x49, 0x49, 0x49, 0x36}, ['9'] = {0x06, 0x49, 0x49, 0x29, 0x1E},
        ['A'] = {0x7E, 0x11, 0x11, 0x11, 0x7E}, ['B'] = {0x7F, 0x49, 0x49, 0x49, 0x36},
        ['C'] = {0x3E, 0x41, 0x41, 0x41, 0x22}, ['D'] = {0x7F, 0x41, 0x41, 0x22, 0x1C},
        ['E'] = {0x7F, 0x49, 0x49, 0x49, 0x41}, ['F'] = {0x7F, 0x09, 0x09, 0x09, 0x01},
        ['G'] = {0x3E, 0x41, 0x49, 0x49, 0x7A}, ['H'] = {0x7F, 0x08, 0x08, 0x08, 0x7F},
        ['I'] = {0x00, 0x41, 0x7F, 0x41, 0x00}, ['J'] = {0x20, 0x40, 0x41, 0x3F, 0x01},
        ['K'] = {0x7F, 0x08, 0x14, 0x22, 0x41}, ['L'] = {0x7F, 0x40, 0x40, 0x40, 0x40},
        ['M'] = {0x7F, 0x02, 0x0C, 0x02, 0x7F}, ['N'] = {0x7F, 0x04, 0x08, 0x10, 0x7F},
        ['O'] = {0x3E, 0x41, 0x41, 0x41, 0x3E}, ['P'] = {0x7F, 0x09, 0x09, 0x09, 0x06},
        ['Q'] = {0x3E, 0x41, 0x51, 0x21, 0x5E}, ['R'] = {0x7F, 0x09, 0x19, 0x29, 0x46},
        ['S'] = {0x46, 0x49, 0x49, 0x49, 0x31}, ['T'] = {0x01, 0x01, 0x7F, 0x01, 0x01},
        ['U'] = {0x3F, 0x40, 0x40, 0x40, 0x3F}, ['V'] = {0x1F, 0x20, 0x40, 0x20, 0x1F},
        ['W'] = {0x7F, 0x20, 0x18, 0x20, 0x7F}, ['X'] = {0x63, 0x14, 0x08, 0x14, 0x63},
        ['Y'] = {0x03, 0x04, 0x78, 0x04, 0x03}, ['Z'] = {0x61, 0x51, 0x49, 0x45, 0x43},
    };
    if (s_framebuffer == NULL) return;
    for (const char *character = text; *character != '\0'; ++character) {
        unsigned char c = (unsigned char)*character;
        if (c >= 'a' && c <= 'z') {
            c = (unsigned char)(c - 'a' + 'A');
        }
        if (c >= sizeof(glyphs) / sizeof(glyphs[0]) || glyphs[c][0] == 0) {
            c = ' ';
        }
        for (int column = 0; column < 5; ++column) {
            const uint8_t bits = glyphs[c][column];
            for (int row = 0; row < 7; ++row) {
                if ((bits & (1U << row)) != 0) {
                    for (int dy = 0; dy < scale; ++dy) {
                        const int py = y + row * scale + dy;
                        if (py < 0 || py >= DISPLAY_HEIGHT) continue;
                        for (int dx = 0; dx < scale; ++dx) {
                            const int px = x + column * scale + dx;
                            if (px < 0 || px >= DISPLAY_WIDTH) continue;
                            s_framebuffer[py * DISPLAY_WIDTH + px] = color;
                        }
                    }
                }
            }
        }
        x += 6 * scale;
    }
}

static int display_text_width(const char *text, uint8_t scale)
{
    return (int)strlen(text) * 6 * scale;
}

static void fb_centered_text(int y, const char *text, uint16_t color, uint8_t scale)
{
    fb_draw_text((DISPLAY_WIDTH - display_text_width(text, scale)) / 2, y, text, color, scale);
}

static void fb_render_target(int x, uint16_t color, bool available, const char *symbol)
{
    fb_fill_rect(x, 158, 108, 142, available ? color : COLOR_MUTED);
    fb_draw_text(x + 42, 188, symbol, COLOR_TEXT, 5);
}

static void display_render(void)
{
    if (s_framebuffer == NULL) return;
    memset(s_framebuffer, 0, DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t));
    fb_centered_text(18, "OPEN DESKOS", COLOR_TEXT, 2);
    if (s_state.received) {
        char counter[STATE_COUNTER_MAX_BYTES + 1];
        snprintf(counter, sizeof(counter), "%u/%u", s_state.page, s_state.pages);
        fb_centered_text(52, display_page_label(s_state.page), COLOR_TEXT, 2);
        fb_centered_text(78, counter, COLOR_MUTED, 2);
        fb_render_target(8, COLOR_LEFT, s_state.can_prev, "<");
        fb_render_target(124, COLOR_RIGHT, s_state.can_next, ">");
    } else {
        fb_centered_text(58, "CONNECTING TO", COLOR_TEXT, 2);
        fb_centered_text(82, "OPEN DESKOS", COLOR_TEXT, 2);
        fb_centered_text(108, "WAITING FOR CDC STATE", COLOR_MUTED, 1);
        fb_render_target(8, COLOR_LEFT, false, "<");
        fb_render_target(124, COLOR_RIGHT, false, ">");
    }
    fb_centered_text(274, "SWIPE OR TAP TO NAVIGATE", COLOR_MUTED, 1);

    ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_panel, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, s_framebuffer));
}

static bool send_navigation_key(void *context, uint8_t keycode)
{
    (void)context;
    const bool allowed = keycode == HID_KEY_ARROW_LEFT ? s_state.can_prev : s_state.can_next;
    if (s_state.received && !allowed) {
        ESP_LOGW(TAG, "navigation unavailable at the reported page boundary");
        return false;
    }
    if (!tud_mounted() || !tud_hid_ready()) {
        ESP_LOGW(TAG, "HID not ready; navigation ignored");
        return false;
    }
    const uint8_t keys[6] = {keycode};
    tud_hid_keyboard_report(0, 0, keys);
    vTaskDelay(pdMS_TO_TICKS(HID_RELEASE_DELAY_MS));
    tud_hid_keyboard_report(0, 0, NULL);
    return true;
}

static bool copy_json_string(const cJSON *item, char *output, size_t output_size)
{
    if (!cJSON_IsString(item) || item->valuestring == NULL) {
        return false;
    }
    const size_t length = strlen(item->valuestring);
    if (length == 0 || length >= output_size) {
        return false;
    }
    memcpy(output, item->valuestring, length + 1);
    return true;
}

static bool json_is_positive_u16(const cJSON *item, uint16_t *value)
{
    if (!cJSON_IsNumber(item) || item->valuedouble != (double)item->valueint ||
        item->valueint < 1 || item->valueint > UINT16_MAX) {
        return false;
    }
    *value = (uint16_t)item->valueint;
    return true;
}

static bool json_is_string(const cJSON *item, const char *expected)
{
    return cJSON_IsString(item) && item->valuestring != NULL && strcmp(item->valuestring, expected) == 0;
}

static bool json_is_supported_link(const cJSON *item)
{
    return json_is_string(item, "wired") || json_is_string(item, "wireless");
}

static bool parse_state_frame(const char *line, remote_state_t *state)
{
    cJSON *json = cJSON_ParseWithLength(line, strlen(line));
    if (!cJSON_IsObject(json)) {
        cJSON_Delete(json);
        return false;
    }
    remote_state_t candidate = {0};
    const cJSON *version = cJSON_GetObjectItemCaseSensitive(json, "v");
    const cJSON *can_prev = cJSON_GetObjectItemCaseSensitive(json, "canPrev");
    const cJSON *can_next = cJSON_GetObjectItemCaseSensitive(json, "canNext");
    const bool valid = cJSON_IsNumber(version) && version->valuedouble == 1 &&
                       json_is_string(cJSON_GetObjectItemCaseSensitive(json, "type"), "state") &&
                       json_is_supported_link(cJSON_GetObjectItemCaseSensitive(json, "link")) &&
                       cJSON_IsBool(can_prev) && cJSON_IsBool(can_next) &&
                       json_is_positive_u16(cJSON_GetObjectItemCaseSensitive(json, "page"), &candidate.page) &&
                       json_is_positive_u16(cJSON_GetObjectItemCaseSensitive(json, "pages"), &candidate.pages) &&
                       copy_json_string(cJSON_GetObjectItemCaseSensitive(json, "name"),
                                        candidate.name, sizeof(candidate.name));
    candidate.can_prev = cJSON_IsTrue(can_prev);
    candidate.can_next = cJSON_IsTrue(can_next);
    const bool consistent_boundaries = candidate.page <= candidate.pages &&
                                       candidate.can_prev == (candidate.page > 1) &&
                                       candidate.can_next == (candidate.page < candidate.pages);
    cJSON_Delete(json);
    if (!valid || !consistent_boundaries) {
        return false;
    }
    candidate.received = true;
    *state = candidate;
    return true;
}

static void process_cdc_line(void)
{
    if (s_state_queue == NULL) {
        return;
    }
    if (!s_cdc_line_overflow) {
        s_cdc_line[s_cdc_line_length] = '\0';
        remote_state_t parsed_state;
        if (parse_state_frame(s_cdc_line, &parsed_state)) {
            xQueueOverwrite(s_state_queue, &parsed_state);
        } else {
            ESP_LOGW(TAG, "discarded invalid CDC state frame");
        }
    } else {
        ESP_LOGW(TAG, "discarded oversized CDC state frame");
    }
    s_cdc_line_length = 0;
    s_cdc_line_overflow = false;
}

static void cdc_receive_byte(char byte)
{
    if (byte == '\n') {
        process_cdc_line();
        return;
    }
    if (byte == '\r') {
        return;
    }
    if (s_cdc_line_length == CDC_STATE_MAX_BYTES) {
        s_cdc_line_overflow = true;
        return;
    }
    if (!s_cdc_line_overflow) {
        s_cdc_line[s_cdc_line_length++] = byte;
    }
}

static void cdc_rx_callback(int interface, cdcacm_event_t *event)
{
    (void)event;
    uint8_t buffer[64];
    size_t received = 0;
    while (tinyusb_cdcacm_read(interface, buffer, sizeof(buffer), &received) == ESP_OK && received > 0) {
        for (size_t i = 0; i < received; ++i) {
            cdc_receive_byte((char)buffer[i]);
        }
    }
}

static void usb_init(void)
{
    tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    usb_config.descriptor.full_speed_config = s_usb_configuration_descriptor;
    usb_config.descriptor.string = s_usb_string_descriptors;
    usb_config.descriptor.string_count = sizeof(s_usb_string_descriptors) / sizeof(s_usb_string_descriptors[0]);
    ESP_ERROR_CHECK(tinyusb_driver_install(&usb_config));

    const tinyusb_config_cdcacm_t cdc_config = {
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = cdc_rx_callback,
    };
    ESP_ERROR_CHECK(tinyusb_cdcacm_init(&cdc_config));
}

void app_main(void)
{
    ESP_ERROR_CHECK(display_init());
    ESP_ERROR_CHECK(touch_init());
    s_framebuffer = heap_caps_calloc(DISPLAY_WIDTH * DISPLAY_HEIGHT, sizeof(uint16_t),
                                     MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_ERROR_CHECK(s_framebuffer == NULL ? ESP_ERR_NO_MEM : ESP_OK);
    s_state_queue = xQueueCreate(1, sizeof(remote_state_t));
    ESP_ERROR_CHECK(s_state_queue == NULL ? ESP_ERR_NO_MEM : ESP_OK);
    usb_init();
    display_render();
    s_has_rendered = true;
    ESP_LOGI(TAG, "remote ready: HID keyboard plus CDC state link");

    while (true) {
        remote_state_t received_state;
        if (xQueueReceive(s_state_queue, &received_state, 0) == pdTRUE) {
            if (!s_has_rendered ||
                s_rendered_state.received != received_state.received ||
                s_rendered_state.page != received_state.page ||
                s_rendered_state.pages != received_state.pages ||
                s_rendered_state.can_prev != received_state.can_prev ||
                s_rendered_state.can_next != received_state.can_next) {
                s_state = received_state;
                s_rendered_state = received_state;
                s_has_rendered = true;
                display_render();
            }
        }
        int16_t x = 0;
        int16_t y = 0;
        if (touch_read_point(&x, &y)) {
            navigation_gesture_touch(&s_gesture, x, y, send_navigation_key, NULL);
        } else {
            navigation_gesture_release(&s_gesture, send_navigation_key, NULL);
        }
        vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_INTERVAL_MS));
    }
}
