/*
 * odk_svc_llm.h — unified LLM request entry point + daily quota + token
 * usage accounting (Open DeskOS-OS §6.2, compensating constraints 3/4).
 *
 * Runtime LLM calls are a first-class citizen (FR-11 reversed), but every
 * call must go through this service: it is the sole choke point where the
 * daily quota is enforced and token usage/cost becomes visible. Transport
 * (HTTP), persistence (quota counters), and time (today's date) are all
 * injected as ports, never reached directly, so this header and its
 * implementation compile unchanged on the host test harness and on-target
 * (where the ports wrap esp_http_client and NVS respectively).
 */
#ifndef ODK_SVC_LLM_H
#define ODK_SVC_LLM_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "odk_err.h"

/* Real target: esp_http_client (or the forked claw_llm_http_transport).
 * Host tests: a fake that records call count and returns a canned response
 * or a simulated transport failure. body_json/resp are OpenAI-compatible
 * chat-completion request/response bodies. */
typedef struct {
    odk_err_t (*post_json)(void *ctx, const char *body_json,
                            char *resp, size_t resplen);
} odk_llm_http_port_t;

/* Real target: NVS. Host tests: an in-memory string->uint32_t map. */
typedef struct {
    bool (*get_u32)(void *ctx, const char *key, uint32_t *out);
    void (*set_u32)(void *ctx, const char *key, uint32_t v);
} odk_kv_port_t;

/* Injected, never reads the wall clock directly. */
typedef struct {
    uint32_t (*today_yyyymmdd)(void *ctx);
} odk_clock_port_t;

typedef struct {
    uint32_t in_tokens;
    uint32_t out_tokens;
} odk_llm_usage_t;

typedef struct odk_svc_llm odk_svc_llm_t;

odk_svc_llm_t *svc_llm_create(const odk_llm_http_port_t *http, void *http_ctx,
                               const odk_kv_port_t *kv, void *kv_ctx,
                               const odk_clock_port_t *clk, void *clk_ctx,
                               uint32_t daily_quota);

/* OpenAI-compatible chat-completion semantics: system+user prompt in,
 * assistant text out. Rejects the call with ODK_ERR_QUOTA_EXCEEDED before
 * ever invoking the http port when today's quota is already spent. On
 * success, usage is filled from the response and the day's request count is
 * incremented; a transport failure leaves the count untouched. */
odk_err_t svc_llm_complete(odk_svc_llm_t *s, const char *system_prompt,
                            const char *user_prompt, char *out, size_t outlen,
                            odk_llm_usage_t *usage);

uint32_t svc_llm_quota_remaining(odk_svc_llm_t *s);
uint64_t svc_llm_total_tokens_today(odk_svc_llm_t *s);

#endif /* ODK_SVC_LLM_H */
