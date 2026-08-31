/*
 * sim_voice_ui.h — sim-side "AI generates Lua -> runs as UI" link.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include "odk_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Take a voice transcript, call the real svc_llm (host LLM ports), run the
 * generated LVGL Lua on the sim's SDL2 window. Replaces any running UI. */
odk_err_t sim_voice_ui_run(const char *transcript);

/* Drive the running generated UI's tick() from the sim main loop. No-op if none. */
void sim_voice_ui_tick(void);

/* Tear down the running generated UI. */
void sim_voice_ui_stop(void);

#ifdef __cplusplus
}
#endif
