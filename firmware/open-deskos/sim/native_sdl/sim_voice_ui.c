/*
 * sim_voice_ui.c — sim-side replica of the device's odk_voice_ui "AI generates
 * an App module -> Runner mounts it" link. Compiles the real svc_llm (port-injected, zero
 * ESP-IDF deps) against the host_llm ports (libcurl -> CLIProxyAPI), calls
 * svc_llm_complete with the SAME system prompt the device uses, strips markdown
 * fences, and runs the returned Lua through the sim's lvgl injection path.
 *
 * This is the sim's E2E path for: transcript -> LLM -> generated LVGL Lua ->
 * rendered on the SDL2 window. It mirrors odk_voice_ui_run() on device minus
 * the xTask spawn (the sim drives the canonical callbacks from its main loop).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include <ctype.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>

#include "odk_err.h"
#include "odk_svc_llm.h"
#include "host_llm.h"
#include "sdl_driver.h"
#include "lua_module_lvgl.h"
#include "aiodi_tokens.h"   /* GENERATED: prompt palette + linter (from aiodi.lua) */

/* The device's exact voice-UI system prompt (odk_voice_ui.c:35-75). Kept in
 * sync verbatim so the sim exercises the same LLM contract as `cerb ui`. */
static const char *s_system_prompt =
    "You generate Lua UI for the Open DeskOS OS shell: a 480x800 portrait touch panel.\n"
    "The user message is a VOICE TRANSCRIPT (a spoken request to build a UI).\n"
    "Output ONLY the complete Lua source: no markdown fences, never empty.\n"
    "\n"
    "Build EVERY UI with the AIODI design system so it matches the OS shell. Never\n"
    "hand-roll a screen or invent colors -- that looks off-brand and is rejected.\n"
    "  local aiodi = require('aiodi')\n"
    "  local lvgl  = require('lvgl')\n"
    "\n"
    "AIODI is dark, flat, high-contrast, with generous spacing and big type. Use\n"
    "ONLY these tokens (never a raw hex color, never bluish-grey darks):\n"
    AIODI_PROMPT_COLORS
    AIODI_PROMPT_SPACE
    AIODI_PROMPT_RADIUS
    AIODI_PROMPT_TEXT
    "\n"
    "Builders (each returns the lvgl widget; chain :on / :set_text / :set_style):\n"
    "  The RUNNER owns LVGL, the common App frame, and screen loading. It hands\n"
    "  you the App context `ctx` and its content column `ctx.root`. You ONLY\n"
    "  fill ctx.root -- never call lvgl.init, aiodi.app, or scr:load. Build\n"
    "  with these (parent = ctx.root):\n"
    "  aiodi.title(root,    {text=, align=, font=})     large primary text\n"
    "  aiodi.caption(root,  {text=, align=, font=})     secondary grey text\n"
    "  aiodi.clock(root,    {text='25:00', font=big, align='center'})  big numeral\n"
    "  aiodi.card(root,     {w=, h=, flex={...}})       rounded surface panel\n"
    "  aiodi.list_row(root, {w=CW, text=})              full-width tappable row\n"
    "  aiodi.button(root,   {text=, accent=aiodi.colors.blue, w=})     pill button\n"
    "  aiodi.icon_label(parent, {name=<fa>, size=, color=})  FontAwesome 6 glyph label\n"
    "FONT AWESOME icon names (aiodi.icon_label name=, one solid colour):\n"
    "  mail calendar meetings settings tasks hourglass focus bell bolt dice droplet star leaf habit link radar\n"
    "  arrow-big-left caret-left\n"
    "  (FontAwesome 6 Free Solid subset in fonts/fa-icons.ttf; SVG/Tabler are NOT\n"
    "  supported on device -- the software vector renderer outputs blank)\n"
    "  CW (content width) = WIDTH (edge-to-edge; no side margins).\n"
    "\n"
    "FONTS -- the default font (Montserrat) draws Latin but NO\n"
    "Chinese. For any label with Chinese/non-Latin text, pass a CJK font:\n"
    "  font = aiodi.font(aiodi.text.body)   (or .title / .display for bigger)\n"
    "aiodi.font(size) is cached, so call it freely. aiodi.app titles are already\n"
    "CJK. RULE: never put an icon in the SAME label as Chinese -- put it in its own\n"
    "label (aiodi.icon_label is already its own widget) instead.\n"
    "\n"
    "Rows / columns / grids of your own:\n"
    "  local c = lvgl.container(root, {w=, h=, bg_opa=0, border_width=0, pad=aiodi.space.md})\n"
    "  c:set_flex({flow='row' or 'column' or 'row_wrap', main='center' or 'start' or\n"
    "    'space_between' or 'space_evenly', cross='center', track='center'})\n"
    "Interaction: btn:on('clicked', function() ... end); update text via w:set_text(...)\n"
    "and restyle via w:set_style({bg_color=aiodi.colors.blue}) -- there is NO set_style_bg_color.\n"
    "Countdowns / animation go in on_tick(ctx) (use os.time() for elapsed seconds).\n"
    "\n"
    "ICONS: ALL icons MUST come from the FontAwesome 6 subset via\n"
    "aiodi.icon_label(parent, {name=<name>, size=, color=}) -- NEVER lvgl.SYMBOL/ICONS.*,\n"
    "NEVER emoji or Unicode pictographs. See the name list above.\n"
    "For anything not in that list use ASCII words (Sunny, Rain).\n"
    "\n"
    "Globals: PANEL, PANEL_IF, WIDTH=480, HEIGHT=800, ICONS, UI_SCALE.\n"
    "App contract -- return a module table. `on_start(ctx)` is required;\n"
    "`on_pause(ctx)`, `on_resume(ctx)`, `on_tick(ctx)`, and `on_stop(ctx)` are\n"
    "optional. The runner owns LVGL, the common frame, screen load, and event\n"
    "processing:\n"
    "  local App = {}\n"
    "  function App.on_start(ctx)\n"
    "    -- build with aiodi builders into ctx.root\n"
    "  end\n"
    "  function App.on_tick(ctx) end\n"
    "  return App\n"
    "\n"
    "Complete example -- a Pomodoro (copy this structure):\n"
    "  local aiodi = require('aiodi')\n"
    "  local lvgl  = require('lvgl')\n"
    "  local App = {}\n"
    "  local left, running, mark, clk = 25*60, false, 0, nil\n"
    "  local function fmt(s) return string.format('%02d:%02d', s // 60, s % 60) end\n"
    "  function App.on_start(ctx)\n"
    "    local big = aiodi.font(aiodi.text.display)\n"
    "    clk = aiodi.clock(ctx.root, {text=fmt(left), font=big, align='center'})\n"
    "    aiodi.caption(ctx.root, {text='专注 25 分钟', font=aiodi.font(aiodi.text.body)})\n"
    "    local btn = aiodi.button(ctx.root, {text='开始', font=aiodi.font(aiodi.text.body), accent=aiodi.colors.green, w=260})\n"
    "    btn:on('clicked', function()\n"
    "      running = not running; mark = os.time()\n"
    "      btn:set_text(running and '暂停' or '开始')\n"
    "    end)\n"
    "  end\n"
    "  function App.on_tick(ctx)\n"
    "    if running and left > 0 and os.time() > mark then\n"
    "        left = left - (os.time() - mark); mark = os.time()\n"
    "        if left < 0 then left = 0 end\n"
    "        clk:set_text(fmt(left))\n"
    "    end\n"
    "  end\n"
    "  return App\n"
    "\n"
    "FORBIDDEN: emoji; ICONS.*/lvgl.SYMBOL glyphs; raw hex outside aiodi.colors; shadows,\n"
    "gradients, borders; lvgl.init / aiodi.app / scr:load (the RUNNER owns those);\n"
    "lvgl.create_screen; lv_* or *_create C names; lvgl.ALIGN.* / OPA.* / LAYOUT.*;\n"
    "board_manager; display.init; require anything except 'aiodi' and 'lvgl'. Keep under 6KB.\n";

