/* SPDX-License-Identifier: Apache-2.0 */
#include "p4_video_lifecycle.h"
#include "freertos/portmacro.h"
#include "freertos/task.h"

#define P4_VIDEO_RECEIVER_COUNT 16
#define P4_VIDEO_CANCEL_WAIT_MS 100
static struct {
    void *device;
    atomic_bool *running;
} s_receivers[P4_VIDEO_RECEIVER_COUNT];
static portMUX_TYPE s_receiver_lock = portMUX_INITIALIZER_UNLOCKED;

esp_err_t p4_video_bind_receiver(void *device, atomic_bool *running)
{
    if (device == NULL) return ESP_ERR_INVALID_ARG;
    esp_err_t result = ESP_ERR_NO_MEM;
    portENTER_CRITICAL_SAFE(&s_receiver_lock);
    int empty = -1;
    for (int i = 0; i < P4_VIDEO_RECEIVER_COUNT; ++i) {
        if (s_receivers[i].device == device) {
            s_receivers[i].running = running;
            if (running == NULL) s_receivers[i].device = NULL;
            result = ESP_OK;
            goto done;
        }
        if (s_receivers[i].device == NULL && empty < 0) empty = i;
    }
    if (running == NULL) result = ESP_OK;
    else if (empty >= 0) {
        s_receivers[empty].device = device;
        s_receivers[empty].running = running;
        result = ESP_OK;
    }
done:
    portEXIT_CRITICAL_SAFE(&s_receiver_lock);
    return result;
}

atomic_bool *p4_video_receiver_flag(void *device)
{
    atomic_bool *running = NULL;
    portENTER_CRITICAL_SAFE(&s_receiver_lock);
    for (int i = 0; i < P4_VIDEO_RECEIVER_COUNT; ++i) {
        if (s_receivers[i].device == device) {
            running = s_receivers[i].running;
            break;
        }
    }
    portEXIT_CRITICAL_SAFE(&s_receiver_lock);
    return running;
}

BaseType_t p4_video_receive_wait(SemaphoreHandle_t ready, TickType_t ticks, atomic_bool *running)
{
    if (running == NULL) return xSemaphoreTake(ready, ticks);
    const TickType_t start = xTaskGetTickCount();
    const TickType_t interval = pdMS_TO_TICKS(P4_VIDEO_CANCEL_WAIT_MS) > 0
        ? pdMS_TO_TICKS(P4_VIDEO_CANCEL_WAIT_MS) : 1;
    while (atomic_load(running)) {
        TickType_t wait = interval;
        if (ticks != portMAX_DELAY) {
            const TickType_t elapsed = xTaskGetTickCount() - start;
            const TickType_t remaining = elapsed >= ticks ? 0 : ticks - elapsed;
            if (wait > remaining) wait = remaining;
        }
        const BaseType_t result = xSemaphoreTake(ready, wait);
        if (!atomic_load(running)) return pdFALSE;
        if (result == pdTRUE) return pdTRUE;
        if (ticks != portMAX_DELAY && xTaskGetTickCount() - start >= ticks) return pdFALSE;
    }
    return pdFALSE;
}
