#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
// USB has no Remote input or state handler in this firmware.
esp_err_t remote_radio_init(QueueHandle_t state_queue);
esp_err_t remote_radio_stop(void);
void remote_radio_poll(void);
bool remote_radio_ready(void);
void remote_radio_input(const char *json, size_t length);
