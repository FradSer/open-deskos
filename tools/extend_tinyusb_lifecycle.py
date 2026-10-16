#!/usr/bin/env python3
"""Build reviewed TinyUSB sources with serialized, cooperative plugin cleanup."""
from hashlib import sha256
from pathlib import Path
import sys

REVIEWED = {
    'tinyusb_task.c': '7070f0b54939559ab67b70a96c404223cd2696ba68b108934620e12a64d590f2',
    'tinyusb.c': '6625125a45f4b7f78a38739041dc919c9ed31c8b633d9e8b0cf36f242dff7468',
    'usbd.c': 'dbae656d1a0e034c0553490e7c30473baea16999f40b7468277b5fc832d50740',
}
STATE = """
#include <stdatomic.h>
#include "freertos/event_groups.h"
static atomic_bool s_odk_usb_stopping;
static StaticEventGroup_t s_odk_usb_event_storage;
static EventGroupHandle_t s_odk_usb_events;
#define ODK_USB_READY BIT0
#define ODK_USB_EXIT BIT1
bool p4_tinyusb_stopping(void) { return atomic_load(&s_odk_usb_stopping); }
"""
WORKER = """
static void tinyusb_device_task(void *arg)
{
    tinyusb_task_ctx_t *task_ctx = arg;
    assert(task_ctx != NULL);
    task_ctx->start_status = ESP_ERR_INVALID_STATE;
    if (tud_inited()) goto ready;
    task_ctx->start_status = tinyusb_descriptors_set(task_ctx->rhport, &task_ctx->desc_cfg);
    if (task_ctx->start_status != ESP_OK) goto ready;
    task_ctx->descriptors_owned = true;
    task_ctx->stack_owned = true;
    if (!tusb_rhport_init(task_ctx->rhport, &task_ctx->rhport_init)) {
        task_ctx->stack_failed = true;
        task_ctx->start_status = ESP_ERR_NOT_FINISHED;
        goto ready;
    }
    task_ctx->start_status = ESP_OK;
ready:
    xEventGroupSetBits(s_odk_usb_events, ODK_USB_READY);
    if (task_ctx->start_status == ESP_OK) {
        while (!p4_tinyusb_stopping()) tud_task_ext(100, false);
    }
    /* The context has no worker users after this signal. Keep the event group alive. */
    xEventGroupSetBits(s_odk_usb_events, ODK_USB_EXIT);
    vTaskDelete(NULL);
}
"""
START = """
esp_err_t tinyusb_task_start(tinyusb_port_t port, const tinyusb_task_config_t *config, const tinyusb_desc_config_t *desc_cfg)
{
    ESP_RETURN_ON_ERROR(tinyusb_descriptors_check(port, desc_cfg), TAG, "TinyUSB descriptors check failed");
    TINYUSB_TASK_ENTER_CRITICAL();
    TINYUSB_TASK_CHECK_FROM_CRIT(p_tusb_task_ctx == NULL && !_task_is_running, ESP_ERR_INVALID_STATE);
    _task_is_running = true;
    TINYUSB_TASK_EXIT_CRITICAL();
    tinyusb_task_ctx_t *task_ctx = heap_caps_calloc(1, sizeof(*task_ctx), MALLOC_CAP_DEFAULT);
    if (task_ctx == NULL) {
        TINYUSB_TASK_ENTER_CRITICAL();
        _task_is_running = false;
        TINYUSB_TASK_EXIT_CRITICAL();
        return ESP_ERR_NO_MEM;
    }
    if (s_odk_usb_events == NULL) s_odk_usb_events = xEventGroupCreateStatic(&s_odk_usb_event_storage);
    xEventGroupClearBits(s_odk_usb_events, ODK_USB_READY | ODK_USB_EXIT);
    atomic_store(&s_odk_usb_stopping, false);
    task_ctx->rhport = port;
    task_ctx->rhport_init.role = TUSB_ROLE_DEVICE;
#if CONFIG_IDF_TARGET_ESP32S31
    task_ctx->rhport_init.speed = TUSB_SPEED_HIGH;
#else
    task_ctx->rhport_init.speed = port == TINYUSB_PORT_FULL_SPEED_0 ? TUSB_SPEED_FULL : TUSB_SPEED_HIGH;
#endif
    task_ctx->desc_cfg = *desc_cfg;
    task_ctx->start_status = ESP_ERR_TIMEOUT;
    TINYUSB_TASK_ENTER_CRITICAL();
    p_tusb_task_ctx = task_ctx;
    TINYUSB_TASK_EXIT_CRITICAL();
    if (xTaskCreatePinnedToCore(tinyusb_device_task, "TinyUSB", config->size, task_ctx,
                                config->priority, &task_ctx->handle, config->xCoreID) != pdPASS) {
        return ESP_ERR_NOT_FINISHED;
    }
    const EventBits_t ready = xEventGroupWaitBits(s_odk_usb_events, ODK_USB_READY,
                                                pdFALSE, pdTRUE, pdMS_TO_TICKS(5000));
    if (!(ready & ODK_USB_READY)) {
        atomic_store(&s_odk_usb_stopping, true);
        return ESP_ERR_TIMEOUT;
    }
    return task_ctx->start_status;
}
"""
STOP = """
esp_err_t tinyusb_task_stop(void)
{
    TINYUSB_TASK_ENTER_CRITICAL();
    tinyusb_task_ctx_t *task_ctx = p_tusb_task_ctx;
    TINYUSB_TASK_EXIT_CRITICAL();
    if (task_ctx == NULL) return ESP_OK;
    atomic_store(&s_odk_usb_stopping, true);
    if (task_ctx->handle != NULL) {
        const EventBits_t exited = xEventGroupWaitBits(s_odk_usb_events, ODK_USB_EXIT,
                                                      pdFALSE, pdTRUE, pdMS_TO_TICKS(1000));
        if (!(exited & ODK_USB_EXIT)) return ESP_ERR_TIMEOUT;
        task_ctx->handle = NULL;
    }
    if (task_ctx->stack_owned) {
        /* The SDK cannot discover resources allocated before its initialized flag. */
        if (task_ctx->stack_failed && !tud_inited()) return ESP_ERR_NOT_FINISHED;
        ESP_RETURN_ON_FALSE(tusb_deinit(task_ctx->rhport), ESP_ERR_NOT_FINISHED, TAG, "Unable to teardown TinyUSB stack");
        task_ctx->stack_owned = false;
    }
    if (task_ctx->descriptors_owned) {
        tinyusb_descriptors_free();
        task_ctx->descriptors_owned = false;
    }
    TINYUSB_TASK_ENTER_CRITICAL();
    p_tusb_task_ctx = NULL;
    _task_is_running = false;
    TINYUSB_TASK_EXIT_CRITICAL();
    heap_caps_free(task_ctx);
    return ESP_OK;
}
"""


