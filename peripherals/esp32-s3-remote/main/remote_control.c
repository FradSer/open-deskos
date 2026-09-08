#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "driver/usb_serial_jtag.h"
#include "font5x7.h"
#include "touchpad_gesture.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_st7789.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define DISPLAY_WIDTH 240
#define DISPLAY_HEIGHT 320
#define LCD_HOST SPI2_HOST
#define PIN_LCD_MOSI GPIO_NUM_45
#define PIN_LCD_SCLK GPIO_NUM_40
#define PIN_LCD_CS GPIO_NUM_42
#define PIN_LCD_DC GPIO_NUM_41
#define PIN_LCD_RST GPIO_NUM_39
#define PIN_LCD_BL GPIO_NUM_5
#define PIN_PWR_KEY GPIO_NUM_6
#define PIN_PWR_CTRL GPIO_NUM_7

#define PIN_TOUCH_SDA GPIO_NUM_1
#define PIN_TOUCH_SCL GPIO_NUM_3
#define PIN_TOUCH_RST GPIO_NUM_2
#define TOUCH_I2C_ADDRESS 0x1A
#define TOUCH_REGISTER_COUNT 0xD005
#define TOUCH_REGISTER_POINTS 0xD000

#define TOUCH_POLL_INTERVAL_MS 16
#define CDC_STATE_MAX_BYTES 512
#define STATE_NAME_MAX_BYTES 47
#define STATE_COUNTER_MAX_BYTES 15

#define COLOR_BG 0x0000
#define COLOR_TEXT 0xFFFF
#define COLOR_MUTED 0x7BEF
#define COLOR_DIVIDER 0x2104
#define COLOR_TOUCHPAD_BG 0x18C3
#define COLOR_TOUCHPAD_BORDER 0x39E7
#define COLOR_TOUCHPAD_CENTER 0x2124
#define COLOR_TOUCHPAD_TEXT 0xCE59
#define COLOR_BTN_BG 0x2124
#define COLOR_BTN_BORDER 0x4A69
#define COLOR_TOUCHBAR_BG 0x10A2
#define COLOR_TOUCHBAR_BTN 0x2965
#define COLOR_TOUCHBAR_BORDER 0x04FF
#define COLOR_TOUCHBAR_TEXT 0xFFFF

static const char *const TAG = "remote_s3";

typedef struct {
    bool received;
    uint16_t page;
    uint16_t pages;
    bool can_prev;
    bool can_next;
    char name[STATE_NAME_MAX_BYTES + 1];
    uint8_t action_count;
    touchbar_action_t actions[MAX_TOUCHBAR_ACTIONS];
} remote_state_t;

static esp_lcd_panel_handle_t s_panel;
static i2c_master_dev_handle_t s_touch;
static uint16_t *s_framebuffer;
static QueueHandle_t s_state_queue;
static remote_state_t s_state;
static remote_state_t s_rendered_state;
static bool s_has_rendered = false;
static touchpad_gesture_t s_touchpad;
static char s_cdc_line[CDC_STATE_MAX_BYTES + 1];
static size_t s_cdc_line_length;
static bool s_cdc_line_overflow;

static esp_err_t display_power_init(void)
{
    const gpio_config_t key_config = {
        .pin_bit_mask = 1ULL << PIN_PWR_KEY,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&key_config), TAG, "failed to configure PWR key");

    const gpio_config_t ctrl_config = {
        .pin_bit_mask = 1ULL << PIN_PWR_CTRL,
        .mode = GPIO_MODE_OUTPUT,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .pull_up_en = GPIO_PULLUP_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&ctrl_config), TAG, "failed to configure PWR ctrl");
    ESP_RETURN_ON_ERROR(gpio_set_level(PIN_PWR_CTRL, 1), TAG, "failed to latch panel power");
    return ESP_OK;
}

static esp_err_t backlight_init(void)
{
    const ledc_timer_config_t timer_config = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 20000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer_config), TAG, "failed to configure LEDC timer");

    const ledc_channel_config_t channel_config = {
        .gpio_num = PIN_LCD_BL,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0,
    };
    ESP_RETURN_ON_ERROR(ledc_channel_config(&channel_config), TAG, "failed to configure LEDC channel");
    ESP_RETURN_ON_ERROR(ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, 1023), TAG, "failed to set backlight duty");
    ESP_RETURN_ON_ERROR(ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0), TAG, "failed to update backlight duty");
    return ESP_OK;
}

