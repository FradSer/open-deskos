/*
 * sdl_driver.c — native SDL2 display surface for the open-deskos simulator.
 *
 * The firmware's real lua_lvgl_flush_cb (lua_lvgl_runtime.c) calls
 * esp_lcd_panel_draw_bitmap; the host impl (sim_esp_compat.c) forwards here,
 * blitting the RGB565 pixel map into a streaming SDL texture. This keeps
 * lua_module_lvgl source 100% shared with firmware — the pulse-esp hallmark.
 *
 * On the IO/PARTIAL render path the display color format is forced to RGB565
 * (lua_lvgl_runtime.c:831) and lua_lvgl_panel_requires_color_swap swaps the
 * 16-bit words in place for IO panels, so px_map arrives as RGB565 with bytes
 * in SPI-order. We present it to SDL_PIXELFORMAT_RGB565; SDL interprets the
 * 16-bit value host-endian, so a byte-swap is applied here to undo the IO
 * swap before the texture update.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "sdl_driver.h"

#include <SDL2/SDL.h>
#include <stdlib.h>
#include <string.h>

static SDL_Window   *s_win;
static SDL_Renderer *s_rend;
static SDL_Texture  *s_tex;

static int  s_mouse_x = 0;
static int  s_mouse_y = 0;
static bool s_mouse_down = false;

static int16_t clamp_i16(int v, int lo, int hi)
{
    if (v < lo) return (int16_t)lo;
    if (v > hi) return (int16_t)hi;
    return (int16_t)v;
}

bool sim_sdl_init(void)
{
    if (s_win) return true;

    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        fprintf(stderr, "[sim] SDL_Init failed: %s\n", SDL_GetError());
        return false;
    }
    SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "1");

    /* Window scale vs the 480x800 logical panel. Was 1.5x; shrunk to 0.75 of
     * that → 1.125x (9/8) so it fits smaller desktop space. */
    s_win = SDL_CreateWindow("open-deskos simulator",
                             SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                             ODK_SIM_WIDTH * 9 / 8, ODK_SIM_HEIGHT * 9 / 8, 0);
    if (!s_win) {
        fprintf(stderr, "[sim] SDL_CreateWindow failed: %s\n", SDL_GetError());
        return false;
    }
    s_rend = SDL_CreateRenderer(s_win, -1, SDL_RENDERER_ACCELERATED);
    if (!s_rend) {
        /* Sandbox / no GPU: fall back to software so headless shots still work. */
        s_rend = SDL_CreateRenderer(s_win, -1, SDL_RENDERER_SOFTWARE);
    }
    if (!s_rend) {
        fprintf(stderr, "[sim] SDL_CreateRenderer failed: %s\n", SDL_GetError());
        return false;
    }
    SDL_RenderSetLogicalSize(s_rend, ODK_SIM_WIDTH, ODK_SIM_HEIGHT);
    s_tex = SDL_CreateTexture(s_rend, SDL_PIXELFORMAT_RGB565,
                              SDL_TEXTUREACCESS_STREAMING,
                              ODK_SIM_WIDTH, ODK_SIM_HEIGHT);
    if (!s_tex) {
        fprintf(stderr, "[sim] SDL_CreateTexture failed: %s\n", SDL_GetError());
        return false;
    }

    /* Clear to black so the first partial flushes don't show garbage. */
    uint16_t *black = (uint16_t *)calloc((size_t)ODK_SIM_WIDTH * ODK_SIM_HEIGHT, sizeof(uint16_t));
    if (black) {
        SDL_UpdateTexture(s_tex, NULL, black, ODK_SIM_WIDTH * 2);
        free(black);
    }
    SDL_SetRenderDrawColor(s_rend, 0, 0, 0, 255);
    SDL_RenderClear(s_rend);
    SDL_RenderCopy(s_rend, s_tex, NULL, NULL);
    SDL_RenderPresent(s_rend);
    return true;
}

void sim_sdl_pointer_get(int *x, int *y, bool *pressed)
{
    if (x) *x = s_mouse_x;
    if (y) *y = s_mouse_y;
    if (pressed) *pressed = s_mouse_down;
}

void sim_sdl_pointer_set(int x, int y, bool pressed)
{
    s_mouse_x = clamp_i16(x, 0, ODK_SIM_WIDTH - 1);
    s_mouse_y = clamp_i16(y, 0, ODK_SIM_HEIGHT - 1);
    s_mouse_down = pressed;
}

