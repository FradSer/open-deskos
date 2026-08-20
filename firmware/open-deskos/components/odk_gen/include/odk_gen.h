/*
 * odk_gen.h — one-prompt generation pipeline (NT-11, Open DeskOS-OS §6.2
 * compensating constraints 1/2 + §6.3 device-direct channel).
 *
 * Turns a single natural-language prompt into a fully-verified staged
 * package: a quota check against the injected odk_svc_llm_t (constraint 3,
 * "quota before the LLM") -> one svc_llm_complete call constrained to the v2
 * built-in app template's slot schema (constraint 2 — the LLM only ever
 * produces slot JSON, never arbitrary Lua; any unknown key, over-length
 * value, or capability outside the template's allowed set rejects the whole
 * package) -> literal {{slot}} substitution into the template skeleton (no
 * evaluation) -> the generated Lua compile-checked via
 * odk_sandbox_check_source -> a manifest assembled and written alongside it
 * to a staging directory.
 *
 * This component has write access to the staging directory only; it never
 * touches the package root or any device capability directly (constraint
 * 1). The caller (task-009's composition root) hands the returned staged
 * directory to installer_install_staged, which is the sole path into the
 * package root and the sole place the user is asked for consent — the
 * sandbox invariant does not loosen because the source was generated.
 *
 * LLM transport/quota, storage, and Lua compile-checking are all reached
 * through already-injected components (odk_svc_llm_t, odk_storage_port_t,
 * odk_sandbox_check_source), so this header and its implementation compile
 * unchanged on the host test harness and on-target.
 */
#ifndef ODK_GEN_H
#define ODK_GEN_H

#include <stddef.h>

#include "odk_err.h"
#include "odk_installer.h" /* odk_storage_port_t */
#include "odk_svc_llm.h"   /* odk_svc_llm_t */

/* Opaque: the v2 built-in app template (manifest.json.tpl + main.lua.tpl +
 * slots.schema.json — see templates/app_v2/). */
typedef struct odk_template odk_template_t;

const odk_template_t *odk_template_builtin_app(void);

typedef struct odk_gen odk_gen_t;

odk_gen_t *gen_create(odk_svc_llm_t *llm,
                       const odk_storage_port_t *st, void *st_ctx,
                       const char *staging_root);

/* Quota is checked before svc_llm is ever called (constraint 3). On success
 * a complete staged package (manifest.json + app/main.lua) is written
 * under staging_root and its path is copied into out_staged_dir. Every
 * rejection path — quota exhausted, a slot-schema violation, or a
 * generated Lua slot that fails odk_sandbox_check_source — leaves zero
 * residue under staging_root. */
odk_err_t gen_create_app(odk_gen_t *g, const odk_template_t *tpl,
                          const char *prompt,
                          char *out_staged_dir, size_t outlen);

#endif /* ODK_GEN_H */
