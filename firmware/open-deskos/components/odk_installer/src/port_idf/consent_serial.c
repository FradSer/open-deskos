/*
 * consent_serial.c — odk_consent_port_t backed by a serial y/n prompt
 * (FR-14 install-time authorization on a headless board with no consent
 * screen yet). Presents the declared capability list on the console and
 * reads a single keypress; the elapsed timeout with no explicit 'y' is
 * treated as deny. Excluded from the host build (src/port_idf/).
 *
 * The composition root routes cerb console commands through a worker task and
 * blocks the REPL task on a completion semaphore while that worker runs, so
 * the REPL is not reading stdin during install and this prompt owns the
 * console input window uncontended.
 */
#include "odk_installer_ports_idf.h"

#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_timer.h"

#define CONSENT_POLL_MS 50

void odk_consent_idf_ctx_init(odk_consent_idf_ctx_t *ctx, uint32_t timeout_ms)
{
    ctx->timeout_ms = timeout_ms;
}

static bool serial_confirm(void *ctx, const odk_manifest_t *m)
{
    odk_consent_idf_ctx_t *c = ctx;
    uint32_t timeout_ms = (c != NULL && c->timeout_ms > 0) ? c->timeout_ms : 60000;

    printf("\n[cerb] App '%s' v%s requests capabilities:\n", m->app_id, m->version);
    if (m->n_capabilities == 0) {
        printf("  (none)\n");
    }
    for (size_t i = 0; i < m->n_capabilities; i++) {
        printf("  - %s\n", m->capabilities[i]);
    }
    printf("[cerb] Approve install? [y/N] (%us timeout = deny): ",
           (unsigned)(timeout_ms / 1000));
    fflush(stdout);

    int fd = STDIN_FILENO;
    int old_flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, old_flags | O_NONBLOCK);

    int64_t deadline_us = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    bool approved = false;
    while (esp_timer_get_time() < deadline_us) {
        char ch;
        int r = read(fd, &ch, 1);
        if (r == 1) {
            if (ch == 'y' || ch == 'Y') {
                approved = true;
                break;
            }
            if (ch == 'n' || ch == 'N' || ch == '\r' || ch == '\n') {
                approved = false;
                break;
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(CONSENT_POLL_MS));
        }
    }

    fcntl(fd, F_SETFL, old_flags);
    printf("\n[cerb] install %s\n", approved ? "approved" : "denied");
    return approved;
}

const odk_consent_port_t odk_consent_port_idf = {
    .confirm = serial_confirm,
};
