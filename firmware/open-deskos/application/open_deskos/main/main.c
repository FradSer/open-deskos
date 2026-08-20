/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "app_claw.h"
#include "app_fs.h"
#include "odk_composition.h"
#include "claw_version.h"
#include "claw_paths.h"
#include "open_deskos_version.h"
#include <string.h>
#include <sys/time.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdio.h>
#include "wifi_manager.h"
#include "time.h"
#include "nvs_flash.h"
#include "http_server.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_check.h"
#include "esp_system.h"
#include "odk_c6_slave_ota.h"
#include "odk_svc_llm_ports_idf.h"
#include "odk_display_bringup.h"
#include "odk_touch_bringup.h"
#include "odk_voice_ui.h"

/* Gate hosted_restart_host() so C6 transport failure cannot restart the P4.
 * Set to true by odk_net_probe_task after a successful C6 slave handshake.
 * Defined in esp-hosted: port_esp_hosted_host_os.c */
extern volatile bool g_odk_c6_restart_allowed;
#include "nvs.h"

#include "esp_board_manager_includes.h"
#include "captive_dns.h"
#include "cmd_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#if CONFIG_APP_CLAW_CAP_IM_WECHAT
#include "cap_im_wechat.h"
#endif
#include "app_config.h"

#if CONFIG_APP_CLAW_ENABLE_CLI
/* app_claw_cli.h is private to app_claw; declare the fallback entry we need
 * when app_claw_start fails before its own CLI start. */
esp_err_t app_claw_cli_start(void);
#endif

#define APP_ENABLE_MEM_LOG        (0)

/* Open DeskOS narrowed bring-up: when 1, app_main brings up the display and then
 * HOLDS, skipping the entire fork/platform init below. This isolates the panel
 * so "light the screen" can be confirmed on the Guition JC4880P443C before the
 * platform stages (which currently disturb the DPI stream — board_manager wires
 * wrong-board peripheral pins) are re-enabled one at a time. Set to 0 to
 * restore the full boot. */
#define ODK_DISPLAY_ISOLATION_TEST (0)

/* The active board_manager peripherals (board_peripherals.yaml) are the
 * LUMINA-P4/Osptek pinout, NOT the Guition JC4880P443C: it drives i2s on
 * GPIO20-23, where GPIO20 is the panel power-enable (VCI_EN) and GPIO23 is the
 * backlight on this class of module. Configuring those as I2S clocks blanks the
 * ST7701 panel while the backlight stays lit — the exact "backlight on, black"
 * symptom. The display is brought up directly (odk_display_bringup), so the
 * board_manager peripheral init is not needed for the narrowed bring-up. Skip
 * it until a correct Guition peripheral map exists. */
#define ODK_SKIP_BOARD_MANAGER (1)

/* The C6 is optional for the P4 launcher. A failed or absent ESP-Hosted
 * handshake must not restart the P4 or keep retrying indefinitely. */
#define ODK_TRY_WIFI (0)

/* When 1, force STA credentials below (bring-up / lab network). Overrides NVS
 * Wi-Fi SSID/password after app_config_load. Set to 0 for portal/NVS-only. */
#define ODK_WIFI_DEBUG_MODE (0)
#if ODK_WIFI_DEBUG_MODE
#define ODK_WIFI_DEBUG_SSID     "Vault 8"
#define ODK_WIFI_DEBUG_PASSWORD "123456790"
#endif

/* When 1, seed odk_llm NVS (endpoint + key) before composition so `cerb gen`
 * can hit the LAN CLIProxyAPI without the provisioning portal. */
#define ODK_LLM_DEBUG_MODE (1)
#if ODK_LLM_DEBUG_MODE
#define ODK_LLM_DEBUG_ENDPOINT "http://10.10.0.195:8317/v1/chat/completions"
#define ODK_LLM_DEBUG_API_KEY  "sk-dummy"
#define ODK_LLM_DEBUG_MODEL    "glm-5.2"
#endif

