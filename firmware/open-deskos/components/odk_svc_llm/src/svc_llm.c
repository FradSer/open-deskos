/*
 * svc_llm.c — sole entry point for runtime LLM calls: daily request quota
 * (persisted via the injected kv port) and token usage accounting
 * (Open DeskOS-OS §6.2, compensating constraints 3/4).
 *
 * The kv-persisted keys "llm_used_day" and "llm_used_count" are the
 * cross-process persistence contract: the day the count belongs to, and the
 * number of requests served that day. Token totals are not persisted (no
 * cost requirement to survive a reboot); they accrue in memory and reset
 * together with the day.
 */
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

#include "odk_svc_llm.h"

#define LLM_USED_DAY_KEY "llm_used_day"
#define LLM_USED_COUNT_KEY "llm_used_count"

/* OpenAI-compatible chat body. Model is required by LAN proxies such as
 * CLIProxyAPI; override at compile time if needed. */
#ifndef ODK_LLM_CHAT_MODEL
#define ODK_LLM_CHAT_MODEL "glm-5.2"
#endif

/* Generous upper bound for an OpenAI-compatible chat-completion response
 * body; heap-allocated rather than stacked to keep the call's stack frame
 * small. Reasoning models can return large reasoning_content fields. */
#define LLM_HTTP_RESP_BUF_LEN 32768

struct odk_svc_llm {
    const odk_llm_http_port_t *http;
    void *http_ctx;
    const odk_kv_port_t *kv;
    void *kv_ctx;
    const odk_clock_port_t *clk;
    void *clk_ctx;
    uint32_t daily_quota;
    uint64_t tokens_today;
};

odk_svc_llm_t *svc_llm_create(const odk_llm_http_port_t *http, void *http_ctx,
                                const odk_kv_port_t *kv, void *kv_ctx,
                                const odk_clock_port_t *clk, void *clk_ctx,
                                uint32_t daily_quota)
{
    if (http == NULL || kv == NULL || clk == NULL) {
        return NULL;
    }

    odk_svc_llm_t *s = malloc(sizeof(*s));
    if (s == NULL) {
        return NULL;
    }
    s->http = http;
    s->http_ctx = http_ctx;
    s->kv = kv;
    s->kv_ctx = kv_ctx;
    s->clk = clk;
    s->clk_ctx = clk_ctx;
    s->daily_quota = daily_quota;
    s->tokens_today = 0;
    return s;
}

/* Rolls the kv-persisted day/count and the in-memory token total forward to
 * the clock's current day whenever they lag behind it, then returns today's
 * count. A day that has never been recorded is treated the same as a day
 * that has just changed. */
static uint32_t sync_to_today_and_get_used(odk_svc_llm_t *s)
{
    uint32_t today = s->clk->today_yyyymmdd(s->clk_ctx);

    uint32_t stored_day = 0;
    bool have_day = s->kv->get_u32(s->kv_ctx, LLM_USED_DAY_KEY, &stored_day);
    if (!have_day || stored_day != today) {
        s->kv->set_u32(s->kv_ctx, LLM_USED_DAY_KEY, today);
        s->kv->set_u32(s->kv_ctx, LLM_USED_COUNT_KEY, 0);
        s->tokens_today = 0;
        return 0;
    }

    uint32_t used = 0;
    s->kv->get_u32(s->kv_ctx, LLM_USED_COUNT_KEY, &used);
    return used;
}

static char *build_request_body(const char *system_prompt, const char *user_prompt)
{
    cJSON *req = cJSON_CreateObject();
    if (req == NULL) {
        return NULL;
    }

    cJSON *messages = cJSON_AddArrayToObject(req, "messages");
    cJSON_AddStringToObject(req, "model", ODK_LLM_CHAT_MODEL);
    cJSON *sys_msg = cJSON_CreateObject();
    cJSON_AddStringToObject(sys_msg, "role", "system");
    cJSON_AddStringToObject(sys_msg, "content", system_prompt != NULL ? system_prompt : "");
    cJSON_AddItemToArray(messages, sys_msg);

    cJSON *user_msg = cJSON_CreateObject();
    cJSON_AddStringToObject(user_msg, "role", "user");
    cJSON_AddStringToObject(user_msg, "content", user_prompt != NULL ? user_prompt : "");
    cJSON_AddItemToArray(messages, user_msg);

    char *body = cJSON_PrintUnformatted(req);
    cJSON_Delete(req);
    return body;
}

