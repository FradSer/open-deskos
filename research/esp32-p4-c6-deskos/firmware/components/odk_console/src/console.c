/*
 * console.c — odk_console: composition-root command dispatch (task-009,
 * Open DeskOS-OS §6.2 constraint 4 "cost visible" + §11.2 M3's headless
 * equivalent). Pure sequencing over the four already-GREEN sibling
 * components (odk_gen, odk_installer, odk_app_manager, odk_svc_llm): each
 * subcommand routes into one handle and formats the result into a
 * human-readable line. No IDF include and no port of its own, so this
 * compiles and is fully exercisable on the host harness exactly like its
 * dependencies; task-009-impl's composition root registers it on esp_console.
 */
#include "odk_console.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

#include "odk_path.h"
#include "odk_sub.h"
#ifdef ESP_PLATFORM
#include "nvs_flash.h"
#endif

/* installer_list caps how many Apps `apps` renders in one call. */
#define CONSOLE_MAX_LIST 16
#define CONSOLE_STAGED_DIR_BUF 256

static const char *origin_name(odk_pkg_origin_t origin)
{
    switch (origin) {
        case ODK_SRC_GENERATED: return "generated";
        case ODK_SRC_SIDELOAD:  return "sideload";
        case ODK_SRC_STORE:     return "store";
    }
    return "unknown";
}

/* gen writes each staged App to "<staging_root>/<app_id>", so the app_id is
 * the trailing path component of the directory it returns. */
static const char *app_id_of(const char *staged_dir)
{
    const char *slash = strrchr(staged_dir, '/');
    return slash != NULL ? slash + 1 : staged_dir;
}

static void write_usage(char *out, size_t outlen)
{
    snprintf(out, outlen,
        "usage: cerb <command>\n"
        "  ui \"<transcript>\"  voice→UI demo: LLM Lua+LVGL on the panel\n"
        "  gen \"<prompt>\"   generate an app from a prompt, then install it\n"
        "  apps             list installed Apps\n"
        "  open <app_id>    open a registered App\n"
        "  close <app_id>   close a running App\n"
        "  uninstall <app_id>  remove an installed App\n"
        "  sub status       subscription snapshot: data? refresh pending?\n"
        "  sub push k=v ... store a host-pushed subscription snapshot\n"
        "  sub get          echo the stored subscription snapshot\n"
        "  settime <epoch>  set wall clock from the host (USB time injection)\n");
}

/* gen_create_app -> on success installer_install_staged(..., GENERATED) ->
 * echo app_id + today's token usage + remaining quota (constraint 4). A
 * gen failure is reported and the installer is never reached: generated
 * output is never exempt from the install pipeline, but a package that never
 * generated has nothing to install. */
static odk_err_t cmd_gen(const odk_console_deps_t *d, const char *prompt,
                          char *out, size_t outlen)
{
    char staged_dir[CONSOLE_STAGED_DIR_BUF];
    odk_err_t err = gen_create_app(d->gen, d->tpl, prompt, staged_dir, sizeof(staged_dir));
    if (err != ODK_OK) {
        if (err == ODK_ERR_QUOTA_EXCEEDED) {
            snprintf(out, outlen, "gen failed: daily quota exhausted\n");
        } else {
            snprintf(out, outlen, "gen failed (error %d)\n", (int)err);
        }
        return err;
    }

    const char *generated_app_id = app_id_of(staged_dir);
    size_t generated_app_id_len = strlen(generated_app_id);
    if (generated_app_id_len == 0 || generated_app_id_len >= ODK_APP_ID_LEN ||
        !odk_app_id_valid(generated_app_id)) {
        snprintf(out, outlen, "gen failed: generated app_id is invalid\n");
        return ODK_ERR_BAD_APP_ID;
    }

    err = installer_install_staged(d->installer, staged_dir, ODK_SRC_GENERATED);
    if (err != ODK_OK) {
        snprintf(out, outlen, "install failed (error %d)\n", (int)err);
        return err;
    }

    if (d->app_manager != NULL) {
        odk_app_descriptor_t descriptor = { 0 };
        memcpy(descriptor.app_id, generated_app_id, generated_app_id_len + 1);
        descriptor.kind = ODK_APP_KIND_UI;
        err = odk_app_manager_register(d->app_manager, &descriptor);
        if (err != ODK_OK) {
            odk_err_t rollback_err = installer_remove(d->installer, descriptor.app_id);
            if (rollback_err == ODK_OK) {
                snprintf(out, outlen,
                         "App registration failed (error %d); install rolled back for %s\n",
                         (int)err, descriptor.app_id);
            } else {
                snprintf(out, outlen,
                         "App registration failed (error %d); install rollback failed (error %d) for %s\n",
                         (int)err, (int)rollback_err, descriptor.app_id);
            }
            return err;
        }
    }

    uint64_t tokens_today = svc_llm_total_tokens_today(d->llm);
    uint32_t quota_remaining = svc_llm_quota_remaining(d->llm);
    snprintf(out, outlen, "installed %s (tokens today: %llu, quota remaining: %u)\n",
             app_id_of(staged_dir), (unsigned long long)tokens_today, (unsigned)quota_remaining);
    return ODK_OK;
}

