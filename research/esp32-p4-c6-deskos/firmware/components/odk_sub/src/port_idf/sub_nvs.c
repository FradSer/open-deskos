/*
 * sub_nvs.c — odk_sub_port_t backed by NVS strings (the snapshot's
 * persistence home). ctx is the NVS namespace string. Excluded from the host
 * build (src/port_idf/).
 */
#include "odk_sub.h"

#include "nvs.h"

#define ODK_SUB_NVS_NS_DEFAULT "odk_sub"

static const char *namespace_of(void *ctx)
{
    return (ctx != NULL) ? (const char *)ctx : ODK_SUB_NVS_NS_DEFAULT;
}

static bool sub_get_str(void *ctx, const char *key, char *out, size_t outlen)
{
    if (out == NULL || outlen == 0) {
        return false;
    }
    nvs_handle_t handle;
    if (nvs_open(namespace_of(ctx), NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }
    size_t len = outlen;
    esp_err_t err = nvs_get_str(handle, key, out, &len);
    nvs_close(handle);
    return err == ESP_OK;
}

static void sub_set_str(void *ctx, const char *key, const char *value)
{
    nvs_handle_t handle;
    if (nvs_open(namespace_of(ctx), NVS_READWRITE, &handle) != ESP_OK) {
        return;
    }
    if (value[0] == '\0') {
        /* Empty value means "clear": nvs_set_str stores an empty string,
         * which the core treats as absent. */
        (void)nvs_set_str(handle, key, "");
    } else {
        (void)nvs_set_str(handle, key, value);
    }
    (void)nvs_commit(handle);
    nvs_close(handle);
}

const odk_sub_port_t odk_sub_port_idf = {
    .get_str = sub_get_str,
    .set_str = sub_set_str,
};
