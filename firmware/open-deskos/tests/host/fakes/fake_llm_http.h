/*
 * fake_llm_http.h — programmable test double for odk_llm_http_port_t.
 *
 * Records every post_json call and returns either a canned JSON response
 * body or a simulated transport failure, so tests can assert both "the
 * request that went out got this reply" and "no request went out at all".
 */
#ifndef FAKE_LLM_HTTP_H
#define FAKE_LLM_HTTP_H

#include <stdbool.h>

#include "odk_svc_llm.h"

typedef struct {
    const char *canned_response_json; /* caller-owned lifetime; not copied */
    bool fail_transport;
    int call_count;
} fake_llm_http_t;

void fake_llm_http_reset(fake_llm_http_t *fake);
void fake_llm_http_set_response(fake_llm_http_t *fake, const char *json);
void fake_llm_http_set_transport_failure(fake_llm_http_t *fake, bool fail);

extern const odk_llm_http_port_t fake_llm_http_port;

#endif /* FAKE_LLM_HTTP_H */