static const char *TAG = "app";

static app_config_t *s_config;
static app_claw_config_t *s_claw_config;

static esp_err_t app_allocate_runtime_state(void)
{
    if (!s_config) {
        s_config = calloc(1, sizeof(*s_config));
    }
    if (!s_claw_config) {
        s_claw_config = calloc(1, sizeof(*s_claw_config));
    }

    ESP_RETURN_ON_FALSE(s_config && s_claw_config, ESP_ERR_NO_MEM, TAG,
                        "Failed to allocate runtime state");

    return ESP_OK;
}

static void app_free_runtime_state(void)
{
    free(s_claw_config);
    s_claw_config = NULL;

    free(s_config);
    s_config = NULL;
}

static void log_wifi_startup_config(const app_config_t *config)
{
    ESP_LOGI(TAG,
             "Wi-Fi startup STA: ssid=%s pwd_len=%u",
             config->wifi_ssid[0] ? config->wifi_ssid : "(empty)",
             (unsigned)strlen(config->wifi_password));

    ESP_LOGI(TAG,
             "Wi-Fi startup AP: ssid=%s pwd_len=%u behavior=%s",
             config->ap_ssid[0] ? config->ap_ssid : "(auto:mac-suffix)",
             (unsigned)strlen(config->ap_password),
             config->ap_behavior[0] ? config->ap_behavior : "keep");
}

static void on_wifi_state_changed(bool connected, void *user_ctx)
{
    (void)user_ctx;

    wifi_manager_status_t status = {0};
    wifi_manager_get_status(&status);
    const char *ap_ssid = status.ap_active ? status.ap_ssid : NULL;

    ESP_LOGI(TAG, "Wi-Fi state: sta_connected=%d ap_active=%d mode=%s ap_ssid=%s",
             connected,
             status.ap_active,
             status.mode ? status.mode : "off",
             ap_ssid ? ap_ssid : "(none)");

    esp_err_t err = app_claw_set_network_status(connected, ap_ssid);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to update network emote: %s", esp_err_to_name(err));
    }
}

static esp_err_t main_load_config(app_config_t *config)
{
    return app_config_load(config);
}

static esp_err_t main_save_config(const app_config_t *config)
{
    esp_err_t err;
    app_claw_config_t *claw_config = NULL;

    ESP_RETURN_ON_FALSE(config, ESP_ERR_INVALID_ARG, TAG, "config is NULL");
    ESP_RETURN_ON_ERROR(app_config_validate_wifi(config, NULL), TAG, "Invalid Wi-Fi config");

    err = app_config_save(config);
    if (err != ESP_OK) {
        return err;
    }

    claw_config = calloc(1, sizeof(*claw_config));
    if (!claw_config) {
        ESP_LOGW(TAG, "Failed to allocate Claw config for runtime update");
        return ESP_OK;
    }
    app_config_to_claw(config, claw_config);
    err = app_claw_update_config(claw_config);
    free(claw_config);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "Failed to update running Claw config: %s", esp_err_to_name(err));
    }
    return ESP_OK;
}

static void main_copy_claw_to_app_config(const app_claw_config_t *src, app_config_t *dst)
{
    strlcpy(dst->llm_api_key, src->llm_api_key, sizeof(dst->llm_api_key));
    strlcpy(dst->llm_backend_type, src->llm_backend_type, sizeof(dst->llm_backend_type));
    strlcpy(dst->llm_model, src->llm_model, sizeof(dst->llm_model));
    strlcpy(dst->llm_base_url, src->llm_base_url, sizeof(dst->llm_base_url));
    strlcpy(dst->llm_auth_type, src->llm_auth_type, sizeof(dst->llm_auth_type));
    strlcpy(dst->llm_timeout_ms, src->llm_timeout_ms, sizeof(dst->llm_timeout_ms));
    strlcpy(dst->llm_max_tokens, src->llm_max_tokens, sizeof(dst->llm_max_tokens));
    strlcpy(dst->llm_default_image_max_bytes,
            src->llm_default_image_max_bytes,
            sizeof(dst->llm_default_image_max_bytes));
    strlcpy(dst->llm_max_tokens_field, src->llm_max_tokens_field, sizeof(dst->llm_max_tokens_field));
    strlcpy(dst->llm_supports_tools, src->llm_supports_tools, sizeof(dst->llm_supports_tools));
    strlcpy(dst->llm_supports_vision, src->llm_supports_vision, sizeof(dst->llm_supports_vision));
    strlcpy(dst->llm_image_remote_url_only,
            src->llm_image_remote_url_only,
            sizeof(dst->llm_image_remote_url_only));
}

