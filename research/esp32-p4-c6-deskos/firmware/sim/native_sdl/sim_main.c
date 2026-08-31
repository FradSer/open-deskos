/*
 * sim_main.c — native SDL2 composition root for the open-deskos simulator.
 *
 * Mirrors pulse-esp/sim/sim_main.cpp (SDL2 + real LVGL tick loop) and the
 * Emscripten web sim's esp_claw_sim.c (register the real C luaopen_lvgl,
 * inject the PANEL/WIDTH/... globals launcher.lua reads). Compiles the real,
 * unmodified lua_module_lvgl — the pulse-esp "same sources" hallmark.
 *
 * Render-path steering: the Shell Runner calls lvgl.init(PANEL, nil, W, H,
 * PANEL_IF, {buffer_lines, tick_ms, task_period_ms}). On device PANEL_IF is MIPI_DSI,
 * which routes lua_lvgl_init into the esp_lv_adapter TRIPLE_PARTIAL path —
 * a path the host cannot satisfy without the real adapter component. So the
 * sim injects PANEL_IF = lvgl.PANEL_IF_IO and patches lvgl.init to force
 * render="partial", steering lua_lvgl_init onto the hand-rolled PARTIAL path
 * whose only host dependency is esp_lcd_panel_draw_bitmap (-> SDL blit).
 *
 * LVGL ticking: the build defines __EMSCRIPTEN__ for lua_module_lvgl so its
 * process_events (called by the Shell Runner) drives lv_timer_handler, its
 * xTaskCreatePinnedToCore path is skipped, and its FS data_root defaults to "/".
 * The esp_timer pump (sim_esp_compat_pump_once) fires lua_lvgl_tick_timer_cb
 * -> lv_tick_inc each loop iteration.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "lvgl.h"

#include "esp_err.h"
#include "odk_err.h"
#include "sdl_driver.h"
#include "lua_module_lvgl.h"
#include "odk_svc_llm.h"
#include "host_llm.h"

/* Host Lua module stubs (host_lua_modules.c). */
int luaopen_delay(lua_State *L);

static const char *TAG = "sim";

/* Directory containing the AIODI launcher + aiodi Lua sources + fonts/. */
#define SIM_LUA_LIB_DIR  "lib"
#define SIM_FONT_DIR     "fonts"

/* ----------------------------------------------------------------- tap injection */

/* ODK_SIM_TAP="x,y@frame[;x,y@frame...]" synthesises taps at the given frame
 * numbers, so navigation (tile -> app -> Back -> home) can be verified headless
 * alongside ODK_SIM_SHOT. Without it nothing here runs and the mouse behaves
 * exactly as before. */
#define SIM_TAP_MAX          8
#define SIM_TAP_HOLD_FRAMES  12  /* press..release: LVGL needs both to emit CLICKED */

typedef struct {
    int x, y;
    long frame;
} sim_tap_t;

static sim_tap_t s_taps[SIM_TAP_MAX];
static int s_tap_count;

static void sim_parse_taps(const char *spec)
{
    while (spec != NULL && *spec != '\0' && s_tap_count < SIM_TAP_MAX) {
        int x, y;
        long f;
        if (sscanf(spec, "%d,%d@%ld", &x, &y, &f) != 3) {
            fprintf(stderr, "[sim] ODK_SIM_TAP: bad entry '%s' (want x,y@frame)\n", spec);
            return;
        }
        if (f < 1) {
            /* Frames are 1-based (the loop increments before dispatching), so
             * @0 would be accepted and then never fire. Say so instead. */
            fprintf(stderr, "[sim] ODK_SIM_TAP: frame must be >= 1, got %ld\n", f);
            return;
        }
        s_taps[s_tap_count++] = (sim_tap_t){ .x = x, .y = y, .frame = f };
        fprintf(stderr, "[sim] tap scheduled: (%d,%d) at frame %ld\n", x, y, f);
        spec = strchr(spec, ';');
        if (spec != NULL) {
            spec++;
        }
    }
}