def replace_function(source: str, name: str, replacement: str) -> str:
    marker = source.index(name + '(')
    start = source.rfind('\n', 0, marker) + 1
    opening = source.index('{', marker)
    depth = 0
    for end in range(opening, len(source)):
        if source[end] == '{': depth += 1
        elif source[end] == '}':
            depth -= 1
            if depth == 0: return source[:start] + replacement.strip() + source[end+1:]
    raise ValueError('Reviewed function has no closing brace: ' + name)


def generate(wrapper_dir: Path, core_dir: Path, output_dir: Path) -> None:
    sources: dict[str, str] = {}
    for name, expected in REVIEWED.items():
        source = (core_dir if name == 'usbd.c' else wrapper_dir) / name
        original = source.read_bytes()
        if sha256(original).hexdigest() != expected:
            raise ValueError('TinyUSB source does not match the reviewed lifecycle revision: ' + name)
        sources[name] = original.decode('utf-8')
    task = sources['tinyusb_task.c']
    task = task.replace('const tinyusb_desc_config_t *desc_cfg;', 'tinyusb_desc_config_t desc_cfg;', 1)
    task = task.replace('} tinyusb_task_ctx_t;', '    esp_err_t start_status;\n    bool descriptors_owned;\n    bool stack_owned;\n    bool stack_failed;\n} tinyusb_task_ctx_t;', 1)
    task = task.replace('static bool _task_is_running', STATE + '\nstatic bool _task_is_running', 1)
    for name, replacement in (('tinyusb_device_task', WORKER), ('tinyusb_task_start', START), ('tinyusb_task_stop', STOP)):
        task = replace_function(task, name, replacement)
    driver = sources['tinyusb.c']
    driver = driver.replace('static tinyusb_ctx_t s_ctx;', 'static bool s_odk_driver_owned;\nstatic tinyusb_ctx_t s_ctx;', 1)
    driver = driver.replace('    esp_err_t ret;\n    usb_phy_handle_t phy_hdl', '    ESP_RETURN_ON_FALSE(!s_odk_driver_owned, ESP_ERR_INVALID_STATE, TAG, "USB driver still owns resources");\n    esp_err_t ret;\n    usb_phy_handle_t phy_hdl', 1)
    driver = driver.replace('    // Init TinyUSB stack in task', '    s_odk_driver_owned = true;\n    s_ctx.port = config->port;\n    s_ctx.phy_hdl = phy_hdl;\n    s_ctx.event_cb = config->event_cb;\n    s_ctx.event_arg = config->event_arg;\n    // Init TinyUSB stack in task', 1)
    driver = driver.replace('            tinyusb_task_stop();\n            goto del_phy;', '            goto del_phy;', 1)
    driver = driver.replace('del_phy:\n    if (!config->phy.skip_setup) {\n        usb_del_phy(phy_hdl);\n    }\n    return ret;', 'del_phy:\n    /* Failed cleanup retains driver ownership for an explicit retry. */\n    (void)tinyusb_driver_uninstall();\n    return ret;', 1)
    driver = driver.replace('esp_err_t tinyusb_driver_uninstall(void)\n{', 'esp_err_t tinyusb_driver_uninstall(void)\n{\n    if (!s_odk_driver_owned) return ESP_OK;', 1)
    driver = driver.replace('    return ESP_OK;\n}\n\nesp_err_t tinyusb_remote_wakeup', '    s_odk_driver_owned = false;\n    return ESP_OK;\n}\n\nesp_err_t tinyusb_remote_wakeup', 1)
    core = sources['usbd.c']
    core = core.replace('void tud_task_ext(uint32_t timeout_ms, bool in_isr) {', 'extern bool p4_tinyusb_stopping(void);\nvoid tud_task_ext(uint32_t timeout_ms, bool in_isr) {', 1)
    core = core.replace('  // Loop until there is no more events in the queue\n  while (1) {', '  // Preserve each event; check plugin cancellation between callbacks.\n  while (!p4_tinyusb_stopping()) {', 1)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, source in (('odk_tinyusb_task.c', task), ('odk_tinyusb.c', driver), ('odk_usbd.c', core)):
        (output_dir / name).write_text(source, encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: extend_tinyusb_lifecycle.py <wrapper-dir> <core-device-dir> <output-dir>')
    generate(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
