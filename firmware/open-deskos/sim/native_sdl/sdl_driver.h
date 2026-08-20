/*
 * sdl_driver.h — native SDL2 display + touch surface for the open-deskos simulator.
 *
 * Mirrors pulse-esp/sim/sdl_driver.cpp but routes through the firmware's own
 * flush path: the real lua_lvgl_flush_cb calls esp_lcd_panel_draw_bitmap (host
 * impl in sim_esp_compat.c), which blits into the SDL texture owned here.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Native panel resolution — the Guition JC4880P443C portrait canvas (memory
 * [[aiodi-ui-design-standard]] / [[guition-jc4880-csvke-bsp]]). */
#define ODK_SIM_WIDTH  480
#define ODK_SIM_HEIGHT 800

/* Sentinel lightuserdata handed to Lua as PANEL / IO / TOUCH. Distinct from
 * any valid pointer so the firmware's NULL-checks still behave. IO is non-NULL
 * because the sim forces PANEL_IF=IO and lua_lvgl_init requires an IO handle. */
#define ODK_SIM_PANEL_HANDLE  ((void *)0xC2B00001u)
#define ODK_SIM_IO_HANDLE     ((void *)0xC2B00002u)
#define ODK_SIM_TOUCH_HANDLE  ((void *)0xC2B00003u)

/* Create the SDL2 window + renderer + RGB565 streaming texture. Idempotent.
 * Returns true on success, false on failure (no display server, etc.). */
bool sim_sdl_init(void);

/* Pointer (mouse) state for the Lua `touch` module and the LVGL indev. */
void sim_sdl_pointer_get(int *x, int *y, bool *pressed);

/* Drive the pointer directly, as if the mouse had moved/clicked. Lets a tap be
 * synthesised with no human at the window (see ODK_SIM_TAP in sim_main.c) --
 * the input counterpart of sim_sdl_save_bmp. A real SDL mouse event overrides
 * it on the next pump, so this never fights a live user. */
void sim_sdl_pointer_set(int x, int y, bool pressed);

/* Pump the SDL event queue once (window/mouse). Returns false on quit. */
bool sim_sdl_pump_events(void);

/* Blit an RGB565 sub-rect of the given pixel map into the streaming texture
 * and present. Called from the host esp_lcd_panel_draw_bitmap (the flush
 * terminus) with panel coords. */
void sim_sdl_blit_rgb565(int x, int y, int w, int h, const uint8_t *px_map);

/* Read back the presented framebuffer and save it as a BMP at `path`. Used for
 * headless visual verification (see ODK_SIM_SHOT in sim_main.c). Returns true
 * on success. */
bool sim_sdl_save_bmp(const char *path);

#ifdef __cplusplus
}
#endif
