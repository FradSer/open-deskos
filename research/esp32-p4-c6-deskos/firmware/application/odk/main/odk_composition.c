/*
 * odk_composition.c — Open DeskOS app-platform composition root (task-009).
 *
 * WIRING ONLY. Every line here either constructs a real on-target port,
 * hands an already-built handle to a component's create function, or plumbs
 * FreeRTOS/esp_console/esp_timer primitives together. The business logic
 * lives entirely in the host-tested components (odk_gen, odk_installer,
 * odk_app_manager, odk_app_runtime, odk_svc_llm) and their dispatcher
 * (odk_console); this file
 * only sequences their construction and routes the `cerb` console command
 * into odk_console_exec.
 *
 * Task/timer topology (§323, NFR-6): the gen/install pipeline and the Lua app
 * platform both run on a single Core-0 worker task with a 16KB stack, below the
 * fork's claw agent task (priority 5) so a long LLM/install burst never
 * preempts the agent. The console command handler runs on the REPL task but
 * only marshals the request to that worker and blocks on a completion
 * semaphore, so (a) gen runs with the 16KB stack it needs (NFR-6), and (b)
 * the REPL is not reading stdin while the installer's serial consent prompt
 * owns the console input window. A 1s esp_timer drives the App Manager tick.
 */
#include "odk_composition.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "esp_check.h"
#include "esp_console.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "wear_levelling.h"

#include "odk_app_manager.h"
#include "odk_app_runtime.h"
#include "odk_app_runtime_ports_idf.h"
#include "odk_console.h"
#include "odk_gen.h"
#include "odk_installer.h"
#include "odk_installer_ports_idf.h"
#include "odk_path.h"
#include "odk_sandbox.h"
#include "odk_sub.h"
#include "odk_sub_ports_idf.h"
#include "odk_svc_llm.h"
#include "odk_svc_llm_ports_idf.h"
#include "odk_tick_gate.h"
#include "odk_voice_ui.h"

#define ODK_PACKAGES_MOUNT "/packages"
#define ODK_PACKAGES_PART_LABEL "packages"
#define ODK_STAGING_ROOT ODK_PACKAGES_MOUNT "/.staging"

#define ODK_DAILY_QUOTA 50
#define ODK_CONSENT_TIMEOUT_MS 60000
#define ODK_APP_POOL_SIZE (128 * 1024) /* NFR-3: 64-128KB Lua pool per app */
#define ODK_APP_INSTR_BUDGET 1000000u

/* Core 0, priority below the fork's claw agent task (CLAW_CORE_DEFAULT_PRIORITY
 * = 5) per the task's NFR-6 wiring instruction. §326's invariant places
 * download/install below render/voice and above peer telemetry; this headless
 * slice runs none of those, so 4 satisfies the ordering. §323 pins the task to
 * Core 0 with a 16KB stack. */
#define ODK_APP_TASK_CORE 0
#define ODK_APP_TASK_PRIORITY 4
#define ODK_APP_TASK_STACK 16384
#define ODK_JOB_QUEUE_DEPTH 8
#define ODK_TICK_PERIOD_US (1000 * 1000)
#define ODK_CONSOLE_OUT_BUF 512

static const char *TAG = "odk_comp";

/* The board declares the capabilities accepted by the generated App template. */
static const char *const s_board_caps[] = { "display", "storage:own" };
static const size_t s_board_caps_count = sizeof(s_board_caps) / sizeof(s_board_caps[0]);

/* Port ctxs — file-scope so they outlive odk_composition_init and stay valid
 * for every later port call. */
static odk_storage_idf_ctx_t s_storage_ctx;
static odk_consent_idf_ctx_t s_consent_ctx;
static odk_llm_http_idf_ctx_t s_llm_http_ctx;
static odk_app_source_idf_ctx_t s_app_source_ctx;
static odk_sandbox_limits_t s_app_limits;

/* Constructed components + the dispatcher's dependency bundle. */
static odk_svc_llm_t *s_llm;
static odk_gen_t *s_gen;
static odk_installer_t *s_installer;
static odk_app_runtime_t *s_app_runtime;
static odk_app_manager_t *s_app_manager;
static odk_sub_t *s_sub;
static odk_console_deps_t s_deps;

static wl_handle_t s_packages_wl = WL_INVALID_HANDLE;