#define SIM_LUA_BUF 12288  /* matches device VOICE_UI_LUA_BUF */

/* Mirrors odk_voice_ui.c strip_markdown_fences. */
static void strip_markdown_fences(char *text)
{
    char *start = strstr(text, "```");
    if (start == NULL) return;
    start += 3;
    if (strncmp(start, "lua", 3) == 0) start += 3;
    while (*start == '\r' || *start == '\n') start++;
    char *end = strstr(start, "```");
    if (end == NULL) { memmove(text, start, strlen(start) + 1); return; }
    size_t n = (size_t)(end - start);
    memmove(text, start, n);
    text[n] = '\0';
}

/* ---- AIODI output linter (KEEP IN SYNC with odk_voice_ui.c) --------------
 * Deterministic detection of off-brand generated Lua (the "impeccable" idea:
 * flag design-system violations with zero extra model calls). Fills `reason`
 * with a "; "-joined list and returns the violation count. */
static bool aiodi_is_hex6(const char *s)
{
    for (int i = 0; i < 6; i++) {
        if (!isxdigit((unsigned char)s[i])) {
            return false;
        }
    }
    return true;
}

/* Append one "; "-separated printf-style violation to `reason`. */
__attribute__((format(printf, 3, 4)))
static void reason_add(char *reason, size_t rlen, const char *fmt, ...)
{
    size_t l = strlen(reason);
    if (l != 0 && l + 2 < rlen) {
        reason[l++] = ';';
        reason[l++] = ' ';
        reason[l] = '\0';
    }
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(reason + l, rlen - l, fmt, ap);
    va_end(ap);
}

