/*
 * llm_http_idf.c — odk_llm_http_port_t backed by esp_http_client with the
 * bundled X.509 CA store (esp_crt_bundle). POSTs an OpenAI-compatible chat
 * body to the NVS-configured endpoint with a bearer key and copies the
 * response body back. This is an ordinary HTTPS client, not esp_https_ota:
 * NFR-10 (no OTA in the app-platform path) is untouched. Excluded from the
 * host build (src/port_idf/).
 */
#include "odk_svc_llm_ports_idf.h"

#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "nvs.h"

#define LLM_HTTP_TIMEOUT_MS 30000
#define LLM_AUTH_HEADER_BUF 200

static const char *TAG = "odk_llm_http";

odk_err_t odk_llm_http_idf_ctx_init(odk_llm_http_idf_ctx_t *ctx)
{
    memset(ctx, 0, sizeof(*ctx));

    nvs_handle_t handle;
    if (nvs_open(ODK_LLM_NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        ESP_LOGW(TAG, "NVS namespace '%s' absent; LLM endpoint/key unconfigured", ODK_LLM_NVS_NAMESPACE);
        return ODK_ERR_HTTP;
    }
    size_t endpoint_len = sizeof(ctx->endpoint);
    esp_err_t e_endpoint = nvs_get_str(handle, "llm_endpoint", ctx->endpoint, &endpoint_len);
    size_t key_len = sizeof(ctx->api_key);
    esp_err_t e_key = nvs_get_str(handle, "llm_api_key", ctx->api_key, &key_len);
    size_t model_len = sizeof(ctx->model);
    if (nvs_get_str(handle, "llm_model", ctx->model, &model_len) != ESP_OK) {
        ctx->model[0] = '\0';
    }
    nvs_close(handle);

    if (e_endpoint != ESP_OK || e_key != ESP_OK || ctx->endpoint[0] == '\0') {
        ESP_LOGW(TAG, "LLM endpoint/key not set in NVS; gen will report a transport error until configured");
        return ODK_ERR_HTTP;
    }
    ESP_LOGI(TAG, "LLM endpoint ready (%s)%s%s",
             ctx->endpoint,
             ctx->model[0] ? " model=" : "",
             ctx->model[0] ? ctx->model : "");
    return ODK_OK;
}

static odk_err_t llm_post_json(void *ctx, const char *body_json, char *resp, size_t resplen)
{
    odk_llm_http_idf_ctx_t *c = ctx;
    if (resp != NULL && resplen > 0) {
        resp[0] = '\0';
    }
    if (c == NULL || c->endpoint[0] == '\0') {
        return ODK_ERR_HTTP;
    }

    esp_http_client_config_t cfg = {
        .url = c->endpoint,
        .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = LLM_HTTP_TIMEOUT_MS,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (client == NULL) {
        return ODK_ERR_HTTP;
    }

    char auth[LLM_AUTH_HEADER_BUF];
    snprintf(auth, sizeof(auth), "Bearer %s", c->api_key);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "Authorization", auth);

    odk_err_t result = ODK_OK;
    size_t body_len = strlen(body_json);
    if (esp_http_client_open(client, body_len) != ESP_OK) {
        esp_http_client_cleanup(client);
        return ODK_ERR_HTTP;
    }
    if (esp_http_client_write(client, body_json, body_len) < 0) {
        result = ODK_ERR_HTTP;
        goto done;
    }
    if (esp_http_client_fetch_headers(client) < 0) {
        result = ODK_ERR_HTTP;
        goto done;
    }
    int status = esp_http_client_get_status_code(client);
    if (status < 200 || status >= 300) {
        ESP_LOGW(TAG, "LLM endpoint returned HTTP %d", status);
        result = ODK_ERR_HTTP;
        goto done;
    }

    size_t total = 0;
    while (resplen > 0 && total + 1 < resplen) {
        int r = esp_http_client_read(client, resp + total, (int)(resplen - 1 - total));
        if (r <= 0) {
            break;
        }
        total += (size_t)r;
    }
    if (resp != NULL && resplen > 0) {
        resp[total] = '\0';
    }

done:
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return result;
}

const odk_llm_http_port_t odk_llm_http_port_idf = {
    .post_json = llm_post_json,
};