static esp_err_t main_save_claw_config(const app_claw_config_t *config, void *user_ctx)
{
    esp_err_t err;
    app_config_t *app_config = NULL;

    (void)user_ctx;
    ESP_RETURN_ON_FALSE(config, ESP_ERR_INVALID_ARG, TAG, "config is NULL");

    app_config = calloc(1, sizeof(*app_config));
    ESP_RETURN_ON_FALSE(app_config, ESP_ERR_NO_MEM, TAG, "Failed to allocate app config for Claw save");

    err = app_config_load(app_config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to load config for Claw save: %s", esp_err_to_name(err));
        free(app_config);
        return err;
    }
    main_copy_claw_to_app_config(config, app_config);
    err = app_config_save(app_config);
    free(app_config);
    return err;
}

static esp_err_t main_get_wifi_status(http_server_wifi_status_t *status)
{
    ESP_RETURN_ON_FALSE(status, ESP_ERR_INVALID_ARG, TAG, "status is NULL");

    wifi_manager_status_t wifi_status = {0};
    wifi_manager_get_status(&wifi_status);
    status->wifi_connected = wifi_status.sta_connected;
    status->ip = wifi_status.sta_ip;
    status->ap_active = wifi_status.ap_active;
    status->ap_ssid = wifi_status.ap_ssid;
    status->ap_ip = wifi_status.ap_ip;
    status->wifi_mode = wifi_status.mode;
    return ESP_OK;
}

static void main_restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
}

static esp_err_t main_restart_device(void)
{
    BaseType_t ok = xTaskCreate(main_restart_task, "http_restart", 2048, NULL, 5, NULL);
    ESP_RETURN_ON_FALSE(ok == pdPASS, ESP_ERR_NO_MEM, TAG, "Failed to create restart task");
    return ESP_OK;
}

#if CONFIG_APP_CLAW_CAP_IM_WECHAT
static esp_err_t main_wechat_login_start(const char *account_id, bool force)
{
    return cap_im_wechat_qr_login_start(account_id, force);
}

static esp_err_t main_wechat_login_get_status(http_server_wechat_login_status_t *status)
{
    esp_err_t ret = ESP_OK;
    cap_im_wechat_qr_login_status_t *raw = NULL;

    ESP_RETURN_ON_FALSE(status, ESP_ERR_INVALID_ARG, TAG, "status is NULL");

    raw = calloc(1, sizeof(*raw));
    ESP_RETURN_ON_FALSE(raw, ESP_ERR_NO_MEM, TAG, "Failed to allocate login status");

    ESP_GOTO_ON_ERROR(cap_im_wechat_qr_login_get_status(raw), cleanup, TAG,
                      "Failed to query WeChat login status");

    memset(status, 0, sizeof(*status));
    status->active = raw->active;
    status->configured = raw->configured;
    status->completed = raw->completed;
    status->persisted = raw->persisted;
    strlcpy(status->session_key, raw->session_key, sizeof(status->session_key));
    strlcpy(status->status, raw->status, sizeof(status->status));
    strlcpy(status->message, raw->message, sizeof(status->message));
    strlcpy(status->qr_data_url, raw->qr_data_url, sizeof(status->qr_data_url));
    strlcpy(status->account_id, raw->account_id, sizeof(status->account_id));
    strlcpy(status->user_id, raw->user_id, sizeof(status->user_id));
    strlcpy(status->token, raw->token, sizeof(status->token));
    strlcpy(status->base_url, raw->base_url, sizeof(status->base_url));

cleanup:
    free(raw);
    return ret;
}

