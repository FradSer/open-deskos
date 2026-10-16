/*
 * odk_composition.h — Open DeskOS app-platform composition root (task-009).
 *
 * Wiring only (022 revision: the composition root contains no business
 * logic). odk_composition_init mounts the packages partition, constructs the
 * real on-target ports, hands them to svc_llm/gen/installer/App Manager,
 * wires
 * odk_console onto esp_console as the `cerb` command, and spawns the Core-0
 * App Manager task plus its tick timer. Call it once at boot, after the fork's
 * console REPL has started.
 */
#ifndef ODK_COMPOSITION_H
#define ODK_COMPOSITION_H

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t odk_composition_init(void);

#ifdef __cplusplus
}
#endif

#endif /* ODK_COMPOSITION_H */