static void sim_drive_taps(long frame)
{
    for (int i = 0; i < s_tap_count; i++) {
        if (frame == s_taps[i].frame) {
            sim_sdl_pointer_set(s_taps[i].x, s_taps[i].y, true);
        } else if (frame == s_taps[i].frame + SIM_TAP_HOLD_FRAMES) {
            sim_sdl_pointer_set(s_taps[i].x, s_taps[i].y, false);
        }
    }
}

/* ------------------------------------------------------------------ drag injection */

/* ODK_SIM_DRAG="x1,y1;x2,y2@f0:f1" synthesises a press at (x1,y1) on frame f0,
 * linearly interpolating the pointer to (x2,y2) by frame f1, then releases.
 * This drives LVGL's scroll/snap so the launcher pager can be exercised
 * headless (a tap cannot scroll). */
#define SIM_DRAG_MAX 4

typedef struct {
    int x1, y1, x2, y2;
    long f0, f1;
} sim_drag_t;

static sim_drag_t s_drags[SIM_DRAG_MAX];
static int s_drag_count;

static void sim_parse_drags(const char *spec)
{
    /* ODK_SIM_DRAG supports up to SIM_DRAG_MAX drags, each "x1,y1;x2,y2@f0:f1",
     * separated by '|'. */
    while (spec != NULL && *spec != '\0' && s_drag_count < SIM_DRAG_MAX) {
        int x1, y1, x2, y2;
        long f0, f1;
        if (sscanf(spec, "%d,%d;%d,%d@%ld:%ld", &x1, &y1, &x2, &y2, &f0, &f1) != 6) {
            fprintf(stderr, "[sim] ODK_SIM_DRAG: bad entry '%s' (want x1,y1;x2,y2@f0:f1, '|'-separated)\n", spec);
            return;
        }
        if (f0 < 1 || f1 <= f0) {
            fprintf(stderr, "[sim] ODK_SIM_DRAG: bad frames %ld..%ld (want f0>=1, f1>f0)\n", f0, f1);
            return;
        }
        s_drags[s_drag_count++] = (sim_drag_t){ .x1 = x1, .y1 = y1, .x2 = x2, .y2 = y2, .f0 = f0, .f1 = f1 };
        fprintf(stderr, "[sim] drag scheduled: (%d,%d)->(%d,%d) @%ld:%ld\n", x1, y1, x2, y2, f0, f1);
        const char *pipe = strchr(spec, '|');
        spec = pipe ? pipe + 1 : NULL;
    }
}

static void sim_drive_drags(long frame)
{
    for (int i = 0; i < s_drag_count; i++) {
        sim_drag_t *d = &s_drags[i];
        if (frame == d->f0) {
            sim_sdl_pointer_set(d->x1, d->y1, true);
            fprintf(stderr, "[sim] drag press (%d,%d) @%ld\n", d->x1, d->y1, frame);
        } else if (frame > d->f0 && frame < d->f1) {
            long span = d->f1 - d->f0;
            long t = frame - d->f0;
            int x = d->x1 + (int)((long)(d->x2 - d->x1) * t / span);
            int y = d->y1 + (int)((long)(d->y2 - d->y1) * t / span);
            sim_sdl_pointer_set(x, y, true);
            if (frame % 10 == 0) {
                fprintf(stderr, "[sim] drag move (%d,%d) @%ld\n", x, y, frame);
            }
        } else if (frame == d->f1) {
            sim_sdl_pointer_set(d->x2, d->y2, false);
            fprintf(stderr, "[sim] drag release (%d,%d) @%ld\n", d->x2, d->y2, frame);
        }
    }
}

/* ----------------------------------------------------------------- lvgl.init patch */

/* Save the original lvgl.init (the real C lua_lvgl_init) and wrap it so the
 * 6th-arg opts table carries render="partial", forcing the hand-rolled
 * PARTIAL flush path (no esp_lv_adapter) on host. Mirrors the web sim's
 * sim_patch_lvgl_module / sim_lvgl_init closure trick. */