static esp_err_t main_wechat_login_cancel(void)
{
    return cap_im_wechat_qr_login_cancel();
}

static esp_err_t main_wechat_login_mark_persisted(void)
{
    return cap_im_wechat_qr_login_mark_persisted();
}
#endif

static esp_err_t init_nvs(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    return err;
}

/* Restore the wall clock persisted by `cerb settime` (NVS "odk_clock/epoch").
 * The P4 has no battery RTC; without this every power cycle starts at 1970
 * and the launcher's clock/date/Year read 00:00/0% until the Mac bridge
 * pushes the next settime. Restoring the last-known epoch makes boot-time
 * values correct immediately; the Mac refresh then tightens drift. */
static void restore_clock_from_nvs(void)
{
    nvs_handle_t h;
    if (nvs_open("odk_clock", NVS_READONLY, &h) != ESP_OK) {
        return;
    }
    int64_t epoch = 0;
    esp_err_t err = nvs_get_i64(h, "epoch", &epoch);
    nvs_close(h);
    if (err != ESP_OK || epoch <= 0) {
        return;
    }
    struct timeval tv = { .tv_sec = (time_t)epoch, .tv_usec = 0 };
    if (settimeofday(&tv, NULL) == 0) {
        ESP_LOGI(TAG, "clock restored from NVS: %lld", (long long)epoch);
    }
}

static esp_err_t init_timezone(const char *timezone)
{
    esp_err_t ret = ESP_OK;

    ESP_GOTO_ON_FALSE(timezone && timezone[0] != '\0', ESP_ERR_INVALID_ARG, tz_default, TAG,
                      "Timezone is empty.");
    ESP_GOTO_ON_FALSE(setenv("TZ", timezone, 1) == 0, ESP_FAIL, tz_default, TAG,
                      "Failed to set TZ env");
    tzset();
    ESP_LOGI(TAG, "Timezone set to %s", timezone);
    return ESP_OK;

tz_default:
    assert(setenv("TZ", "CST-8", 1) == 0);
    tzset();
    ESP_LOGI(TAG, "Timezone set to default: CST-8");
    return ret;
}

#if APP_ENABLE_MEM_LOG

static void print_task_stack_info(void)
{
#ifdef CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
    static TaskStatus_t s_task_status_snapshot[24];
    UBaseType_t count = uxTaskGetSystemState(s_task_status_snapshot,
                                             sizeof(s_task_status_snapshot) / sizeof(s_task_status_snapshot[0]),
                                             NULL);

    for (UBaseType_t i = 0; i < count; i++) {
        ESP_LOGI(TAG,
                 "Task %s  %u",
                 s_task_status_snapshot[i].pcTaskName,
                 s_task_status_snapshot[i].usStackHighWaterMark);
    }
#endif
}

/* Periodic task: print internal free, minimum free, and PSRAM free every 20s */
static void memory_monitor_task(void *arg)
{
    (void)arg;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        size_t internal_free = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
        size_t internal_min = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
        size_t psram_free = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
        ESP_LOGI(TAG, "Memory: internal_free=%u bytes, internal_min_free=%u bytes, psram_free=%u bytes",
                 (unsigned)internal_free, (unsigned)internal_min, (unsigned)psram_free);
        print_task_stack_info();
    }
}

#endif

#if ODK_TRY_WIFI
/* Snapshot of Wi-Fi credentials for the async probe task — app_main frees
 * s_config before this task may run. */