static odk_err_t cmd_apps(const odk_console_deps_t *d, char *out, size_t outlen)
{
    odk_installed_info_t list[CONSOLE_MAX_LIST];
    size_t n = 0;
    odk_err_t err = installer_list(d->installer, list, CONSOLE_MAX_LIST, &n);
    if (err != ODK_OK) {
        snprintf(out, outlen, "apps failed (error %d)\n", (int)err);
        return err;
    }

    size_t off = 0;
    for (size_t i = 0; i < n && off < outlen; i++) {
        const char *kind = list[i].kind == ODK_MANIFEST_KIND_SERVICE ? "service" : "ui";
        int written = snprintf(out + off, outlen - off, "%s\t%s\t%s\t%s\n",
                               list[i].app_id, list[i].version, kind,
                               origin_name(list[i].origin));
        if (written < 0) {
            break;
        }
        off += (size_t)written;
    }
    return ODK_OK;
}

static odk_err_t cmd_open(const odk_console_deps_t *d, const char *app_id,
                            char *out, size_t outlen)
{
    odk_err_t err = odk_app_manager_start(d->app_manager, app_id);
    if (err != ODK_OK) {
        snprintf(out, outlen, "open failed (error %d)\n", (int)err);
    } else {
        snprintf(out, outlen, "opened %s\n", app_id);
    }
    return err;
}

static odk_err_t cmd_close(const odk_console_deps_t *d, const char *app_id,
                           char *out, size_t outlen)
{
    odk_err_t err = odk_app_manager_stop(d->app_manager, app_id);
    if (err != ODK_OK) {
        snprintf(out, outlen, "close failed (error %d)\n", (int)err);
    } else {
        snprintf(out, outlen, "closed %s\n", app_id);
    }
    return err;
}

static odk_err_t cmd_uninstall(const odk_console_deps_t *d, const char *app_id,
                         char *out, size_t outlen)
{
    if (d->app_manager != NULL &&
        odk_app_manager_state(d->app_manager, app_id) != ODK_APP_STATE_ERROR) {
        odk_err_t stop_err = odk_app_manager_stop(d->app_manager, app_id);
        if (stop_err != ODK_OK) {
            snprintf(out, outlen, "uninstall failed: close error %d\n", (int)stop_err);
            return stop_err;
        }
    }
    odk_err_t err = installer_remove(d->installer, app_id);
    if (err != ODK_OK) {
        snprintf(out, outlen, "uninstall failed (error %d)\n", (int)err);
    } else {
        if (d->app_manager != NULL) {
            (void)odk_app_manager_unregister(d->app_manager, app_id);
        }
        snprintf(out, outlen, "uninstalled %s\n", app_id);
    }
    return err;
}

/* `cerb settime <epoch>` — host-over-USB wall-clock injection. The device has
 * no reliable network here (SNTP retries 15×3s then gives up), so the Mac
 * bridge pushes `Date().timeIntervalSince1970`. settimeofday() is the single
 * source of truth every time reader (time(), Lua os.time(), launcher's
 * clock/date) funnels through; once set ≥ CAP_SYSTEM_MIN_VALID_EPOCH the
 * cap_system time-sync service sees a valid clock and stops retrying SNTP. */
static odk_err_t cmd_settime(const odk_console_deps_t *d, const char *epoch_str,
                              char *out, size_t outlen)
{
    (void)d;
    char *end = NULL;
    long long sec = strtoll(epoch_str, &end, 10);
    if (end == epoch_str || *end != '\0' || sec <= 0) {
        snprintf(out, outlen, "settime: bad epoch '%s'\n", epoch_str);
        return ODK_ERR_INVALID_ARG;
    }
    struct timeval tv = { .tv_sec = (time_t)sec, .tv_usec = 0 };
    if (settimeofday(&tv, NULL) != 0) {
        snprintf(out, outlen, "settime failed\n");
        return ODK_ERR_STATE;
    }
    /* Persist across power cycles: the P4 has no battery RTC, so a fresh boot
     * starts at the 1970 epoch and the launcher's Year/clock/date would read
     * 0%/00:00 until the Mac pushes the next settime. Store the applied epoch
     * so app_main can restore it before cap_system/launcher run. */
#ifdef ESP_PLATFORM
    {
        nvs_handle_t h;
        if (nvs_open("odk_clock", NVS_READWRITE, &h) == ESP_OK) {
            if (nvs_set_i64(h, "epoch", sec) == ESP_OK) {
                nvs_commit(h);
            }
            nvs_close(h);
        }
    }
#endif
    snprintf(out, outlen, "time set to %lld\n", sec);
    return ODK_OK;
}