/* Parses an OpenAI-compatible chat-completion response: choices[0].message.
 * content into out, usage.prompt_tokens/completion_tokens into usage. Any
 * structural mismatch is reported as a recoverable HTTP error, same as a
 * transport failure. */
static odk_err_t parse_response(const char *resp_json, char *out, size_t outlen,
                                  odk_llm_usage_t *usage)
{
    cJSON *root = cJSON_Parse(resp_json);
    if (root == NULL) {
        return ODK_ERR_HTTP;
    }

    cJSON *choices = cJSON_GetObjectItemCaseSensitive(root, "choices");
    cJSON *first_choice = cJSON_GetArrayItem(choices, 0);
    cJSON *message = first_choice != NULL
                          ? cJSON_GetObjectItemCaseSensitive(first_choice, "message")
                          : NULL;
    cJSON *content = message != NULL ? cJSON_GetObjectItemCaseSensitive(message, "content") : NULL;
    cJSON *reasoning = message != NULL
                           ? cJSON_GetObjectItemCaseSensitive(message, "reasoning_content")
                           : NULL;
    /* glm-5.2 (and similar) may return empty content with only reasoning_content. */
    const char *text = NULL;
    if (cJSON_IsString(content) && content->valuestring != NULL && content->valuestring[0] != '\0') {
        text = content->valuestring;
    } else if (cJSON_IsString(reasoning) && reasoning->valuestring != NULL &&
               reasoning->valuestring[0] != '\0') {
        text = reasoning->valuestring;
    }
    if (text == NULL) {
        cJSON_Delete(root);
        return ODK_ERR_HTTP;
    }

    if (out != NULL && outlen > 0) {
        strncpy(out, text, outlen - 1);
        out[outlen - 1] = '\0';
    }

    cJSON *usage_json = cJSON_GetObjectItemCaseSensitive(root, "usage");
    cJSON *prompt_tokens = cJSON_GetObjectItemCaseSensitive(usage_json, "prompt_tokens");
    cJSON *completion_tokens = cJSON_GetObjectItemCaseSensitive(usage_json, "completion_tokens");

    if (usage != NULL) {
        usage->in_tokens = cJSON_IsNumber(prompt_tokens) ? (uint32_t)prompt_tokens->valuedouble : 0;
        usage->out_tokens =
            cJSON_IsNumber(completion_tokens) ? (uint32_t)completion_tokens->valuedouble : 0;
    }

    cJSON_Delete(root);
    return ODK_OK;
}

odk_err_t svc_llm_complete(odk_svc_llm_t *s, const char *system_prompt,
                             const char *user_prompt, char *out, size_t outlen,
                             odk_llm_usage_t *usage)
{
    if (out != NULL && outlen > 0) {
        out[0] = '\0';
    }
    if (usage != NULL) {
        usage->in_tokens = 0;
        usage->out_tokens = 0;
    }

    uint32_t used = sync_to_today_and_get_used(s);
    if (used >= s->daily_quota) {
        return ODK_ERR_QUOTA_EXCEEDED;
    }

    char *body = build_request_body(system_prompt, user_prompt);
    if (body == NULL) {
        return ODK_ERR_OOM;
    }

    char *resp = malloc(LLM_HTTP_RESP_BUF_LEN);
    if (resp == NULL) {
        free(body);
        return ODK_ERR_OOM;
    }
    resp[0] = '\0';

    odk_err_t transport_err = s->http->post_json(s->http_ctx, body, resp, LLM_HTTP_RESP_BUF_LEN);
    free(body);
    if (transport_err != ODK_OK) {
        free(resp);
        return ODK_ERR_HTTP;
    }

    odk_llm_usage_t parsed_usage = { 0 };
    odk_err_t parse_err = parse_response(resp, out, outlen, &parsed_usage);
    free(resp);
    if (parse_err != ODK_OK) {
        return parse_err;
    }

    if (usage != NULL) {
        *usage = parsed_usage;
    }

    s->kv->set_u32(s->kv_ctx, LLM_USED_COUNT_KEY, used + 1);
    s->tokens_today += (uint64_t)parsed_usage.in_tokens + parsed_usage.out_tokens;

    return ODK_OK;
}

uint32_t svc_llm_quota_remaining(odk_svc_llm_t *s)
{
    uint32_t used = sync_to_today_and_get_used(s);
    return used < s->daily_quota ? s->daily_quota - used : 0;
}

uint64_t svc_llm_total_tokens_today(odk_svc_llm_t *s)
{
    sync_to_today_and_get_used(s);
    return s->tokens_today;
}
