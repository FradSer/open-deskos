#include "fake_llm_http.h"

#include <string.h>

void fake_llm_http_reset(fake_llm_http_t *fake)
{
    fake->canned_response_json = NULL;
    fake->fail_transport = false;
    fake->call_count = 0;
}

void fake_llm_http_set_response(fake_llm_http_t *fake, const char *json)
{
    fake->canned_response_json = json;
    fake->fail_transport = false;
}

void fake_llm_http_set_transport_failure(fake_llm_http_t *fake, bool fail)
{
    fake->fail_transport = fail;
}

static odk_err_t fake_llm_http_post_json(void *ctx, const char *body_json,
                                           char *resp, size_t resplen)
{
    (void)body_json;
    fake_llm_http_t *fake = (fake_llm_http_t *)ctx;
    fake->call_count++;

    if (fake->fail_transport) {
        return ODK_ERR_HTTP;
    }

    if (fake->canned_response_json != NULL && resp != NULL && resplen > 0) {
        strncpy(resp, fake->canned_response_json, resplen - 1);
        resp[resplen - 1] = '\0';
    }
    return ODK_OK;
}

const odk_llm_http_port_t fake_llm_http_port = {
    .post_json = fake_llm_http_post_json,
};