static int voice_ui_lint(const char *lua, char *reason, size_t rlen)
{
    static const char *palette[] = { AIODI_LINTER_PALETTE };
    int n = 0;
    if (rlen) reason[0] = '\0';

    if (strstr(lua, "require('aiodi')") == NULL &&
        strstr(lua, "require(\"aiodi\")") == NULL) {
        reason_add(reason, rlen, "does not require('aiodi')");
        n++;
    }
    if (strstr(lua, "create_screen") != NULL) {
        reason_add(reason, rlen, "hand-rolls a screen (create_screen)");
        n++;
    }
    /* Hallucinated method names: the binding exposes lvgl.<widget> (not
     * lvgl.<widget>_create), w:set_style({..}) (not w:set_style_bg_color(..)),
     * and has no lvgl.ALIGN/OPA/LAYOUT constants. These are the common LLM
     * hallucinations; flag them deterministically. */
    if (strstr(lua, "set_style_") != NULL) {
        reason_add(reason, rlen, "set_style_* (use w:set_style({..}))");
        n++;
    }
    if (strstr(lua, "_create(") != NULL) {
        reason_add(reason, rlen, "*_create C name (use lvgl.<widget>)");
        n++;
    }
    if (strstr(lua, "lvgl.ALIGN.") != NULL ||
        strstr(lua, "lvgl.OPA.") != NULL ||
        strstr(lua, "lvgl.LAYOUT.") != NULL) {
        reason_add(reason, rlen, "lvgl.ALIGN/OPA/LAYOUT (no such constants)");
        n++;
    }
    /* App contract: the runner owns LVGL, the common App frame, screen load,
     * and the event pump. Generated source returns a module with on_start(ctx);
     * legacy global callbacks are rejected instead of being adapted. */
    if (strstr(lua, "on_start") == NULL || strstr(lua, "return") == NULL) {
        reason_add(reason, rlen, "missing App module on_start(ctx)");
        n++;
    }
    if (strstr(lua, "function build") != NULL || strstr(lua, "function start") != NULL ||
        strstr(lua, "function tick") != NULL || strstr(lua, "function stop") != NULL) {
        reason_add(reason, rlen, "legacy App callback contract");
        n++;
    }
    if (strstr(lua, "lvgl.init(") != NULL) {
        reason_add(reason, rlen, "lvgl.init (runner owns it)");
        n++;
    }
    if (strstr(lua, "aiodi.app{") != NULL || strstr(lua, "aiodi.app(") != NULL ||
        strstr(lua, "aiodi.app ") != NULL) {
        reason_add(reason, rlen, "aiodi.app (runner owns the frame)");
        n++;
    }
    if (strstr(lua, ":load(") != NULL) {
        reason_add(reason, rlen, "scr:load (runner owns it)");
        n++;
    }
    /* Off-palette color: a quoted 7-char '#rrggbb' literal not in the palette. */
    for (const char *p = lua; *p; p++) {
        if (*p == '#' && p > lua && (p[-1] == '\'' || p[-1] == '"') &&
            aiodi_is_hex6(p + 1) && p[7] == p[-1]) {
            char hx[7];
            for (int i = 0; i < 6; i++) {
                hx[i] = (char)tolower((unsigned char)p[1 + i]);
            }
            hx[6] = '\0';
            bool ok = false;
            for (int i = 0; palette[i] != NULL; i++) {
                if (strcmp(hx, palette[i]) == 0) { ok = true; break; }
            }
            if (!ok) {
                reason_add(reason, rlen, "off-palette color #%s", hx);
                n++;
                break;
            }
            p += 6;
        }
    }
    return n;
}

