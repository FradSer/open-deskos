/*
 * kv_nvs.c — odk_kv_port_t backed by NVS (the quota counters' persistence
 * home, NFR-8). ctx is the namespace string. Excluded from the host build
 * (src/port_idf/).
 */
#include "odk_svc_llm_ports_idf.h"

#include "nvs.h"

static const char *namespace_of(void *ctx)
{
    return (ctx != NULL) ? (const char *)ctx : ODK_LLM_NVS_NAMESPACE;
}

static bool kv_get_u32(void *ctx, const char *key, uint32_t *out)
{
    nvs_handle_t handle;
    if (nvs_open(namespace_of(ctx), NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }
    esp_err_t err = nvs_get_u32(handle, key, out);
    nvs_close(handle);
    return err == ESP_OK;
}

static void kv_set_u32(void *ctx, const char *key, uint32_t v)
{
    nvs_handle_t handle;
    if (nvs_open(namespace_of(ctx), NVS_READWRITE, &handle) != ESP_OK) {
        return;
    }
    if (nvs_set_u32(handle, key, v) == ESP_OK) {
        nvs_commit(handle);
    }
    nvs_close(handle);
}

const odk_kv_port_t odk_kv_port_idf = {
    .get_u32 = kv_get_u32,
    .set_u32 = kv_set_u32,
};