static esp_err_t display_init(void)
{
    ESP_RETURN_ON_ERROR(display_power_init(), TAG, "display power init failed");

    const spi_bus_config_t bus_config = {
        .mosi_io_num = PIN_LCD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = PIN_LCD_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(LCD_HOST, &bus_config, SPI_DMA_CH_AUTO), TAG, "SPI bus init failed");

    const esp_lcd_panel_io_spi_config_t io_config = {
        .dc_gpio_num = PIN_LCD_DC,
        .cs_gpio_num = PIN_LCD_CS,
        .pclk_hz = 40 * 1000 * 1000,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .spi_mode = 0,
        .trans_queue_depth = 10,
    };
    esp_lcd_panel_io_handle_t io_handle = NULL;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &io_config, &io_handle),
                        TAG, "panel IO create failed");

    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = GPIO_NUM_NC,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .data_endian = LCD_RGB_DATA_ENDIAN_LITTLE,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(io_handle, &panel_config, &s_panel), TAG, "ST7789 create failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(s_panel), TAG, "panel reset failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "panel init failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(s_panel, true), TAG, "panel invert failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(s_panel, false), TAG, "panel swap failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(s_panel, false, false), TAG, "panel mirror failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(s_panel, true), TAG, "panel display on failed");
    ESP_RETURN_ON_ERROR(backlight_init(), TAG, "backlight init failed");
    return ESP_OK;
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
        .i2c_port = I2C_NUM_1,
        .sda_io_num = PIN_TOUCH_SDA,
        .scl_io_num = PIN_TOUCH_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t touch_bus;
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_config, &touch_bus), TAG, "touch I2C bus");

    const i2c_device_config_t touch_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TOUCH_I2C_ADDRESS,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(touch_bus, &touch_config, &s_touch), TAG, "CST328");

    ESP_RETURN_ON_ERROR(gpio_set_direction(PIN_TOUCH_RST, GPIO_MODE_OUTPUT), TAG, "touch reset GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level(PIN_TOUCH_RST, 0), TAG, "touch reset low");
    vTaskDelay(pdMS_TO_TICKS(5));
    ESP_RETURN_ON_ERROR(gpio_set_level(PIN_TOUCH_RST, 1), TAG, "touch reset high");
    vTaskDelay(pdMS_TO_TICKS(50));
    return ESP_OK;
}