/* The correction folded into the retry user message when the linter fires.
 * KEEP IN SYNC with odk_voice_ui.c. */
#define VOICE_UI_RETRY_FMT \
    "%s\n\n(Your previous Lua was rejected -- AIODI violations: %s. Regenerate " \
    "returning an App module with on_start(ctx), and use ONLY " \
    "aiodi.colors.* tokens -- no raw hex, no create_screen.)"

/* The Lua state for the generated UI. Owned by sim_main's tick loop once run. */
static lua_State *s_gen_L;

/* Patch lvgl.init the same way the launcher path does (force IO+PARTIAL on
 * host). Forward-declared in sim_main.c; same closure is reused if the launcher
 * path already patched it — but a generated script gets a FRESH lua_State, so
 * we re-register + re-patch here. */
extern void sim_register_lvgl_and_patch(lua_State *L);

/* Inject the globals the generated Lua reads (PANEL/TOUCH/WIDTH/.../ICONS).
 * Mirrors odk_voice_ui.c's load_and_start injection, but with the sim's
 * IO+PARTIAL steering (PANEL_IF=IO, IO sentinel non-nil). */
static void sim_inject_voice_globals(lua_State *L)
{
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
    /* PANEL_IF = lvgl.PANEL_IF_IO (host steering, NOT MIPI_DSI). */
    lua_getglobal(L, "lvgl");
    lua_getfield(L, -1, "PANEL_IF_IO");
    lua_setglobal(L, "PANEL_IF");
    lua_getfield(L, -1, "SYMBOL");
    lua_setglobal(L, "ICONS");
    lua_pop(L, 1);
}