/* Worker plumbing: the REPL task posts a job pointer and blocks on job.done;
 * the tick timer marks and posts a shared TICK job best-effort. The gate
 * coalesces timer callbacks while the worker is busy, so stale ticks are not
 * replayed in a burst when a long generation or install completes. */
typedef enum { ODK_JOB_CONSOLE, ODK_JOB_TICK } odk_job_kind_t;

typedef struct {
    odk_job_kind_t kind;
    int argc;
    const char *const *argv;
    char *out;
    size_t outlen;
    odk_err_t result;
    SemaphoreHandle_t done;
} odk_job_t;

static QueueHandle_t s_job_queue;
static odk_job_t s_tick_job = { .kind = ODK_JOB_TICK };
static odk_tick_gate_t s_tick_gate;

/* ---------------------------------------------------------------------------
 * Packages partition mount (FR-16, scenario 1).
 * ------------------------------------------------------------------------- */

static esp_err_t mount_packages_partition(void)
{
    esp_vfs_fat_mount_config_t cfg = {
        .format_if_mount_failed = true,
        .max_files = 8,
        .allocation_unit_size = 4096,
        .disk_status_check_enable = false,
        .use_one_fat = false,
    };
    esp_err_t err = esp_vfs_fat_spiflash_mount_rw_wl(ODK_PACKAGES_MOUNT, ODK_PACKAGES_PART_LABEL,
                                                     &cfg, &s_packages_wl);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "packages partition mount failed: %s", esp_err_to_name(err));
        return err;
    }
    if (mkdir(ODK_STAGING_ROOT, 0777) != 0 && errno != EEXIST) {
        ESP_LOGW(TAG, "could not pre-create staging dir %s: %s", ODK_STAGING_ROOT, strerror(errno));
    }
    return ESP_OK;
}

/* ---------------------------------------------------------------------------
 * Core-0 worker task + tick timer + console command handler.
 * ------------------------------------------------------------------------- */

static void odk_app_task(void *arg)
{
    (void)arg;
    for (;;) {
        odk_job_t *job = NULL;
        if (xQueueReceive(s_job_queue, &job, portMAX_DELAY) != pdTRUE || job == NULL) {
            continue;
        }
        if (job->kind == ODK_JOB_CONSOLE) {
            /* Voice→UI demo: `cerb ui "<transcript>"` bypasses the package
             * installer and drives LVGL Lua on the live panel (esp-claw style). */
            if (job->argc >= 2 && job->argv[0] != NULL && strcmp(job->argv[0], "ui") == 0) {
                /* esp_console does not honor shell quotes — join argv[1..] so
                 * `cerb ui show a weather card` works as one transcript. */
                char transcript[512];
                size_t off = 0;
                transcript[0] = '\0';
                for (int i = 1; i < job->argc && off + 1 < sizeof(transcript); i++) {
                    if (job->argv[i] == NULL) {
                        continue;
                    }
                    int n = snprintf(transcript + off, sizeof(transcript) - off, "%s%s",
                                     (off > 0) ? " " : "", job->argv[i]);
                    if (n < 0) {
                        break;
                    }
                    off += (size_t)n;
                }
                /* Strip optional wrapping quotes from first/last token. */
                if (transcript[0] == '"' || transcript[0] == '\'') {
                    memmove(transcript, transcript + 1, strlen(transcript));
                }
                size_t len = strlen(transcript);
                if (len > 0 && (transcript[len - 1] == '"' || transcript[len - 1] == '\'')) {
                    transcript[len - 1] = '\0';
                }
                job->result = odk_voice_ui_run(s_llm, transcript, job->out, job->outlen);
            } else {
                job->result = odk_console_exec(&s_deps, job->argc, job->argv, job->out, job->outlen);
            }
            if (job->done != NULL) {
                xSemaphoreGive(job->done);
            }
        } else {
            (void)odk_tick_gate_consume(&s_tick_gate);
            (void)odk_app_manager_tick(s_app_manager);
        }
    }
}

static void odk_tick_timer_cb(void *arg)
{
    (void)arg;
    if (!odk_tick_gate_mark(&s_tick_gate)) {
        return;
    }
    odk_job_t *job = &s_tick_job;
    if (xQueueSend(s_job_queue, &job, 0) != pdTRUE) {
        odk_tick_gate_clear(&s_tick_gate);
    }
}

