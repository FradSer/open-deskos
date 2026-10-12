#!/usr/bin/env python3
"""Build a reviewed UAC source extension without editing managed dependencies."""
from hashlib import sha256
from pathlib import Path
import sys

REVIEWED_SHA256 = "5980c6c8445001e8728164e43a2371f9b306a005419b0f836d9b7729c26a05d5"

STATE = """
#include <stdatomic.h>
#include "freertos/event_groups.h"
static atomic_bool s_odk_uac_stopping = false;
static StaticEventGroup_t s_odk_uac_exit_storage;
static EventGroupHandle_t s_odk_uac_exits;
static EventBits_t s_odk_uac_expected;
static bool s_odk_uac_stop_started;
#define ODK_UAC_MIC_EXIT BIT0
#define ODK_UAC_SPK_EXIT BIT1
#define ODK_UAC_NOTIFIED BIT2
"""

API = """
/* The caller must stop the shared TinyUSB driver before this operation. */
esp_err_t uac_device_deinit_after_usb_stop(void)
{
    if (s_uac_device == NULL) return ESP_OK;
    if (!s_uac_device->user_cfg.skip_tinyusb_init) return ESP_ERR_NOT_SUPPORTED;
    if (!s_odk_uac_stop_started) {
        if (s_odk_uac_exits == NULL)
            s_odk_uac_exits = xEventGroupCreateStatic(&s_odk_uac_exit_storage);
        s_odk_uac_stop_started = true;
        xEventGroupClearBits(s_odk_uac_exits, ODK_UAC_MIC_EXIT | ODK_UAC_SPK_EXIT | ODK_UAC_NOTIFIED);
        s_odk_uac_expected = 0;
        if (s_uac_device->mic_task_handle) s_odk_uac_expected |= ODK_UAC_MIC_EXIT;
        if (s_uac_device->spk_task_handle) s_odk_uac_expected |= ODK_UAC_SPK_EXIT;
        atomic_store(&s_odk_uac_stopping, true);
        if (s_uac_device->mic_task_handle) xTaskNotifyGive(s_uac_device->mic_task_handle);
        if (s_uac_device->spk_task_handle) xTaskNotifyGive(s_uac_device->spk_task_handle);
        xEventGroupSetBits(s_odk_uac_exits, ODK_UAC_NOTIFIED);
    }
    if (s_odk_uac_expected) {
        EventBits_t exited = xEventGroupWaitBits(s_odk_uac_exits, s_odk_uac_expected,
                                                pdFALSE, pdTRUE, pdMS_TO_TICKS(1000));
        if ((exited & s_odk_uac_expected) != s_odk_uac_expected) return ESP_ERR_TIMEOUT;
    }
    free(s_uac_device);
    s_uac_device = NULL;
    /* Keep the initialized group: a signaller can still hold its kernel lock. */
    s_odk_uac_stop_started = false;
    s_odk_uac_expected = 0;
    return ESP_OK;
}

esp_err_t uac_device_init(uac_device_config_t *config)
{
    if (atomic_load(&s_odk_uac_stopping) && s_uac_device != NULL) return ESP_ERR_INVALID_STATE;
    if (s_uac_device == NULL) atomic_store(&s_odk_uac_stopping, false);
    return odk_uac_upstream_init(config);
}
"""


def function_end(source: str, start: int) -> int:
    """Locate a reviewed function's closing brace."""
    opening = source.index("{", start)
    depth = 0
    for index in range(opening, len(source)):
        if source[index] == "{": depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0: return index
    raise ValueError("reviewed function has no closing brace")


def generate(source_path: Path, output_path: Path) -> None:
    original = source_path.read_bytes()
    if sha256(original).hexdigest() != REVIEWED_SHA256:
        raise ValueError("UAC source does not match the reviewed lifecycle revision")
    source = original.decode("utf-8")
    source = source.replace("static uac_device_t *s_uac_device = NULL;", "static uac_device_t *s_uac_device = NULL;\n" + STATE, 1)
    for name, handle, bit in (("usb_mic_task", "mic_task_handle", "ODK_UAC_MIC_EXIT"), ("usb_spk_task", "spk_task_handle", "ODK_UAC_SPK_EXIT")):
        start = source.index("static void " + name + "(")
        end = function_end(source, start)
        body = source[start:end]
        if body.count("while (1)") != 1:
            raise ValueError("reviewed audio task loop changed")
        body = body.replace("while (1)", "while (!atomic_load(&s_odk_uac_stopping))", 1)
        source = source[:start] + body + f"    xEventGroupWaitBits(s_odk_uac_exits, ODK_UAC_NOTIFIED, pdFALSE, pdTRUE, portMAX_DELAY);\n    s_uac_device->{handle} = NULL;\n    xEventGroupSetBits(s_odk_uac_exits, {bit});\n    vTaskDelete(NULL);\n" + source[end:]
    source = source.replace("esp_err_t uac_device_init(uac_device_config_t *config)", "static esp_err_t odk_uac_upstream_init(uac_device_config_t *config)", 1)
    source = source.replace("    s_uac_device->user_cfg.output_cb = config->output_cb;", "    s_uac_device->user_cfg.skip_tinyusb_init = config->skip_tinyusb_init;\n    s_uac_device->user_cfg.output_cb = config->output_cb;", 1)
    output_path.write_text(source + API, encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extend_uac_lifecycle.py <upstream.c> <generated.c>")
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
