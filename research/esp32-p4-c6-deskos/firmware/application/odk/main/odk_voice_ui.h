/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice → UI demo path (esp-claw style): transcript → LLM → Lua+LVGL on the
 * live Guition panel. Microphone ASR is out of scope; `cerb ui "<text>"`
 * simulates the voice transcript.
 */
#pragma once

#include "odk_err.h"
#include "odk_sub.h"
#include "odk_svc_llm.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Generate LVGL Lua from a voice-like transcript and run it on the panel. */
odk_err_t odk_voice_ui_run(odk_svc_llm_t *llm, const char *transcript,
                             char *out, size_t outlen);

/* Stop the active voice UI runner (safe if none). */
void odk_voice_ui_stop(void);

/* Wire the host-pushed subscription snapshot store so the launcher's Lua can
 * read it via sub_get()/sub_request_fresh(). NULL before the composition root
 * sets it; the launcher falls back to placeholders when unset. */
void odk_voice_ui_set_sub(odk_sub_t *sub);

#ifdef __cplusplus
}
#endif
