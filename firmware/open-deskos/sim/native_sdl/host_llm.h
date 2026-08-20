/*
 * host_llm.h — host-side LLM port instances for the native sim.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include "odk_svc_llm.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Real OpenAI-compatible HTTP (libcurl -> CLIProxyAPI), in-memory KV, local clock. */
extern const odk_llm_http_port_t host_llm_http_port;
extern const odk_kv_port_t      host_llm_kv_port;
extern const odk_clock_port_t   host_llm_clock_port;

#ifdef __cplusplus
}
#endif