static bool touch_read_point(int16_t *x, int16_t *y)
{
    if (s_touch == NULL) {
        return false;
    }
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
    return *x >= 0 && *x < DISPLAY_WIDTH && *y >= 0 && *y < DISPLAY_HEIGHT;
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

static void fb_draw_rect(int x, int y, int width, int height, uint16_t color)
{
    fb_fill_rect(x, y, width, 1, color);
    fb_fill_rect(x, y + height - 1, width, 1, color);
    fb_fill_rect(x, y, 1, height, color);
    fb_fill_rect(x + width - 1, y, 1, height, color);
}

static void fb_draw_text(int x, int y, const char *text, uint16_t color, uint8_t scale)
{
    if (s_framebuffer == NULL) return;
    for (const char *character = text; *character != '\0'; ++character) {
        const uint8_t *glyph = font5x7_get_glyph(*character);
        for (int column = 0; column < 5; ++column) {
            const uint8_t bits = glyph[column];
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

static void fb_render_button(int x, int y, int width, int height, const char *label,
                             uint16_t bg_color, uint16_t border_color, uint16_t text_color, uint8_t scale)
{
    fb_fill_rect(x, y, width, height, bg_color);
    fb_draw_rect(x, y, width, height, border_color);
    fb_draw_text(x + (width - display_text_width(label, scale)) / 2,
                 y + (height - 7 * scale) / 2, label, text_color, scale);
}

static void fb_render_touchpad(void)
{
    // Apple TV Siri Remote style Clickpad in upper display area
    fb_fill_rect(TOUCHPAD_X, TOUCHPAD_Y, TOUCHPAD_WIDTH, TOUCHPAD_HEIGHT, COLOR_TOUCHPAD_BG);
    fb_draw_rect(TOUCHPAD_X, TOUCHPAD_Y, TOUCHPAD_WIDTH, TOUCHPAD_HEIGHT, COLOR_TOUCHPAD_BORDER);

    // Cardinal direction affordances (Always available)
    fb_draw_text((DISPLAY_WIDTH - display_text_width("UP", 1)) / 2, TOUCHPAD_Y + 8, "UP", COLOR_TOUCHPAD_TEXT, 1);
    fb_draw_text((DISPLAY_WIDTH - display_text_width("DOWN", 1)) / 2, TOUCHPAD_Y + TOUCHPAD_HEIGHT - 16, "DOWN", COLOR_TOUCHPAD_TEXT, 1);
    fb_draw_text(TOUCHPAD_X + 10, TOUCHPAD_CENTER_Y - 4, "LEFT", COLOR_TOUCHPAD_TEXT, 1);
    fb_draw_text(TOUCHPAD_X + TOUCHPAD_WIDTH - 10 - display_text_width("RIGHT", 1), TOUCHPAD_CENTER_Y - 4, "RIGHT", COLOR_TOUCHPAD_TEXT, 1);

    // Center Select button
    const int select_w = 72;
    const int select_h = 56;
    const int select_x = TOUCHPAD_CENTER_X - select_w / 2;
    const int select_y = TOUCHPAD_CENTER_Y - select_h / 2;
    fb_fill_rect(select_x, select_y, select_w, select_h, COLOR_TOUCHPAD_CENTER);
    fb_draw_rect(select_x, select_y, select_w, select_h, COLOR_TOUCHPAD_BORDER);
    fb_draw_text(select_x + (select_w - display_text_width("SELECT", 1)) / 2,
                 select_y + (select_h - 7) / 2,
                 "SELECT", COLOR_TEXT, 1);
}

static void fb_render_system_buttons(void)
{
    // Middle section below touchpad: Left = Back, Right = Voice (Mic)
    fb_render_button(12, 164, 102, 44, "< BACK", COLOR_BTN_BG, COLOR_BTN_BORDER, COLOR_TEXT, 2);
    fb_render_button(126, 164, 102, 44, "MIC", COLOR_BTN_BG, COLOR_BTN_BORDER, COLOR_TEXT, 2);
}

static void fb_render_touchbar(void)
{
    // Contextual Touch Bar: Expanded lower section for plugin actions
    fb_fill_rect(TOUCHBAR_X, TOUCHBAR_Y, TOUCHBAR_WIDTH, TOUCHBAR_HEIGHT, COLOR_TOUCHBAR_BG);
    fb_draw_rect(TOUCHBAR_X, TOUCHBAR_Y, TOUCHBAR_WIDTH, TOUCHBAR_HEIGHT, COLOR_DIVIDER);

    if (s_state.action_count == 0) {
        fb_draw_text((DISPLAY_WIDTH - display_text_width("TOUCH BAR", 1)) / 2,
                     TOUCHBAR_Y + (TOUCHBAR_HEIGHT - 7) / 2,
                     "TOUCH BAR", COLOR_MUTED, 1);
        return;
    }

    const int count = s_state.action_count;
    const int gap = 4;
    const int total_content_w = TOUCHBAR_WIDTH - 8;
    const int btn_w = (total_content_w - (count - 1) * gap) / count;

    for (int i = 0; i < count; ++i) {
        const int bx = TOUCHBAR_X + 4 + i * (btn_w + gap);
        const int by = TOUCHBAR_Y + 4;
        const int bh = TOUCHBAR_HEIGHT - 8;
        const char *label = s_state.actions[i].label;
        uint8_t scale = 1;
        if (display_text_width(label, 2) <= btn_w - 6) {
            scale = 2;
        }
        fb_render_button(bx, by, btn_w, bh, label, COLOR_TOUCHBAR_BTN,
                         COLOR_TOUCHBAR_BORDER, COLOR_TOUCHBAR_TEXT, scale);
    }
}

static void display_render(void)
{
    if (s_framebuffer == NULL) return;
    memset(s_framebuffer, 0, DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t));

    // Section 1: Apple TV Touchpad (Clickpad with Up/Down/Left/Right always available)
    fb_render_touchpad();

    // Section 2: Fixed System buttons (Back & Voice)
    fb_render_system_buttons();

    // Section 3: Contextual Touch Bar (Expanded area for active page/plugin actions)
    fb_render_touchbar();

    ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_panel, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, s_framebuffer));
}

static bool send_touchpad_input(void *context, remote_input_t input, const char *action_id)
{
    (void)context;
    static const char *const input_names[] = {
        [REMOTE_INPUT_LEFT] = "left",
        [REMOTE_INPUT_RIGHT] = "right",
        [REMOTE_INPUT_UP] = "up",
        [REMOTE_INPUT_DOWN] = "down",
        [REMOTE_INPUT_PRIMARY] = "primary",
        [REMOTE_INPUT_SECONDARY] = "secondary",
        [REMOTE_INPUT_BACK] = "back",
        [REMOTE_INPUT_MIC] = "mic",
    };
    char line[96];
    int written = 0;
    if (input == REMOTE_INPUT_ACTION && action_id != NULL) {
        written = snprintf(line, sizeof(line),
                           "{\"v\":1,\"type\":\"input\",\"input\":\"action\",\"action\":\"%s\"}\n",
                           action_id);
    } else if (input < sizeof(input_names) / sizeof(input_names[0]) && input_names[input] != NULL) {
        written = snprintf(line, sizeof(line),
                           "{\"v\":1,\"type\":\"input\",\"input\":\"%s\"}\n",
                           input_names[input]);
    } else {
        return false;
    }
    if (written < 0 || (size_t)written >= sizeof(line)) return false;
    const int queued = usb_serial_jtag_write_bytes(line, (size_t)written, 0);
    if (queued != written) {
        ESP_LOGW(TAG, "USB Serial/JTAG input queue incomplete");
        return false;
    }
    return usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(20)) == ESP_OK;
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
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(json, "mode");
    const cJSON *actions = cJSON_GetObjectItemCaseSensitive(json, "actions");
    const bool valid_mode = mode == NULL || json_is_string(mode, "browse") || json_is_string(mode, "focus");
    bool valid_actions = true;
    if (actions != NULL) {
        if (!cJSON_IsArray(actions)) {
            valid_actions = false;
        } else {
            const int count = cJSON_GetArraySize(actions);
            for (int i = 0; i < count && i < MAX_TOUCHBAR_ACTIONS; ++i) {
                const cJSON *item = cJSON_GetArrayItem(actions, i);
                if (!cJSON_IsObject(item)) {
                    valid_actions = false;
                    break;
                }
                const cJSON *id = cJSON_GetObjectItemCaseSensitive(item, "id");
                if (id == NULL) id = cJSON_GetObjectItemCaseSensitive(item, "action");
                const cJSON *label = cJSON_GetObjectItemCaseSensitive(item, "label");
                if (label == NULL) label = cJSON_GetObjectItemCaseSensitive(item, "name");
                if (!cJSON_IsString(id) || id->valuestring == NULL || strlen(id->valuestring) == 0 ||
                    !cJSON_IsString(label) || label->valuestring == NULL || strlen(label->valuestring) == 0) {
                    valid_actions = false;
                    break;
                }
                copy_json_string(id, candidate.actions[candidate.action_count].id, sizeof(candidate.actions[0].id));
                copy_json_string(label, candidate.actions[candidate.action_count].label, sizeof(candidate.actions[0].label));
                candidate.action_count++;
            }
        }
    }
    const bool valid = cJSON_IsNumber(version) && version->valuedouble == 1 &&
                       json_is_string(cJSON_GetObjectItemCaseSensitive(json, "type"), "state") &&
                       json_is_supported_link(cJSON_GetObjectItemCaseSensitive(json, "link")) &&
                       valid_mode && valid_actions && cJSON_IsBool(can_prev) && cJSON_IsBool(can_next) &&
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

static void usb_init(void)
{
    usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));
}