static int sim_lvgl_init_wrap(lua_State *L)
{
    int nargs = lua_gettop(L);

    /* The sim forces PANEL_IF=IO (to dodge the esp_lv_adapter path), and the
     * IO path requires a non-NULL io_handle. launcher.lua passes nil as the
     * 2nd arg (it was written for MIPI_DSI, where IO is unused). Substitute
     * the sim's IO sentinel whenever the caller passed nil. */
    if (nargs >= 2 && lua_isnil(L, 2)) {
        lua_pushlightuserdata(L, ODK_SIM_IO_HANDLE);
        lua_replace(L, 2);
    }

    /* Ensure a 6th-arg opts table exists; force render="partial". */
    if (nargs < 6 || lua_isnil(L, 6)) {
        lua_settop(L, 5);
        lua_newtable(L);
        nargs = 6;
    }
    if (lua_istable(L, 6)) {
        lua_pushstring(L, "partial");
        lua_setfield(L, 6, "render");
    }
    /* Upvalue(1) is the original lua_lvgl_init; call it via pcall so an
     * internal luaL_error propagates as a protected Lua error instead of an
     * unprotected long-jump PANIC. */
    lua_pushvalue(L, lua_upvalueindex(1));
    lua_insert(L, 1); /* move original fn below args: fn, args... */
    if (lua_pcall(L, nargs, LUA_MULTRET, 0) != LUA_OK) {
        return lua_error(L); /* re-throw within the current protected frame */
    }
    return lua_gettop(L);
}

static void sim_patch_lvgl_init(lua_State *L)
{
    lua_getglobal(L, "lvgl");
    if (!lua_istable(L, -1)) {
        fprintf(stderr, "[sim] lvgl module not a table\n");
        lua_pop(L, 1);
        return;
    }
    lua_getfield(L, -1, "init");           /* lvgl, init */
    if (lua_isfunction(L, -1)) {
        lua_pushcclosure(L, sim_lvgl_init_wrap, 1);  /* wraps the original */
        lua_setfield(L, -2, "init");       /* lvgl */
    } else {
        lua_pop(L, 1);
    }
    lua_pop(L, 1); /* lvgl */
}

/* --------------------------------------------------------------- module setup */

/* Lua-callable LLM completion for the Chat app: llm_complete(system, user) ->
 * response string, or nil + error. Uses the host LLM ports (same as the
 * voice-UI path). BLOCKING - the Chat app shows a "Thinking..." label + flushes
 * before calling. Sim-only; the device registers its own (IDF ports) or the
 * Chat app falls back to a stub if llm_complete is nil. */
static odk_svc_llm_t *s_chat_llm = NULL;

static int sim_lua_llm_complete(lua_State *L)
{
    const char *system = luaL_optstring(L, 1, "");
    const char *user = luaL_optstring(L, 2, "");
    if (s_chat_llm == NULL) {
        s_chat_llm = svc_llm_create(&host_llm_http_port, NULL,
                                    &host_llm_kv_port, NULL,
                                    &host_llm_clock_port, NULL, 1000);
    }
    if (s_chat_llm == NULL) {
        lua_pushnil(L);
        lua_pushstring(L, "svc_llm_create failed");
        return 2;
    }
    char *buf = (char *)malloc(8192);
    if (buf == NULL) {
        lua_pushnil(L);
        lua_pushstring(L, "oom");
        return 2;
    }
    odk_llm_usage_t usage = {0};
    odk_err_t err = svc_llm_complete(s_chat_llm, system, user, buf, 8192, &usage);
    if (err != ODK_OK) {
        free(buf);
        lua_pushnil(L);
        lua_pushfstring(L, "svc_llm_complete err %d", (int)err);
        return 2;
    }
    lua_pushstring(L, buf);
    free(buf);
    return 1;
}

/* Lua-callable u32 KV (the odk_kv port - NVS on device, in-memory in sim).
 * kv_get(key) -> int | nil; kv_set(key, int) -> (). Used by the Settings app.
 * Sim-only binding; device registers its own (NVS) or Settings falls back. */
static int sim_lua_kv_get(lua_State *L)
{
    const char *key = luaL_checkstring(L, 1);
    uint32_t v = 0;
    if (host_llm_kv_port.get_u32(NULL, key, &v)) {
        lua_pushinteger(L, (lua_Integer)v);
        return 1;
    }
    lua_pushnil(L);
    return 1;
}