typedef struct {
    char wifi_ssid[sizeof(((app_config_t *)0)->wifi_ssid)];
    char wifi_password[sizeof(((app_config_t *)0)->wifi_password)];
    char ap_ssid[sizeof(((app_config_t *)0)->ap_ssid)];
    char ap_password[sizeof(((app_config_t *)0)->ap_password)];
    char ap_behavior[sizeof(((app_config_t *)0)->ap_behavior)];
} odk_net_probe_cfg_t;

static void odk_net_probe_task(void *arg)
{
    odk_net_probe_cfg_t *cfg = (odk_net_probe_cfg_t *)arg;
    /* Boot is already complete (display + cerb platform up) before this runs,
     * so a stalled esp-hosted handshake cannot regress it. wifi_manager_init()
     * soft-fails esp_wifi_init() internally, so a missing/incompatible C6 does
     * not abort — the esp-hosted logs above this line show the real outcome. */
    ESP_LOGW(TAG, "Open DeskOS net: probing C6/esp-hosted transport (async; boot already complete)");
    esp_err_t err = wifi_manager_init();
    ESP_LOGW(TAG, "Open DeskOS net: wifi_manager_init returned %s — see esp-hosted logs for C6 slave handshake",
             esp_err_to_name(err));
    if (err == ESP_OK) {
        /* C6 slave handshake OK — allow hosted_restart_host() for normal SDIO recovery. */
        g_odk_c6_restart_allowed = true;
        /* Factory C6 reports 0.0.0 against host 2.12.x → RPC timeouts. Upgrade
         * over SDIO (no #4 USB needed). On success, restart so the new slave
         * re-handshakes cleanly. */
        esp_err_t ota = odk_c6_slave_ota_if_needed();
        if (ota == ESP_OK) {
            ESP_LOGW(TAG, "Open DeskOS net: restarting host after C6 slave OTA");
            free(cfg);
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        }

        /* C6 handshake OK (OTA skipped or not needed) — bring up STA/AP. */
        esp_err_t wifi_err = wifi_manager_start(&(wifi_manager_config_t) {
            .sta_ssid = cfg && cfg->wifi_ssid[0] ? cfg->wifi_ssid : NULL,
            .sta_password = cfg ? cfg->wifi_password : NULL,
            .ap_ssid = cfg && cfg->ap_ssid[0] ? cfg->ap_ssid : NULL,
            .ap_password = cfg && cfg->ap_password[0] ? cfg->ap_password : NULL,
            .ap_behavior = cfg && cfg->ap_behavior[0] ? cfg->ap_behavior : NULL,
        });
        if (wifi_err != ESP_OK) {
            ESP_LOGE(TAG, "Open DeskOS net: wifi_manager_start failed: %s", esp_err_to_name(wifi_err));
        } else {
            ESP_LOGI(TAG, "Open DeskOS net: starting HTTP portal server");
            if (http_server_start() != ESP_OK) {
                ESP_LOGW(TAG, "http_server_start failed after Wi-Fi up");
            } else {
                ESP_LOGI(TAG, "Open DeskOS net: HTTP portal server up");
            }

            /* softAP IP/SSID may arrive a few hundred ms after esp_wifi_start. */
            wifi_manager_status_t status = {0};
            for (int i = 0; i < 20; ++i) {
                wifi_manager_get_status(&status);
                if (status.ap_active && status.ap_ip && status.ap_ip[0]) {
                    break;
                }
                vTaskDelay(pdMS_TO_TICKS(100));
            }

            if (captive_dns_start(&(captive_dns_config_t) {
                    .ap_netif = wifi_manager_get_ap_netif(),
                    .configure_dhcp_dns = true,
                }) != ESP_OK) {
                ESP_LOGW(TAG, "Captive DNS could not start, portal pop-up disabled");
            }

            if (status.ap_active) {
                const char *portal_auth = (cfg && cfg->ap_password[0]) ? "wpa2" : "open";
                ESP_LOGW(TAG,
                         "*** Provisioning portal: SSID=\"%s\" (auth=%s) IP=%s URL=http://%s/ ***",
                         status.ap_ssid,
                         portal_auth,
                         status.ap_ip,
                         status.ap_ip);
            }

            if (cfg && cfg->wifi_ssid[0] != '\0') {
                esp_err_t wait_err = wifi_manager_wait_connected(30000);
                if (wait_err == ESP_OK) {
                    wifi_manager_get_status(&status);
                    ESP_LOGI(TAG, "Wi-Fi STA ready: %s", status.sta_ip);
                } else if (wait_err == ESP_ERR_TIMEOUT) {
                    wifi_manager_get_status(&status);
                    ESP_LOGW(TAG,
                             "Wi-Fi STA not connected within wait window; retrying in background: mode=%s ap_active=%d ap_ip=%s",
                             status.mode ? status.mode : "off",
                             status.ap_active,
                             status.ap_ip ? status.ap_ip : "0.0.0.0");
                } else {
                    ESP_LOGW(TAG, "Wi-Fi STA wait returned error: %s", esp_err_to_name(wait_err));
                }
            }
        }
    }
    free(cfg);
    vTaskDelete(NULL);
}
#endif