/* Run the AI-generated Lua. Replaces any currently-running generated UI. */
static odk_err_t sim_load_and_start(const char *lua_src, const char *mode,
                                     const char *app_id, const char *title)
{
    if (s_gen_L) {
        lua_getglobal(s_gen_L, "__odk_shutdown");
        if (lua_pcall(s_gen_L, 0, 0, 0) != LUA_OK) lua_pop(s_gen_L, 1);
        lua_close(s_gen_L);
        s_gen_L = NULL;
    }

    lua_State *L = luaL_newstate();
    if (!L) return ODK_ERR_OOM;
    *(void **)lua_getextraspace(L) = NULL;
    luaL_openlibs(L);

    sim_register_lvgl_and_patch(L);
    sim_inject_voice_globals(L);

    /* Load one canonical App module; the Runner owns the frame and lifecycle. */
    if (luaL_loadstring(L, lua_src) != LUA_OK || lua_pcall(L, 0, 1, 0) != LUA_OK) {
        fprintf(stderr, "[sim_voice_ui] App module load failed: %s\n",
                lua_tostring(L, -1));
        lua_close(L);
        return ODK_ERR_HTTP;
    }

    if (!lua_istable(L, -1)) {
        fprintf(stderr, "[sim_voice_ui] App source must return a module table\n");
        lua_pop(L, 1);
        lua_close(L);
        return ODK_ERR_HTTP;
    }
    lua_getfield(L, -1, "on_start");
    bool has_on_start = lua_isfunction(L, -1);
    lua_pop(L, 1);
    if (!has_on_start) {
        fprintf(stderr, "[sim_voice_ui] App module has no on_start(ctx)\n");
        lua_pop(L, 1);
        lua_close(L);
        return ODK_ERR_HTTP;
    }
    lua_setglobal(L, "__odk_module");
    lua_pushstring(L, mode ? mode : "app");
    lua_setglobal(L, "__odk_mode");
    lua_pushstring(L, app_id ? app_id : "voice");
    lua_setglobal(L, "__odk_app_id");
    lua_pushstring(L, title ? title : "Voice");
    lua_setglobal(L, "__odk_title");

    static const char *wrapper =
        "local lvgl = require('lvgl')\n"
        "local aiodi = require('aiodi')\n"
        "lvgl.init(PANEL, nil, WIDTH, HEIGHT, PANEL_IF, {buffer_lines=100, tick_ms=2, task_period_ms=2})\n"
        "local screen, root\n"
        "if __odk_mode == 'app' then screen, root = aiodi.app({ title = __odk_title }) end\n"
        "local ctx = { app_id = __odk_app_id, root = root, width = WIDTH, height = HEIGHT }\n"
        "function __odk_on_start()\n"
        "  local result = __odk_module.on_start(ctx)\n"
        "  if screen then screen:load() end\n"
        "  return result\n"
        "end\n"
        "function __odk_on_tick()\n"
        "  if __odk_module.on_tick then __odk_module.on_tick(ctx) end\n"
        "  lvgl.process_events(0)\n"
        "end\n"
        "function __odk_shutdown()\n"
        "  if __odk_module.on_stop then pcall(__odk_module.on_stop, ctx) end\n"
        "  -- lvgl.deinit owns destruction of the active screen tree.\n"
        "  lvgl.deinit()\n"
        "end\n";
    if (luaL_loadstring(L, wrapper) != LUA_OK || lua_pcall(L, 0, 0, 0) != LUA_OK) {
        fprintf(stderr, "[sim_voice_ui] App Runner setup failed: %s\n", lua_tostring(L, -1));
        lua_pop(L, 1);
        lua_close(L);
        return ODK_ERR_HTTP;
    }

    /* Register touch after the Runner initialized LVGL. */
    lua_getglobal(L, "lvgl");
    lua_getfield(L, -1, "indev_register");
    lua_pushstring(L, "touch");
    lua_pushlightuserdata(L, ODK_SIM_TOUCH_HANDLE);
    if (lua_pcall(L, 2, 0, 0) != LUA_OK) {
        fprintf(stderr, "[sim_voice_ui] indev_register(touch) skipped: %s\n",
                lua_tostring(L, -1));
        lua_pop(L, 1);
    }
    lua_pop(L, 1);

    lua_getglobal(L, "__odk_on_start");
    if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
        fprintf(stderr, "[sim_voice_ui] on_start(ctx) failed: %s\n", lua_tostring(L, -1));
        lua_pop(L, 1);
        lua_close(L);
        return ODK_ERR_HTTP;
    }

    s_gen_L = L;
    return ODK_OK;
}