/* `cerb sub <status|push|get>` — the host bridge's serial surface for the
 * subscription snapshot (see odk_sub.h). Status reports whether a snapshot
 * is stored and whether a refresh is pending; push stores a single-line
 * "k=v k=v" snapshot; get echoes it back. */
static odk_err_t cmd_sub(const odk_console_deps_t *d, int argc,
                          const char *const *argv, char *out, size_t outlen)
{
    if (d->sub == NULL) {
        snprintf(out, outlen, "sub unavailable (no snapshot store)\n");
        return ODK_ERR_STATE;
    }
    const char *op = (argc >= 2) ? argv[1] : NULL;

    if (op == NULL) {
        snprintf(out, outlen, "sub: usage: sub status | sub push k=v ... | sub get\n");
        return ODK_ERR_NOT_FOUND;
    }
    if (strcmp(op, "status") == 0) {
        const bool has = odk_sub_has_snapshot(d->sub);
        const bool need = odk_sub_needs_refresh(d->sub);
        snprintf(out, outlen, "data=%s refresh=%s\n",
                 has ? "yes" : "no", need ? "yes" : "no");
        return ODK_OK;
    }
    if (strcmp(op, "get") == 0) {
        char snap[ODK_SUB_SNAPSHOT_MAX];
        odk_err_t err = odk_sub_get_snapshot(d->sub, snap, sizeof(snap));
        if (err != ODK_OK) {
            snprintf(out, outlen, "sub: no snapshot\n");
            return err;
        }
        snprintf(out, outlen, "%s\n", snap);
        return ODK_OK;
    }
    if (strcmp(op, "push") == 0) {
        if (argc < 3) {
            snprintf(out, outlen, "sub push: need at least one k=v token\n");
            return ODK_ERR_NOT_FOUND;
        }
        /* Rejoin argv[2..] into a single-line snapshot (esp_console does not
         * quote tokens, so a bridge may push multiple k=v tokens). */
        char snap[ODK_SUB_SNAPSHOT_MAX];
        size_t off = 0;
        snap[0] = '\0';
        for (int i = 2; i < argc; i++) {
            const char *tok = argv[i] != NULL ? argv[i] : "";
            size_t need = (off > 0 ? 1 : 0) + strlen(tok);
            if (off + need >= sizeof(snap)) {
                /* Would truncate a token mid-value — reject rather than store
                 * a garbled blob. */
                snprintf(out, outlen, "sub push failed: snapshot too long\n");
                return ODK_ERR_INVALID_ARG;
            }
            int n = snprintf(snap + off, sizeof(snap) - off, "%s%s",
                             (off > 0) ? " " : "", tok);
            if (n < 0) {
                break;
            }
            off += (size_t)n;
        }
        odk_err_t err = odk_sub_set_snapshot(d->sub, snap);
        if (err != ODK_OK) {
            snprintf(out, outlen, "sub push failed (error %d)\n", (int)err);
            return err;
        }
        snprintf(out, outlen, "sub: stored\n");
        return ODK_OK;
    }

    snprintf(out, outlen, "sub: unknown op '%s'\n", op);
    return ODK_ERR_NOT_FOUND;
}

odk_err_t odk_console_exec(const odk_console_deps_t *d,
                             int argc, const char *const *argv,
                             char *out, size_t outlen)
{
    if (out != NULL && outlen > 0) {
        out[0] = '\0';
    }
    if (argc < 1) {
        write_usage(out, outlen);
        return ODK_ERR_NOT_FOUND;
    }

    const char *cmd = argv[0];
    if (strcmp(cmd, "gen") == 0 && argc >= 2) {
        return cmd_gen(d, argv[1], out, outlen);
    }
    if (strcmp(cmd, "apps") == 0) {
        return cmd_apps(d, out, outlen);
    }
    if (strcmp(cmd, "open") == 0 && argc >= 2) {
        return cmd_open(d, argv[1], out, outlen);
    }
    if (strcmp(cmd, "close") == 0 && argc >= 2) {
        return cmd_close(d, argv[1], out, outlen);
    }
    if (strcmp(cmd, "uninstall") == 0 && argc >= 2) {
        return cmd_uninstall(d, argv[1], out, outlen);
    }
    if (strcmp(cmd, "sub") == 0) {
        return cmd_sub(d, argc, argv, out, outlen);
    }
    if (strcmp(cmd, "settime") == 0 && argc >= 2) {
        return cmd_settime(d, argv[1], out, outlen);
    }

    write_usage(out, outlen);
    return ODK_ERR_NOT_FOUND;
}
