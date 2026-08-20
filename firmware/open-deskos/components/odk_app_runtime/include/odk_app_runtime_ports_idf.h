/* On-target source port for installed App packages. */
#ifndef ODK_APP_RUNTIME_PORTS_IDF_H
#define ODK_APP_RUNTIME_PORTS_IDF_H

#include "odk_app_runtime.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char app_root[32];
} odk_app_source_idf_ctx_t;

void odk_app_source_idf_ctx_init(odk_app_source_idf_ctx_t *ctx,
                                  const char *app_root);
extern const odk_app_source_port_t odk_app_source_port_idf;

#ifdef __cplusplus
}
#endif

#endif /* ODK_APP_RUNTIME_PORTS_IDF_H */
