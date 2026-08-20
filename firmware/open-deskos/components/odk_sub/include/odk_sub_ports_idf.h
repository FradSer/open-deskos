/*
 * odk_sub_ports_idf.h — on-target port instances for odk_sub.
 *
 * The NVS-backed string store (src/port_idf/sub_nvs.c) exposes its port
 * here; the composition root wires it into odk_sub_create. The default
 * namespace is "odk_sub" unless overridden.
 */
#ifndef ODK_SUB_PORTS_IDF_H
#define ODK_SUB_PORTS_IDF_H

#include "odk_sub.h"

#ifdef __cplusplus
extern "C" {
#endif

/* String KV port → NVS. Pass NULL ctx for the default "odk_sub" namespace. */
extern const odk_sub_port_t odk_sub_port_idf;

#ifdef __cplusplus
}
#endif

#endif /* ODK_SUB_PORTS_IDF_H */
