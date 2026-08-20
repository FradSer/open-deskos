/*
 * host_llm.c — host-side LLM port impl for the native sim.
 *
 * Wires svc_llm's three injected ports to real host resources so the
 * "AI generates Lua -> runs as UI" link (odk_voice_ui_run on device) works
 * on the sim against a real OpenAI-compatible endpoint:
 *   - odk_llm_http_port_t.post_json: libcurl POST to the CLIProxyAPI
 *   - odk_kv_port_t: in-memory u32 map (quota counters; no NVS on host)
 *   - odk_clock_port_t: local wall-clock date (for daily quota rollover)
 *
 * The endpoint, model, and key are compiled-in defaults matching the
 * firmware's ODK_LLM_DEBUG_MODE (see main.c) but overridable via env:
 *   ODK_SIM_LLM_URL (default http://10.10.0.195:8317/v1/chat/completions)
 *   ODK_SIM_LLM_KEY (default sk-dummy)
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>   /* sleep() for 429 backoff */

#include <curl/curl.h>
#include <cJSON.h>

#include "odk_svc_llm.h"
#include "odk_err.h"

static const char *TAG = "host_llm";

#define DEFAULT_URL "http://10.10.0.195:8317/v1/chat/completions"
#define DEFAULT_KEY "sk-dummy"

/* ---- curl write callback: append resp into a growing buffer ---- */
struct resp_buf {
    char  *data;
    size_t size;
    size_t cap;
};

static size_t curl_write_cb(char *ptr, size_t size, size_t nmemb, void *ud)
{
    struct resp_buf *rb = (struct resp_buf *)ud;
    size_t bytes = size * nmemb;
    if (rb->size + bytes + 1 > rb->cap) {
        size_t ncap = rb->cap ? rb->cap * 2 : 4096;
        while (ncap < rb->size + bytes + 1) ncap *= 2;
        char *nd = (char *)realloc(rb->data, ncap);
        if (!nd) return 0; /* signal OOM to curl */
        rb->data = nd;
        rb->cap = ncap;
    }
    memcpy(rb->data + rb->size, ptr, bytes);
    rb->size += bytes;
    rb->data[rb->size] = '\0';
    return bytes;
}