static int cmd_cerb(int argc, char **argv)
{
    static char out[ODK_CONSOLE_OUT_BUF];
    out[0] = '\0';

    SemaphoreHandle_t done = xSemaphoreCreateBinary();
    if (done == NULL) {
        printf("cerb: out of memory\n");
        return 1;
    }

    /* esp_console passes argv[0] = "cerb" (the command name); odk_console_exec
     * expects argv[0] to be the sub-command. */
    odk_job_t job = {
        .kind = ODK_JOB_CONSOLE,
        .argc = argc - 1,
        .argv = (const char *const *)(argv + 1),
        .out = out,
        .outlen = sizeof(out),
        .result = ODK_ERR_NOT_IMPLEMENTED,
        .done = done,
    };
    odk_job_t *pjob = &job;
    if (xQueueSend(s_job_queue, &pjob, portMAX_DELAY) != pdTRUE) {
        vSemaphoreDelete(done);
        printf("cerb: busy\n");
        return 1;
    }
    xSemaphoreTake(done, portMAX_DELAY);
    vSemaphoreDelete(done);

    if (out[0] != '\0') {
        printf("%s", out);
    }
    return (job.result == ODK_OK) ? 0 : 1;
}

/* ---------------------------------------------------------------------------
 * Composition root.
 * ------------------------------------------------------------------------- */