void app_main(void)
{
    /* Open DeskOS: direct display bring-up FIRST. It runs fast (init + green
     * fill, no diagnostic cycle) so it does not block app_main long enough to
     * trip the Task Watchdog, and runs synchronously to avoid concurrent
     * SPI-flash access against the fork's init chain. */
    odk_display_bringup();
    if (odk_touch_bringup() != ESP_OK) {
        ESP_LOGW(TAG, "Open DeskOS: GT911 touch bring-up failed — UI will be display-only");
    }

    esp_log_level_set("esp-x509-crt-bundle", ESP_LOG_WARN);
    esp_log_level_set("http_reuse", ESP_LOG_WARN);

    ESP_LOGI(TAG, "ESP-Claw version: %s", claw_get_version());
    ESP_LOGI(TAG, "ESP-Claw git version: %s", claw_get_git_version());
    ESP_LOGI(TAG, "Open DeskOS version: %s", open_deskos_get_version());
    ESP_ERROR_CHECK(app_allocate_runtime_state());
    ESP_ERROR_CHECK(init_nvs());
    ESP_ERROR_CHECK(app_config_init());
    ESP_ERROR_CHECK(app_config_load(s_config));
#if ODK_WIFI_DEBUG_MODE
    strlcpy(s_config->wifi_ssid, ODK_WIFI_DEBUG_SSID, sizeof(s_config->wifi_ssid));
    strlcpy(s_config->wifi_password, ODK_WIFI_DEBUG_PASSWORD, sizeof(s_config->wifi_password));
    ESP_LOGW(TAG, "Open DeskOS Wi-Fi DEBUG: forcing STA ssid=\"%s\" (pwd_len=%u)",
             s_config->wifi_ssid, (unsigned)strlen(s_config->wifi_password));
#endif
    app_config_to_claw(s_config, s_claw_config);
    init_timezone(app_config_get_timezone(s_config)); // no need to check error
    restore_clock_from_nvs();
#if ODK_SKIP_BOARD_MANAGER
    ESP_LOGW(TAG, "Open DeskOS: skipping esp_board_manager_init (wrong-board peripheral pins disturb the panel)");
#else
    {
        /* Open DeskOS: board_manager may fail (display now handled above by
         * odk_display_bringup; board_manager's display_lcd device is removed
         * from board_devices.yaml). Soft-fail so the rest of boot continues. */
        esp_err_t bm_err = esp_board_manager_init();
        if (bm_err != ESP_OK) {
            ESP_LOGW(TAG, "esp_board_manager_init failed (0x%x) — continuing", (unsigned)bm_err);
        }
    }
#endif
    ESP_ERROR_CHECK(app_claw_ui_start());
    ESP_ERROR_CHECK(app_fs_init());

    /* Publish the resolved storage roots so any component can compose paths
     * without knowing whether data lives on flash or an SD card. */
    ESP_ERROR_CHECK(claw_paths_set(CLAW_PATH_DATA, app_fs_storage_base_path()));
    ESP_ERROR_CHECK(claw_paths_set(CLAW_PATH_SYSTEM, app_fs_system_base_path()));

    /* Open DeskOS: Wi-Fi (esp-hosted over C6) is optional at boot. The fork's
     * `wifi_manager_init` -> `esp_wifi_init` drives the esp-hosted transport,
     * which BLOCKS in `transport_drv_reconfigure()` waiting for a C6 slave
     * that is not up (HG-2). Soft-failing the call site is insufficient
     * (the block is inside esp_wifi_init). Skip Wi-Fi entirely on the
     * headless/no-C6 bring-up so the display (board manager, already
     * initialized above) + packages partition + cerb platform services
     * come up. Wi-Fi can be brought up later once the C6 link is up.
     * pulse-esp confirms the ST7701 panel lights on the P4 alone with zero
     * C6 involvement, so skipping Wi-Fi does not block display bring-up. */
    ESP_LOGW(TAG, "Open DeskOS: skipping Wi-Fi init (no C6/esp-hosted, headless bring-up)");
    ESP_ERROR_CHECK(http_server_init(&(http_server_config_t) {
        .storage_base_path = app_fs_storage_base_path(),
        .services = {
            .load_config = main_load_config,
            .save_config = main_save_config,
            .get_wifi_status = main_get_wifi_status,
            .restart_device = main_restart_device,
#if CONFIG_APP_CLAW_CAP_IM_WECHAT
            .wechat_login_start = main_wechat_login_start,
            .wechat_login_get_status = main_wechat_login_get_status,
            .wechat_login_cancel = main_wechat_login_cancel,
            .wechat_login_mark_persisted = main_wechat_login_mark_persisted,
#endif
        },
    }));
    ESP_ERROR_CHECK(wifi_manager_register_state_callback(on_wifi_state_changed, NULL));

    log_wifi_startup_config(s_config);

    /* Open DeskOS: wifi_manager_start -> esp_wifi_start drives the esp-hosted
     * transport, which BLOCKS in transport_drv_reconfigure() waiting for a
     * C6 slave that is not up (HG-2). Skip the whole wifi_start/portal block
     * on the headless no-C6 bring-up. The http_server registered above stays
     * inert (no netif) but does not block boot. */
    ESP_LOGW(TAG, "Open DeskOS: skipping wifi_manager_start (no C6/esp-hosted)");

    ESP_ERROR_CHECK(app_claw_set_save_config_callback(main_save_claw_config, NULL));
    /* Open DeskOS: app_claw_start (the fork's LLM agent framework) depends on
     * Wi-Fi/esp-hosted being up. When the C6 slave is not ready (HG-2), it
     * returns ESP_FAIL and the upstream ESP_ERROR_CHECK aborts, preventing
     * the Open DeskOS app platform (odk_composition_init, below) from starting.
     * Degrade so the serial console + packages + cerb services still come up
     * headless; the claw agent can be started later once Wi-Fi is up. */
    {
        esp_err_t claw_err = app_claw_start(s_claw_config);
        if (claw_err != ESP_OK) {
            ESP_LOGW(TAG, "app_claw_start skipped (C6/Wi-Fi not ready?): %s",
                     esp_err_to_name(claw_err));
            /* app_claw_cli_start is the last step of app_claw_start — when the
             * agent stack fails early (session/fatfs/Wi-Fi), still bring up the
             * USB-JTAG REPL so `cerb ui` / `cerb gen` remain usable. */
#if CONFIG_APP_CLAW_ENABLE_CLI
            esp_err_t cli_err = app_claw_cli_start();
            if (cli_err != ESP_OK) {
                ESP_LOGE(TAG, "app_claw_cli_start failed: %s", esp_err_to_name(cli_err));
            }
#endif
        }
    }
#if CONFIG_APP_CLAW_CAP_IM_LOCAL
    ESP_ERROR_CHECK(http_server_webim_bind_im());
#endif

    register_wifi_command();

#if ODK_LLM_DEBUG_MODE
    {
        nvs_handle_t h;
        esp_err_t nvs_err = nvs_open(ODK_LLM_NVS_NAMESPACE, NVS_READWRITE, &h);
        if (nvs_err == ESP_OK) {
            nvs_set_str(h, "llm_endpoint", ODK_LLM_DEBUG_ENDPOINT);
            nvs_set_str(h, "llm_api_key", ODK_LLM_DEBUG_API_KEY);
            nvs_set_str(h, "llm_model", ODK_LLM_DEBUG_MODEL);
            nvs_commit(h);
            nvs_close(h);
            ESP_LOGW(TAG, "Open DeskOS LLM DEBUG: seeded NVS endpoint=%s model=%s",
                     ODK_LLM_DEBUG_ENDPOINT, ODK_LLM_DEBUG_MODEL);
        } else {
            ESP_LOGE(TAG, "Open DeskOS LLM DEBUG: nvs_open(%s) failed: %s",
                     ODK_LLM_NVS_NAMESPACE, esp_err_to_name(nvs_err));
        }
    }
#endif

    /* Open DeskOS app platform: mount the packages partition, wire the ports,
     * and register the `cerb` console command. Logged rather than
     * ESP_ERROR_CHECK'd so a composition hiccup never panics boot (scenario
     * 1: no panic). */
    esp_err_t odk_err = odk_composition_init();
    if (odk_err != ESP_OK) {
        ESP_LOGE(TAG, "Open DeskOS app platform init failed: %s", esp_err_to_name(odk_err));
    }

    /* Boot straight into the AIODI launcher — no console command needed. The
     * "launcher" branch of odk_voice_ui_run needs no LLM; display/touch/fs/
     * paths are all up by here. A later `cerb ui ...` is refused ("already
     * running") by the re-launch guard, so this cannot deadlock the adapter. */
    {
        char ui_out[96] = {0};
        if (odk_voice_ui_run(NULL, "launcher", ui_out, sizeof(ui_out)) != ODK_OK) {
            ESP_LOGW(TAG, "boot UI launch failed: %s", ui_out);
        } else {
            ESP_LOGI(TAG, "boot UI up: %s", ui_out);
        }
    }

#if ODK_TRY_WIFI
    /* Probe the C6 esp-hosted link last, in its own task, so a stalled handshake
     * cannot regress the already-up display + cerb platform (see macro note).
     * Snapshot Wi-Fi credentials before app_free_runtime_state(). */
    {
        odk_net_probe_cfg_t *probe_cfg = calloc(1, sizeof(*probe_cfg));
        if (probe_cfg && s_config) {
            strlcpy(probe_cfg->wifi_ssid, s_config->wifi_ssid, sizeof(probe_cfg->wifi_ssid));
            strlcpy(probe_cfg->wifi_password, s_config->wifi_password, sizeof(probe_cfg->wifi_password));
            strlcpy(probe_cfg->ap_ssid, s_config->ap_ssid, sizeof(probe_cfg->ap_ssid));
            strlcpy(probe_cfg->ap_password, s_config->ap_password, sizeof(probe_cfg->ap_password));
            strlcpy(probe_cfg->ap_behavior, s_config->ap_behavior, sizeof(probe_cfg->ap_behavior));
        }
        if (xTaskCreate(odk_net_probe_task, "odk_net", 16384, probe_cfg, 4, NULL) != pdPASS) {
            ESP_LOGE(TAG, "failed to create odk_net probe task");
            free(probe_cfg);
        }
    }
#endif

#if APP_ENABLE_MEM_LOG
    /* Start memory monitor: print internal free, min free, PSRAM free every 20s */
    xTaskCreate(memory_monitor_task, "mem_mon", 4096, NULL, 1, NULL);
#endif

    app_free_runtime_state();
}