static void receive_state_records(void)
{
    uint8_t buffer[64];
    const int received = usb_serial_jtag_read_bytes(buffer, sizeof(buffer), 0);
    for (int i = 0; i < received; ++i) {
        cdc_receive_byte((char)buffer[i]);
    }
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
    touchpad_gesture_init(&s_touchpad);
    usb_init();
    display_render();
    s_has_rendered = true;
    ESP_LOGI(TAG, "remote ready: Apple TV style Touchpad with contextual Touch Bar");

    while (true) {
        remote_state_t received_state;
        if (xQueueReceive(s_state_queue, &received_state, 0) == pdTRUE) {
            bool state_changed = !s_has_rendered ||
                s_rendered_state.received != received_state.received ||
                s_rendered_state.page != received_state.page ||
                s_rendered_state.pages != received_state.pages ||
                s_rendered_state.can_prev != received_state.can_prev ||
                s_rendered_state.can_next != received_state.can_next ||
                s_rendered_state.action_count != received_state.action_count ||
                strcmp(s_rendered_state.name, received_state.name) != 0;
            if (!state_changed) {
                for (uint8_t i = 0; i < received_state.action_count; ++i) {
                    if (strcmp(s_rendered_state.actions[i].id, received_state.actions[i].id) != 0 ||
                        strcmp(s_rendered_state.actions[i].label, received_state.actions[i].label) != 0) {
                        state_changed = true;
                        break;
                    }
                }
            }
            if (state_changed) {
                s_state = received_state;
                s_rendered_state = received_state;
                touchpad_gesture_set_actions(&s_touchpad, s_state.action_count, s_state.actions);
                s_has_rendered = true;
                display_render();
            }
        }
        receive_state_records();
        int16_t x = 0;
        int16_t y = 0;
        const uint32_t now_ms = (uint32_t)(esp_timer_get_time() / 1000);
        if (touch_read_point(&x, &y)) {
            touchpad_gesture_touch(&s_touchpad, x, y, now_ms, send_touchpad_input, &s_touchpad);
        } else {
            touchpad_gesture_release(&s_touchpad, now_ms, send_touchpad_input, &s_touchpad);
        }
        vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_INTERVAL_MS));
    }
}