odk_err_t sim_voice_ui_run(const char *transcript)
{
    if (!transcript || !transcript[0]) return ODK_ERR_HTTP;

    odk_svc_llm_t *llm = svc_llm_create(&host_llm_http_port, NULL,
                                          &host_llm_kv_port, NULL,
                                          &host_llm_clock_port, NULL,
                                          1000 /* daily quota; sim = unlimited-ish */);
    if (!llm) {
        fprintf(stderr, "[sim_voice_ui] svc_llm_create failed\n");
        return ODK_ERR_OOM;
    }

    char *lua_buf = (char *)malloc(SIM_LUA_BUF);
    if (!lua_buf) return ODK_ERR_OOM;

    fprintf(stderr, "[sim_voice_ui] LLM request: \"%s\"\n", transcript);

    char reason[128];
    const char *user = transcript;
    char *retry_msg = NULL;
    odk_err_t err = ODK_OK;
    for (int attempt = 0; attempt < 2; attempt++) {
        odk_llm_usage_t usage = {0};
        err = svc_llm_complete(llm, s_system_prompt, user, lua_buf, SIM_LUA_BUF, &usage);
        if (err != ODK_OK) {
            fprintf(stderr, "[sim_voice_ui] svc_llm_complete failed: error %d\n", (int)err);
            free(retry_msg);
            free(lua_buf);
            return err;
        }
        strip_markdown_fences(lua_buf);
        int viol = voice_ui_lint(lua_buf, reason, sizeof(reason));
        fprintf(stderr, "[sim_voice_ui] got Lua (%zu bytes, %u in/%u out tokens); AIODI lint: %s\n",
                strlen(lua_buf), usage.in_tokens, usage.out_tokens,
                viol ? reason : "clean");
        fprintf(stderr, "----- generated Lua -----\n%s\n-------------------------\n", lua_buf);
        if (viol == 0 || attempt == 1) break;

        /* One corrective retry: fold the violations into the user message. */
        size_t need = strlen(transcript) + strlen(reason) + 256;
        retry_msg = (char *)malloc(need);
        if (!retry_msg) break;
        snprintf(retry_msg, need, VOICE_UI_RETRY_FMT, transcript, reason);
        user = retry_msg;
        fprintf(stderr, "[sim_voice_ui] retrying once to fix AIODI violations\n");
    }
    free(retry_msg);

    err = sim_load_and_start(lua_buf, "app", "voice_generated", "Voice");
    free(lua_buf);
    return err;
}

/* Run a Lua UI file directly (no LLM) — the sim's `@path` argv mode. Renders a
 * hand-authored candidate UI through the exact generated-UI pipeline, so the
 * AIODI look can be iterated visually without spending LLM quota. */
odk_err_t sim_run_lua_file(const char *path)
{
    if (!path || !path[0]) return ODK_ERR_HTTP;
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "[sim_voice_ui] cannot open Lua file: %s\n", path);
        return ODK_ERR_NOT_FOUND;
    }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n <= 0 || n > SIM_LUA_BUF - 1) {
        fclose(f);
        fprintf(stderr, "[sim_voice_ui] Lua file empty or too large: %s\n", path);
        return ODK_ERR_HTTP;
    }
    char *buf = (char *)malloc((size_t)n + 1);
    if (!buf) { fclose(f); return ODK_ERR_OOM; }
    size_t rd = fread(buf, 1, (size_t)n, f);
    fclose(f);
    buf[rd] = '\0';
    fprintf(stderr, "[sim_voice_ui] running Lua file %s (%zu bytes)\n", path, rd);
    odk_err_t err = sim_load_and_start(buf, "app", "voice_file", "Voice");
    free(buf);
    return err;
}

/* Called from the sim main loop each tick to drive the generated UI. */
void sim_voice_ui_tick(void)
{
    if (!s_gen_L) return;
    lua_getglobal(s_gen_L, "__odk_on_tick");
    if (lua_pcall(s_gen_L, 0, 0, 0) != LUA_OK) {
        fprintf(stderr, "[sim_voice_ui] on_tick(ctx) error: %s\n", lua_tostring(s_gen_L, -1));
        lua_pop(s_gen_L, 1);
    }
}

void sim_voice_ui_stop(void)
{
    if (!s_gen_L) return;
    lua_getglobal(s_gen_L, "__odk_shutdown");
    if (lua_pcall(s_gen_L, 0, 0, 0) != LUA_OK) lua_pop(s_gen_L, 1);
    lua_close(s_gen_L);
    s_gen_L = NULL;
}
