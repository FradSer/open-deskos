/*
 * odk_svc_llm_ports_idf.h — on-target (ESP-IDF) implementations of the three
 * ports odk_svc_llm injects: kv (NVS), clock (RTC with a boot-day degrade),
 * and llm http (esp_http_client + esp_crt_bundle). Real-target counterparts
 * of fake_kv/fake_clock/fake_llm_http. Only the src/port_idf/ .c files touch
 * ESP-IDF; the host build never compiles them.
 */
#ifndef ODK_SVC_LLM_PORTS_IDF_H
#define ODK_SVC_LLM_PORTS_IDF_H

#include "odk_svc_llm.h"

#ifdef __cplusplus
extern "C" {
#endif

/* NVS namespace the quota counters and LLM endpoint/key live in (NFR-8: quota
 * survives reboot in NVS, package index stays in files). */
#define ODK_LLM_NVS_NAMESPACE "odk_llm"

/* kv → NVS. ctx is the namespace string (pass ODK_LLM_NVS_NAMESPACE). */
extern const odk_kv_port_t odk_kv_port_idf;

/* clock → RTC. Stateless: pass NULL as ctx. When the RTC is uncorrected
 * (no SNTP sync yet) it degrades to a monotonic boot-day counter so the daily
 * quota still rolls over roughly once per day, and logs that once. */
extern const odk_clock_port_t odk_clock_port_idf;

/* llm http → esp_http_client + esp_crt_bundle. Endpoint and bearer key are
 * read from NVS (ODK_LLM_NVS_NAMESPACE, keys "llm_endpoint"/"llm_api_key")
 * by the ctx init; a missing config returns ODK_ERR_HTTP so gen reports it
 * rather than dialing an empty URL. */
typedef struct {
    char endpoint[256];
    char api_key[160];
    char model[64];
} odk_llm_http_idf_ctx_t;

odk_err_t odk_llm_http_idf_ctx_init(odk_llm_http_idf_ctx_t *ctx);
extern const odk_llm_http_port_t odk_llm_http_port_idf;

#ifdef __cplusplus
}
#endif

#endif /* ODK_SVC_LLM_PORTS_IDF_H */