esp_err_t odk_composition_init(void)
{
    odk_tick_gate_init(&s_tick_gate);
    ESP_RETURN_ON_ERROR(mount_packages_partition(), TAG, "packages partition unavailable");

    odk_storage_idf_ctx_init(&s_storage_ctx, ODK_PACKAGES_MOUNT);
    odk_consent_idf_ctx_init(&s_consent_ctx, ODK_CONSENT_TIMEOUT_MS);
    odk_app_source_idf_ctx_init(&s_app_source_ctx, ODK_PACKAGES_MOUNT);
    if (odk_llm_http_idf_ctx_init(&s_llm_http_ctx) != ODK_OK) {
        ESP_LOGW(TAG, "LLM endpoint/key not set in NVS ('%s'); 'cerb gen' fails until configured",
                 ODK_LLM_NVS_NAMESPACE);
    }

    s_llm = svc_llm_create(&odk_llm_http_port_idf, &s_llm_http_ctx,
                           &odk_kv_port_idf, (void *)ODK_LLM_NVS_NAMESPACE,
                           &odk_clock_port_idf, NULL,
                           ODK_DAILY_QUOTA);
    ESP_RETURN_ON_FALSE(s_llm != NULL, ESP_ERR_NO_MEM, TAG, "svc_llm_create failed");

    s_sub = odk_sub_create(&odk_sub_port_idf, NULL);
    ESP_RETURN_ON_FALSE(s_sub != NULL, ESP_ERR_NO_MEM, TAG, "odk_sub_create failed");
    odk_voice_ui_set_sub(s_sub);

    s_gen = gen_create(s_llm, &odk_storage_port_idf, &s_storage_ctx, ODK_STAGING_ROOT);
    ESP_RETURN_ON_FALSE(s_gen != NULL, ESP_ERR_NO_MEM, TAG, "gen_create failed");

    s_installer = installer_create(&odk_storage_port_idf, &s_storage_ctx,
                                   &odk_checksum_port_idf, NULL,
                                   &odk_consent_port_idf, &s_consent_ctx,
                                   ODK_PACKAGES_MOUNT, s_board_caps, s_board_caps_count);
    ESP_RETURN_ON_FALSE(s_installer != NULL, ESP_ERR_NO_MEM, TAG, "installer_create failed");

    s_app_limits.pool = NULL; /* Runtime allocates a dedicated pool per live App. */
    s_app_limits.pool_size = ODK_APP_POOL_SIZE;
    s_app_limits.instr_budget = ODK_APP_INSTR_BUDGET;
    const odk_app_runtime_config_t runtime_config = {
        .source = &odk_app_source_port_idf,
        .source_ctx = &s_app_source_ctx,
        .sandbox_limits = s_app_limits,
    };
    s_app_runtime = odk_app_runtime_create(&runtime_config);
    ESP_RETURN_ON_FALSE(s_app_runtime != NULL, ESP_ERR_NO_MEM, TAG,
                        "odk_app_runtime_create failed");

    const odk_app_manager_config_t manager_config = {
        .max_instances = ODK_APP_MANAGER_MAX_INSTANCES,
        .runtime = odk_app_runtime_port(s_app_runtime),
        .runtime_ctx = s_app_runtime,
    };
    s_app_manager = odk_app_manager_create(&manager_config);
    ESP_RETURN_ON_FALSE(s_app_manager != NULL, ESP_ERR_NO_MEM, TAG,
                        "odk_app_manager_create failed");

    odk_installed_info_t installed[ODK_APP_MANAGER_MAX_INSTANCES] = { 0 };
    size_t installed_count = 0;
    ESP_RETURN_ON_ERROR(installer_list(s_installer, installed,
                                       ODK_APP_MANAGER_MAX_INSTANCES, &installed_count),
                        TAG, "list installed Apps failed");
    size_t register_count = installed_count < ODK_APP_MANAGER_MAX_INSTANCES
                                ? installed_count : ODK_APP_MANAGER_MAX_INSTANCES;
    for (size_t i = 0; i < register_count; i++) {
        odk_app_descriptor_t descriptor = { 0 };
        size_t app_id_len = strlen(installed[i].app_id);
        if (app_id_len == 0 || app_id_len >= sizeof(descriptor.app_id) ||
            !odk_app_id_valid(installed[i].app_id)) {
            ESP_LOGE(TAG, "installed index contains invalid app_id at slot %u", (unsigned)i);
            return ESP_ERR_INVALID_ARG;
        }
        memcpy(descriptor.app_id, installed[i].app_id, app_id_len + 1);
        descriptor.kind = installed[i].kind == ODK_MANIFEST_KIND_SERVICE
                              ? ODK_APP_KIND_SERVICE : ODK_APP_KIND_UI;
        ESP_RETURN_ON_ERROR(odk_app_manager_register(s_app_manager, &descriptor), TAG,
                            "register installed App failed");
    }

    s_deps.gen = s_gen;
    s_deps.tpl = odk_template_builtin_app();
    s_deps.installer = s_installer;
    s_deps.app_manager = s_app_manager;
    s_deps.llm = s_llm;
    s_deps.sub = s_sub;
    ESP_RETURN_ON_FALSE(s_deps.tpl != NULL, ESP_ERR_INVALID_STATE, TAG, "builtin app template missing");

    s_job_queue = xQueueCreate(ODK_JOB_QUEUE_DEPTH, sizeof(odk_job_t *));
    ESP_RETURN_ON_FALSE(s_job_queue != NULL, ESP_ERR_NO_MEM, TAG, "job queue alloc failed");

    BaseType_t task_ok = xTaskCreatePinnedToCore(odk_app_task, "task_app_manager", ODK_APP_TASK_STACK,
                                                 NULL, ODK_APP_TASK_PRIORITY, NULL, ODK_APP_TASK_CORE);
    ESP_RETURN_ON_FALSE(task_ok == pdPASS, ESP_ERR_NO_MEM, TAG, "app task create failed");

    const esp_timer_create_args_t tick_args = {
        .callback = odk_tick_timer_cb,
        .name = "odk_tick",
    };
    esp_timer_handle_t tick_timer = NULL;
    ESP_RETURN_ON_ERROR(esp_timer_create(&tick_args, &tick_timer), TAG, "tick timer create failed");
    ESP_RETURN_ON_ERROR(esp_timer_start_periodic(tick_timer, ODK_TICK_PERIOD_US), TAG,
                        "tick timer start failed");

    const esp_console_cmd_t odk_cmd = {
        .command = "cerb",
        .help = "Open DeskOS App platform: cerb <gen \"<prompt>\" | apps | open <id> | close <id> | uninstall <id>>",
        .func = cmd_cerb,
    };
    ESP_RETURN_ON_ERROR(esp_console_cmd_register(&odk_cmd), TAG, "register 'cerb' command failed");

    ESP_LOGI(TAG, "Open DeskOS App platform ready - services registered: sandbox, installer, runtime, manager, svc_llm, gen, voice_ui");
    ESP_LOGI(TAG, "  packages partition mounted at %s (staging %s)", ODK_PACKAGES_MOUNT, ODK_STAGING_ROOT);
    ESP_LOGI(TAG, "  console: cerb ui \"<voice transcript>\" | cerb gen \"<prompt>\" | cerb apps | cerb open <id> | cerb close <id> | cerb uninstall <id> | cerb sub status|push|get");
    return ESP_OK;
}