static int sim_lua_kv_set(lua_State *L)
{
    const char *key = luaL_checkstring(L, 1);
    uint32_t v = (uint32_t)luaL_checkinteger(L, 2);
    host_llm_kv_port.set_u32(NULL, key, v);
    return 0;
}

/* Subscription snapshot (Homepage #2 real data). In-memory stand-in for the
 * device's odk_sub NVS store; seeded by default so the launcher renders real
 * OpenCode Go-looking values, and refreshable from the SDL side for iteration.
 * Mirrors the device binding: sub_get(key) -> string | nil, sub_request_fresh().
 * Field terminators are whitespace, matching odk_sub_get_field. */
static char s_sim_sub_snapshot[1024] =
    "plan=opencode-go primaryPct=62 primaryResetMin=18 weekPct=41 monthPct=33 zen=4.20";
static int s_sim_sub_refresh = 0;

static int sim_lua_sub_get(lua_State *L)
{
    const char *key = luaL_checkstring(L, 1);
    if (key[0] == '\0') {
        lua_pushnil(L);
        return 1;
    }
    const char *snap = s_sim_sub_snapshot;
    size_t keylen = strlen(key);
    const char *p = snap;
    while ((p = strstr(p, key)) != NULL) {
        bool at_start = (p == snap);
        bool prev_ws = !at_start && (p[-1] == ' ' || p[-1] == '\t' || p[-1] == '\n');
        if ((at_start || prev_ws) && p[keylen] == '=') {
            const char *v = p + keylen + 1;
            size_t vlen = 0;
            while (v[vlen] != '\0' && v[vlen] != ' ' && v[vlen] != '\t' && v[vlen] != '\n') {
                vlen++;
            }
            lua_pushlstring(L, v, vlen);
            return 1;
        }
        p += keylen;
    }
    lua_pushnil(L);
    return 1;
}

static int sim_lua_sub_request_fresh(lua_State *L)
{
    (void)L;
    s_sim_sub_refresh = 1;
    return 0;
}

static void sim_sub_set_snapshot(const char *snap)
{
    if (snap != NULL) {
        snprintf(s_sim_sub_snapshot, sizeof(s_sim_sub_snapshot), "%s", snap);
        s_sim_sub_refresh = 0;
    }
}

static void sim_register_modules(lua_State *L)
{
    /* The lvgl module is registered via lua_module_lvgl_register, but that
     * path stubs cap_lua_register_module to a no-op, so we also install it
     * directly into package.loaded via luaL_requiref (same as the web sim). */
    luaL_requiref(L, "lvgl", luaopen_lvgl, 1);
    lua_pop(L, 1);

    luaL_requiref(L, "delay", luaopen_delay, 1);
    lua_pop(L, 1);

    /* llm_complete: LLM binding for the Chat app. Registered in every state
     * (sim_register_lvgl_and_patch calls this for both the launcher and the
     * voice-UI states). Device registers its own (IDF ports) or the app falls
     * back to a stub if llm_complete is nil. */
    lua_pushcfunction(L, sim_lua_llm_complete);
    lua_setglobal(L, "llm_complete");

    /* kv_get/kv_set: u32 KV binding (odk_kv port) for the Settings app.
     * Device registers its own (NVS) or Settings falls back to defaults. */
    lua_pushcfunction(L, sim_lua_kv_get);
    lua_setglobal(L, "kv_get");
    lua_pushcfunction(L, sim_lua_kv_set);
    lua_setglobal(L, "kv_set");

    /* sub_get/sub_request_fresh: subscription snapshot bindings for the
     * launcher's Homepage #2 (mirrors the device's odk_voice_ui.c). */
    lua_pushcfunction(L, sim_lua_sub_get);
    lua_setglobal(L, "sub_get");
    lua_pushcfunction(L, sim_lua_sub_request_fresh);
    lua_setglobal(L, "sub_request_fresh");
}