/* ---- odk_llm_http_port_t: post_json ---- */
static odk_err_t host_llm_post_json(void *ctx, const char *body_json,
                                     char *resp, size_t resplen)
{
    (void)ctx;

    /* glm-5.2 is a reasoning model; with the full voice-UI system prompt it
     * thinks 2-5 min before emitting the body (reasoning_tokens dominate),
     * which blows past any sane HTTP timeout. Inject `thinking:{type:disabled}`
     * into the request body so the host sim gets fast non-reasoning responses
     * (verified: same prompt drops from >180s to ~2s). The device path is
     * unaffected — it uses its own port, not this one. Override off with
     * ODK_SIM_LLM_REASONING=1 if you want reasoning output. */
    const char *final_body = body_json;
    char *injected_body = NULL;
    const char *want_reasoning = getenv("ODK_SIM_LLM_REASONING");
    if (!want_reasoning || want_reasoning[0] == '\0' || strstr(want_reasoning, "1") != want_reasoning) {
        cJSON *root = cJSON_Parse(body_json);
        if (root) {
            if (!cJSON_GetObjectItem(root, "thinking")) {
                cJSON *thinking = cJSON_CreateObject();
                cJSON_AddStringToObject(thinking, "type", "disabled");
                cJSON_AddItemToObject(root, "thinking", thinking);
                injected_body = cJSON_PrintUnformatted(root);
                if (injected_body) final_body = injected_body;
            }
            cJSON_Delete(root);
        }
        if (!injected_body) final_body = body_json; /* parse failed: send as-is */
    }

    CURL *curl = curl_easy_init();
    if (!curl) {
        fprintf(stderr, "[host_llm] curl init failed\n");
        free(injected_body);
        return ODK_ERR_HTTP;
    }

    const char *url = getenv("ODK_SIM_LLM_URL");
    if (!url || !url[0]) url = DEFAULT_URL;
    const char *key = getenv("ODK_SIM_LLM_KEY");
    if (!key || !key[0]) key = DEFAULT_KEY;

    char auth_hdr[128];
    snprintf(auth_hdr, sizeof(auth_hdr), "Authorization: Bearer %s", key);
    struct curl_slist *hdrs = NULL;
    hdrs = curl_slist_append(hdrs, "Content-Type: application/json");
    hdrs = curl_slist_append(hdrs, auth_hdr);

    /* Retry on 429 (insufficient_quota / rate limit) — the upstream model
     * studio quota resets per-window, so backing off usually succeeds. */
    odk_err_t err = ODK_ERR_HTTP;
    for (int attempt = 0; attempt < 4; attempt++) {
        struct resp_buf rb = {0};
        curl_easy_setopt(curl, CURLOPT_URL, url);
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, final_body);
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write_cb);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &rb);
        /* With reasoning disabled the model returns in a few seconds; keep a
         * generous cap for safety. (If reasoning is re-enabled via env, raise.) */
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 120L);
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 8L);

        CURLcode rc = curl_easy_perform(curl);
        if (rc != CURLE_OK) {
            fprintf(stderr, "[host_llm] curl failed: %s (url=%s)\n",
                    curl_easy_strerror(rc), url);
            free(rb.data);
            break;
        }
        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        if (http_code == 200 && rb.data) {
            snprintf(resp, resplen, "%s", rb.data);
            err = ODK_OK;
            free(rb.data);
            break;
        }
        if (http_code == 429 && attempt < 3) {
            int backoff = 3 * (attempt + 1);  /* 3s, 6s, 9s */
            fprintf(stderr, "[host_llm] HTTP 429 (quota/rate), retry %d/3 in %ds\n",
                    attempt + 1, backoff);
            free(rb.data);
            sleep(backoff);
            continue;
        }
        fprintf(stderr, "[host_llm] HTTP %ld (url=%s)\n", http_code, url);
        if (rb.data) fprintf(stderr, "[host_llm] body: %.400s\n", rb.data);
        free(rb.data);
        break;
    }

    curl_slist_free_all(hdrs);
    free(injected_body);
    curl_easy_cleanup(curl);
    return err;
}

const odk_llm_http_port_t host_llm_http_port = {
    .post_json = host_llm_post_json,
};

/* ---- odk_kv_port_t: in-memory u32 map ---- */
struct kv_node {
    char key[64];
    uint32_t val;
    struct kv_node *next;
};
static struct kv_node *s_kv_head;

static bool host_kv_get_u32(void *ctx, const char *key, uint32_t *out)
{
    (void)ctx;
    for (struct kv_node *n = s_kv_head; n; n = n->next) {
        if (strcmp(n->key, key) == 0) { *out = n->val; return true; }
    }
    return false;
}
static void host_kv_set_u32(void *ctx, const char *key, uint32_t v)
{
    (void)ctx;
    for (struct kv_node *n = s_kv_head; n; n = n->next) {
        if (strcmp(n->key, key) == 0) { n->val = v; return; }
    }
    struct kv_node *n = (struct kv_node *)calloc(1, sizeof(*n));
    if (!n) return;
    snprintf(n->key, sizeof(n->key), "%s", key);
    n->val = v;
    n->next = s_kv_head;
    s_kv_head = n;
}
const odk_kv_port_t host_llm_kv_port = {
    .get_u32 = host_kv_get_u32,
    .set_u32 = host_kv_set_u32,
};

/* ---- odk_clock_port_t: local date as yyyymmdd ---- */
static uint32_t host_clock_today(void *ctx)
{
    (void)ctx;
    time_t t = time(NULL);
    struct tm tmv;
    localtime_r(&t, &tmv);
    return (uint32_t)((tmv.tm_year + 1900) * 10000 + (tmv.tm_mon + 1) * 100 + tmv.tm_mday);
}
const odk_clock_port_t host_llm_clock_port = {
    .today_yyyymmdd = host_clock_today,
};
