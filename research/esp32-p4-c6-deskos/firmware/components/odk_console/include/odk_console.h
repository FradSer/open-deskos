/*
 * odk_console.h — composition-root console command dispatch (task-009,
 * Open DeskOS-OS §6.2 constraint 4 "cost visible" + §11.2 M3's headless
 * equivalent + "组合根只接线": this dispatch logic is host-testable in full
 * before task-009-impl mounts it on esp_console).
 *
 * Pure C, no IDF include: every dependency is injected as an already-
 * constructed handle from the four sibling components (odk_gen, odk_
 * installer, odk_app_manager, odk_svc_llm), each of which is itself already
 * port-injected and host-testable (task-005/006/007/008). This component
 * adds no new ports of its own — it only sequences calls into those four
 * handles and formats their results into a human-readable line, so it
 * compiles and is fully exercisable on the host test harness exactly like
 * its dependencies.
 *
 * Command grammar (argv[0] is always the command name, esp_console-style):
 *   {"gen", "<prompt>"}   -> gen_create_app then, on success,
 *                            installer_install_staged(..., ODK_SRC_GENERATED).
 *                            Consent happens inside installer's own consent
 *                            port, never here (§6.2 constraint 1: generated
 *                            output is never exempt from the install
 *                            pipeline). On success `out` contains the new
 *                            app_id, today's total token usage
 *                            (svc_llm_total_tokens_today), and the remaining
 *                            daily quota (svc_llm_quota_remaining) — the
 *                            cost-visibility landing point for constraint 4.
 *                            A gen_create_app failure (e.g.
 *                            ODK_ERR_QUOTA_EXCEEDED) is reported in `out`
 *                            and installer_install_staged is never called.
 *                            If registration fails after installation, the
 *                            console removes that installation before
 *                            returning the registration error; a failed
 *                            rollback is reported explicitly.
 *   {"apps"}              -> installer_list; `out` gets one line per
 *                            installed App: app_id, version, and origin.
 *   {"open", "<app_id>"}  -> odk_app_manager_start(app_manager, app_id).
 *   {"close", "<app_id>"} -> odk_app_manager_stop(app_manager, app_id).
 *   {"uninstall", "<app_id>"} -> installer_remove(installer, app_id).
 *   anything else         -> `out` gets a one-line usage summary; no
 *                            dependency in odk_console_deps_t is touched;
 *                            returns ODK_ERR_NOT_FOUND.
 *
 * A caller may leave any dep field NULL if the argv it will ever dispatch
 * through this odk_console_deps_t never reaches the command(s) that need
 * it (e.g. a deps value used only for "apps"/"uninstall" may leave gen/tpl/app_manager/
 * llm NULL) — the dispatcher must never read a field it does not need for
 * the argv[0] actually given.
 */
#ifndef ODK_CONSOLE_H
#define ODK_CONSOLE_H

#include <stddef.h>

#include "odk_app_manager.h"
#include "odk_err.h"
#include "odk_gen.h"
#include "odk_installer.h"
#include "odk_sub.h"
#include "odk_svc_llm.h"

typedef struct {
    odk_gen_t            *gen;
    const odk_template_t *tpl;
    odk_installer_t      *installer;
    odk_app_manager_t    *app_manager;
    odk_svc_llm_t        *llm;          /* 配额/用量回显查询 */
    odk_sub_t            *sub;          /* host-pushed subscription snapshot */
} odk_console_deps_t;

/* argv 形如 {"gen","做一个…"} / {"apps"} / {"open","<app_id>"} …
 * 人读输出写入 out;返回错误枚举供接线层定 exit code */
odk_err_t odk_console_exec(const odk_console_deps_t *d,
                             int argc, const char *const *argv,
                             char *out, size_t outlen);

#endif /* ODK_CONSOLE_H */