static void sim_inject_globals(lua_State *L)
{
    /* PANEL — sentinel lightuserdata; the host esp_lcd_panel_draw_bitmap
     * ignores it. PANEL_IF = IO (NOT MIPI_DSI) to dodge the adapter path. */
    lua_pushlightuserdata(L, ODK_SIM_PANEL_HANDLE);
    lua_setglobal(L, "PANEL");

    lua_pushlightuserdata(L, ODK_SIM_IO_HANDLE);
    lua_setglobal(L, "IO");

    lua_pushlightuserdata(L, ODK_SIM_TOUCH_HANDLE);
    lua_setglobal(L, "TOUCH");

    lua_pushinteger(L, ODK_SIM_WIDTH);
    lua_setglobal(L, "WIDTH");
    lua_pushinteger(L, ODK_SIM_HEIGHT);
    lua_setglobal(L, "HEIGHT");
    lua_pushinteger(L, 2);
    lua_setglobal(L, "UI_SCALE");

    /* PANEL_IF = lvgl.PANEL_IF_IO (0). The launcher reads this global. */
    lua_getglobal(L, "lvgl");
    lua_getfield(L, -1, "PANEL_IF_IO");
    lua_setglobal(L, "PANEL_IF");

    /* ICONS = lvgl.SYMBOL (the table launcher uses for wifi/battery/etc). */
    lua_getfield(L, -1, "SYMBOL");
    lua_setglobal(L, "ICONS");
    lua_pop(L, 1); /* lvgl */
}

/* Register the lvgl Lua module + delay into a (fresh) lua_State and patch
 * lvgl.init to force the host's IO+PARTIAL path. Called for both the launcher
 * state and the AI-generated-UI state (sim_voice_ui.c). */
void sim_register_lvgl_and_patch(lua_State *L)
{
    /* Make launcher.lua + aiodi.lua discoverable as require("launcher"). */
    lua_getglobal(L, "package");
    int pkg_idx = lua_absindex(L, -1);
    lua_getfield(L, pkg_idx, "path");
    const char *old = lua_tostring(L, -1);
    lua_pop(L, 1);
    lua_pushfstring(L, "%s/?.lua;%s/?/init.lua;%s",
                    SIM_LUA_LIB_DIR, SIM_LUA_LIB_DIR, old ? old : "");
    lua_setfield(L, pkg_idx, "path");
    lua_pop(L, 1);

    sim_register_modules(L);
    sim_patch_lvgl_init(L);
}