bool sim_sdl_pump_events(void)
{
    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
        switch (ev.type) {
        case SDL_QUIT:
            return false;
        case SDL_MOUSEMOTION:
            s_mouse_x = clamp_i16(ev.motion.x, 0, ODK_SIM_WIDTH - 1);
            s_mouse_y = clamp_i16(ev.motion.y, 0, ODK_SIM_HEIGHT - 1);
            break;
        case SDL_MOUSEBUTTONDOWN:
            if (ev.button.button == SDL_BUTTON_LEFT) {
                s_mouse_x = clamp_i16(ev.button.x, 0, ODK_SIM_WIDTH - 1);
                s_mouse_y = clamp_i16(ev.button.y, 0, ODK_SIM_HEIGHT - 1);
                s_mouse_down = true;
            }
            break;
        case SDL_MOUSEBUTTONUP:
            if (ev.button.button == SDL_BUTTON_LEFT) {
                s_mouse_x = clamp_i16(ev.button.x, 0, ODK_SIM_WIDTH - 1);
                s_mouse_y = clamp_i16(ev.button.y, 0, ODK_SIM_HEIGHT - 1);
                s_mouse_down = false;
            }
            break;
        default:
            break;
        }
    }
    return true;
}

void sim_sdl_blit_rgb565(int x, int y, int w, int h, const uint8_t *px_map)
{
    if (!s_tex || !px_map || w <= 0 || h <= 0) return;

    /* Clamp to canvas — LVGL should stay in-bounds, but be defensive. The
     * px_map row stride is the ORIGINAL area width, so advance the pointer
     * using the pre-clamp row width before narrowing w. */
    int x2 = x + w, y2 = y + h;
    int row_bytes = w * 2; /* original stride, before x-clamp narrows w */
    if (x < 0) { px_map += (size_t)(-x) * 2; w += x; x = 0; }
    if (y < 0) { px_map += (size_t)(-y) * (size_t)row_bytes; h += y; y = 0; }
    if (x2 > ODK_SIM_WIDTH)  w = ODK_SIM_WIDTH  - x;
    if (y2 > ODK_SIM_HEIGHT) h = ODK_SIM_HEIGHT - y;
    if (w <= 0 || h <= 0) return;

    /* Undo the IO-panel byte swap the firmware applied (RGB565 word swap) so
     * SDL's host-endian RGB565 reads correctly. In place on a scratch copy. */
    size_t px = (size_t)w * (size_t)h;
    uint8_t *buf = (uint8_t *)malloc(px * 2);
    if (!buf) {
        /* Out of memory: update straight from px_map (colors may be swapped). */
        SDL_Rect rect = {x, y, w, h};
        SDL_UpdateTexture(s_tex, &rect, px_map, w * 2);
    } else {
        for (size_t i = 0; i < px; i++) {
            buf[i * 2]     = px_map[i * 2 + 1];
            buf[i * 2 + 1] = px_map[i * 2];
        }
        SDL_Rect rect = {x, y, w, h};
        SDL_UpdateTexture(s_tex, &rect, buf, w * 2);
        free(buf);
    }

    SDL_SetRenderDrawColor(s_rend, 0, 0, 0, 255);
    SDL_RenderClear(s_rend);
    SDL_RenderCopy(s_rend, s_tex, NULL, NULL);
    SDL_RenderPresent(s_rend);
}

bool sim_sdl_save_bmp(const char *path)
{
    if (!s_rend || !s_tex || !path) return false;

    /* Redraw the current texture onto the backbuffer, then read *that* back —
     * reading after a RenderPresent would sample the swapped (undefined) buffer
     * on double-buffered renderers. */
    SDL_SetRenderDrawColor(s_rend, 0, 0, 0, 255);
    SDL_RenderClear(s_rend);
    SDL_RenderCopy(s_rend, s_tex, NULL, NULL);

    int ow = 0, oh = 0;
    SDL_GetRendererOutputSize(s_rend, &ow, &oh);
    if (ow <= 0 || oh <= 0) return false;

    SDL_Surface *surf = SDL_CreateRGBSurfaceWithFormat(0, ow, oh, 32,
                                                       SDL_PIXELFORMAT_ARGB8888);
    if (!surf) return false;

    bool ok = false;
    if (SDL_RenderReadPixels(s_rend, NULL, SDL_PIXELFORMAT_ARGB8888,
                             surf->pixels, surf->pitch) == 0) {
        ok = (SDL_SaveBMP(surf, path) == 0);
    }
    SDL_FreeSurface(surf);
    return ok;
}