int main(int argc, char **argv)
{
    /* argv[1] (optional):
     *   "@/path/to.lua" — run a hand-authored Lua UI file directly (no LLM),
     *                     for LLM-free visual iteration of the AIODI look.
     *   any other text  — a voice transcript: sim_voice_ui_run() calls the real
     *                     svc_llm (host LLM ports) to generate LVGL Lua, which
     *                     runs on the SDL2 window (E2E "AI -> Lua -> UI" link).
     * Without argv[1], the pre-authored AIODI launcher runs instead. */
    const char *transcript = NULL;
    const char *lua_file = NULL;
    if (argc >= 2 && argv[1][0] != '\0') {
        if (argv[1][0] == '@') {
            lua_file = argv[1] + 1;
        } else {
            transcript = argv[1];
        }
    }

    /* Headless screenshot: if ODK_SIM_SHOT names a path, the sim renders
     * ODK_SIM_SHOT_FRAMES frames (default 150 ~ 1s), saves a BMP, and quits.
     * Enables visual verification without a human watching the window. */
    const char *shot_path = getenv("ODK_SIM_SHOT");
    int shot_frames = 150;
    {
        const char *sf = getenv("ODK_SIM_SHOT_FRAMES");
        if (sf != NULL) {
            int v = atoi(sf);
            if (v > 0) shot_frames = v;
        }
    }

    /* SDL window + texture first. */
    if (!sim_sdl_init()) {
        fprintf(stderr, "[sim] SDL init failed — no display server or graphics unavailable\n");
        return 1;
    }

    /* LVGL is initialized by the Shell Runner before launcher.on_start.
     * lv_tick_inc is driven from the esp_timer pump (lua_lvgl_tick_timer_cb),
     * matching the firmware path — no host-side lv_tick_set_cb needed. */

    /* The lvgl Lua module needs a data root for font loading (LVGL tiny_ttf
     * opens <data_root>/fonts/NotoSansSC-Regular.ttf). Pass "." so it resolves
     * against the simulator's CWD (fonts/ ships next to the binary). */
    lua_module_lvgl_register_with_data_root(".");

    lua_State *L = luaL_newstate();
    if (!L) {
        fprintf(stderr, "[sim] luaL_newstate failed\n");
        return 1;
    }
    /* Clear the extraspace the way odk_voice_ui.c does — process_events reads
     * cap_lua exec ctx from there and a fresh state has garbage. */
    *(void **)lua_getextraspace(L) = NULL;
    luaL_openlibs(L);

    sim_register_lvgl_and_patch(L);
    sim_inject_globals(L);
    const char *sub_snapshot = getenv("ODK_SIM_SUB_SNAPSHOT");
    if (sub_snapshot != NULL) {
        sim_sub_set_snapshot(sub_snapshot);
    }

    bool use_gen_ui = (transcript != NULL) || (lua_file != NULL);
    if (use_gen_ui) {
        /* Generated-UI mode: transcript -> real svc_llm -> generated Lua, or a
         * hand-authored Lua file (@path). Both run in sim_voice_ui's own fresh
         * lua_State and are ticked via sim_voice_ui_tick. */
        extern odk_err_t sim_voice_ui_run(const char *t);
        extern odk_err_t sim_run_lua_file(const char *path);
        extern void sim_voice_ui_tick(void);
        extern void sim_voice_ui_stop(void);
        odk_err_t e = lua_file ? sim_run_lua_file(lua_file)
                                : sim_voice_ui_run(transcript);
        if (e != ODK_OK) {
            fprintf(stderr, "[sim] generated-UI run failed: error %d\n", (int)e);
            return 1;
        }
        fprintf(stderr, "[sim] generated UI running — close window to exit\n");
    } else {
        /* Default: pre-authored AIODI launcher. */
        lua_getglobal(L, "debug");
        lua_getfield(L, -1, "traceback");
        lua_remove(L, -2);
        int tb = lua_absindex(L, -1);

        lua_getglobal(L, "require");
        lua_pushstring(L, "launcher");
        if (lua_pcall(L, 1, 1, tb) != LUA_OK) {
            fprintf(stderr, "[sim] require(\"launcher\") failed: %s\n", lua_tostring(L, -1));
            return 1;
        }
        lua_remove(L, tb);
        int launcher_idx = lua_absindex(L, -1);
        fprintf(stderr, "[sim] launcher loaded\n"); fflush(stderr);

        lua_getglobal(L, "debug");
        lua_getfield(L, -1, "traceback");
        lua_remove(L, -2);
        int start_tb = lua_absindex(L, -1);
        static const char *shell_init =
            "local lvgl = require('lvgl')\n"
            "lvgl.init(PANEL, nil, WIDTH, HEIGHT, PANEL_IF, "
            "{buffer_lines=100, tick_ms=2, task_period_ms=2})\n";
        if (luaL_loadstring(L, shell_init) != LUA_OK || lua_pcall(L, 0, 0, start_tb) != LUA_OK) {
            fprintf(stderr, "[sim] Shell Runner LVGL init failed: %s\n", lua_tostring(L, -1));
            return 1;
        }

        lua_getglobal(L, "lvgl");
        lua_getfield(L, -1, "indev_register");
        lua_pushstring(L, "touch");
        lua_pushlightuserdata(L, ODK_SIM_TOUCH_HANDLE);
        if (lua_pcall(L, 2, 0, 0) != LUA_OK) {
            fprintf(stderr, "[sim] indev_register(touch) skipped: %s\n", lua_tostring(L, -1));
            lua_pop(L, 1);
        }
        lua_pop(L, 1);

        lua_getfield(L, launcher_idx, "on_start");
        if (!lua_isfunction(L, -1)) {
            fprintf(stderr, "[sim] launcher module has no on_start function\n");
            return 1;
        }
        lua_pushnil(L);
        if (lua_pcall(L, 1, 0, start_tb) != LUA_OK) {
            fprintf(stderr, "[sim] launcher.on_start(ctx) failed: %s\n", lua_tostring(L, -1));
            return 1;
        }
        lua_remove(L, start_tb);
        lua_setglobal(L, "launcher");
        fprintf(stderr, "[sim] running — close window to exit\n");
    }

    /* Background poller simulation: seed our KV store with initial real
     * Volcano Ark Coding Plan usage so the UI renders live state on boot. */
    host_llm_kv_port.set_u32(NULL, "ark_session", 0);
    host_llm_kv_port.set_u32(NULL, "ark_weekly", 100);
    host_llm_kv_port.set_u32(NULL, "ark_monthly", 50);

    sim_parse_taps(getenv("ODK_SIM_TAP"));
    sim_parse_drags(getenv("ODK_SIM_DRAG"));

    long frame = 0;
    for (;;) {
        if (!sim_sdl_pump_events()) {
            break; /* SDL_QUIT */
        }
        frame++;
        sim_drive_taps(frame);
        sim_drive_drags(frame);

        /* Fire due esp_timers (the LVGL tick timer -> lv_tick_inc). */
        extern void sim_esp_compat_pump_once(void);
        sim_esp_compat_pump_once();

        /* Shell Runner tick -> lvgl.process_events(0) -> lv_timer_handler.
         * In generated-UI mode the generated Lua owns its own state; tick it via
         * sim_voice_ui_tick (same process_events -> lv_timer_handler path). */
        if (use_gen_ui) {
            extern void sim_voice_ui_tick(void);
            sim_voice_ui_tick();
        } else {
            uint32_t t0 = SDL_GetTicks();
            lua_getglobal(L, "lvgl");
            lua_getfield(L, -1, "process_events");
            lua_pushinteger(L, 0);
            if (lua_pcall(L, 1, 0, 0) != LUA_OK) {
                fprintf(stderr, "[sim] lvgl.process_events() error: %s\n", lua_tostring(L, -1));
                lua_pop(L, 1);
            }
            lua_pop(L, 1);
            uint32_t t1 = SDL_GetTicks();
            static uint32_t s_render_ms_max = 0;
            static uint64_t s_render_ms_total = 0;
            static int s_render_ms_n = 0;
            uint32_t ms = t1 - t0;
            if (ms > s_render_ms_max) s_render_ms_max = ms;
            s_render_ms_total += ms;
            s_render_ms_n++;
            if (s_render_ms_n % 120 == 0) {
                fprintf(stderr, "[sim-perf] render avg=%llums max=%ums n=%d\n",
                        (unsigned long long)(s_render_ms_total / s_render_ms_n),
                        (unsigned)s_render_ms_max, s_render_ms_n);
            }
            lua_getglobal(L, "launcher");
            lua_getfield(L, -1, "on_tick");
            lua_pushnil(L);
            if (lua_pcall(L, 1, 0, 0) != LUA_OK) {
                fprintf(stderr, "[sim] launcher.on_tick(ctx) error: %s\n", lua_tostring(L, -1));
                lua_pop(L, 1);
            }
            lua_pop(L, 1);
        }

        if (shot_path != NULL && frame >= shot_frames) {
            if (sim_sdl_save_bmp(shot_path)) {
                fprintf(stderr, "[sim] screenshot saved: %s (after %ld frames)\n",
                        shot_path, frame);
            } else {
                fprintf(stderr, "[sim] screenshot FAILED: %s\n", shot_path);
            }
            break;
        }

        SDL_Delay(5);
    }

    if (use_gen_ui) {
        extern void sim_voice_ui_stop(void);
        sim_voice_ui_stop();
    } else {
        lua_getglobal(L, "launcher");
        lua_getfield(L, -1, "on_stop");
        lua_pushnil(L);
        if (lua_pcall(L, 1, 0, 0) != LUA_OK) {
            lua_pop(L, 1);
        }
        lua_pop(L, 1);
        lua_getglobal(L, "lvgl");
        lua_getfield(L, -1, "deinit");
        if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
            lua_pop(L, 1);
        }
        lua_pop(L, 1);
    }

    lua_close(L);
    SDL_Quit();
    return 0;
}
