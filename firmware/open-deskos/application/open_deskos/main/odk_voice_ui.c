/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice-UI Runner: LLM emits a canonical App module; the Runner injects the
 * live panel handle, owns the common frame, and drives lifecycle
 * callbacks from one Shell task.
 */
#include "odk_voice_ui.h"

#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>  /* mkdir for the LVGL D: icons dir */

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

#include "odk_display_bringup.h"
#include "odk_s3_display_bringup.h"
#include "driver/usb_serial_jtag.h"
#include "odk_sub.h"
#include "odk_touch_bringup.h"
#include "claw_paths.h"
#include "aiodi_tokens.h"   /* GENERATED: prompt palette + linter (from aiodi.lua) */
#include "lua_module_lvgl.h"

/* Linked via app_claw → lua_module_lvgl (already in this firmware image). */
#define VOICE_UI_LUA_BUF       12288
#define VOICE_UI_TICK_MS       16
#define VOICE_UI_TASK_STACK    20480
#define VOICE_UI_TASK_PRIO     4
#define VOICE_UI_TASK_CORE     0

static const char *TAG = "odk_voice_ui";

static const char *s_system_prompt =
#if CONFIG_IDF_TARGET_ESP32S3
    "You generate Lua UI for the Open DeskOS OS shell: a 240x320 portrait touch panel.\n"
#else
    "You generate Lua UI for the Open DeskOS OS shell: a 480x800 portrait touch panel.\n"
#endif
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
#if CONFIG_IDF_TARGET_ESP32S3
    "Globals: PANEL, PANEL_IF, WIDTH=240, HEIGHT=320, ICONS, UI_SCALE.\n"
#else
    "Globals: PANEL, PANEL_IF, WIDTH=480, HEIGHT=800, ICONS, UI_SCALE.\n"
#endif
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

static TaskHandle_t s_task;
static volatile bool s_run;
static lua_State *s_L;
static char *s_script;

/* Host-pushed subscription snapshot store (wired from the composition root
 * via odk_voice_ui_set_sub; NULL until then). Exposed to the launcher Lua as
 * the sub_get()/sub_request_fresh() globals so Homepage #2 renders real data. */
static odk_sub_t *s_sub;

static void strip_markdown_fences(char *text)
{
    char *start = strstr(text, "```");
    if (start == NULL) {
        return;
    }
    start += 3;
    if (strncmp(start, "lua", 3) == 0) {
        start += 3;
    }
    while (*start == '\r' || *start == '\n') {
        start++;
    }
    char *end = strstr(start, "```");
    if (end == NULL) {
        memmove(text, start, strlen(start) + 1);
        return;
    }
    size_t n = (size_t)(end - start);
    memmove(text, start, n);
    text[n] = '\0';
}

/* ---- AIODI output linter (KEEP IN SYNC with sim_voice_ui.c) ---------------
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
 * KEEP IN SYNC with sim_voice_ui.c. */
#define VOICE_UI_RETRY_FMT \
    "%s\n\n(Your previous Lua was rejected -- AIODI violations: %s. Regenerate " \
    "returning an App module with on_start(ctx), and use ONLY " \
    "aiodi.colors.* tokens -- no raw hex, no create_screen.)"

/* sub_get(key) -> string | nil: field of the stored subscription snapshot.
 * Returns nil when no snapshot/field — the launcher falls back to a
 * placeholder. */
static int voice_ui_lua_sub_get(lua_State *L)
{
    if (s_sub == NULL) {
        lua_pushnil(L);
        return 1;
    }
    const char *key = luaL_checkstring(L, 1);
    char out[ODK_SUB_FIELD_MAX];
    if (odk_sub_get_field(s_sub, key, out, sizeof(out))) {
        lua_pushstring(L, out);
        return 1;
    }
    lua_pushnil(L);
    return 1;
}

/* sub_request_fresh() -> (): marks a pending-refresh so the host bridge knows
 * the screen wants a fresh push (invoked when Homepage #2 opens). */
static int voice_ui_lua_sub_request_fresh(lua_State *L)
{
    if (s_sub != NULL) {
        (void)odk_sub_request_fresh(s_sub);
    }
    return 0;
}

/* usb_connected() -> (boolean): true when the USB Serial/JTAG port has a live
 * host on the other end (SOF packets). Drives the status-bar link icon colour:
 * white = Mac attached, grey = detached. */
static int voice_ui_lua_usb_connected(lua_State *L)
{
    lua_pushboolean(L, usb_serial_jtag_is_connected());
    return 1;
}

static int call_global(lua_State *L, const char *name)
{
    lua_getglobal(L, name);
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 1);
        return 0;
    }
    if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
        ESP_LOGE(TAG, "%s() error: %s", name, lua_tostring(L, -1));
        lua_pop(L, 1);
        return -1;
    }
    return 1;
}

static void voice_ui_register_touch(lua_State *L)
{
#if CONFIG_IDF_TARGET_ESP32S3
    esp_lcd_touch_handle_t tp = odk_s3_touch_get_handle();
#else
    esp_lcd_touch_handle_t tp = odk_touch_get_handle();
#endif
    if (tp == NULL || L == NULL) {
        return;
    }
    lua_getglobal(L, "lvgl");
    if (!lua_istable(L, -1)) {
        lua_pop(L, 1);
        return;
    }
    lua_getfield(L, -1, "indev_register");
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 2);
        return;
    }
    lua_pushstring(L, "touch");
    lua_pushlightuserdata(L, tp);
    if (lua_pcall(L, 2, 0, 0) != LUA_OK) {
        ESP_LOGW(TAG, "indev_register(touch) skipped: %s", lua_tostring(L, -1));
        lua_pop(L, 1);
    } else {
        ESP_LOGI(TAG, "LVGL touch indev registered");
    }
    lua_pop(L, 1); /* lvgl */
}

static void voice_ui_task(void *arg)
{
    (void)arg;
    static const char *wrapper =
        "local lvgl = require('lvgl')\n"
        "local aiodi = require('aiodi')\n"
        /* The runtime selects the adapter for P4 MIPI and the SPI partial path
         * for S3; both use the same Lua lifecycle. */
        "lvgl.init(PANEL, IO, WIDTH, HEIGHT, PANEL_IF, {tick_ms=2, task_period_ms=2})\n"
        "local screen, root\n"
        "if __odk_mode == 'app' then\n"
        "  screen, root = aiodi.app({ title = __odk_title })\n"
        "end\n"
        "local ctx = { app_id = __odk_app_id, root = root, width = WIDTH, height = HEIGHT }\n"
        "function __odk_on_start()\n"
        "  local ok, err = pcall(__odk_module.on_start, ctx)\n"
        "  if not ok then print('[voice_ui] on_start ERROR: '..tostring(err)) return err end\n"
        "  if screen then screen:load() end\n"
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
    if (luaL_loadstring(s_L, wrapper) != LUA_OK || lua_pcall(s_L, 0, 0, 0) != LUA_OK) {
        ESP_LOGE(TAG, "App Runner setup failed: %s", lua_tostring(s_L, -1));
        lua_pop(s_L, 1);
        s_run = false;
    } else {
        /* Register after the Runner initialized LVGL and before on_start. */
        voice_ui_register_touch(s_L);
        if (call_global(s_L, "__odk_on_start") <= 0) {
            s_run = false;
        }
    }
    while (s_run) {
        if (call_global(s_L, "__odk_on_tick") < 0) {
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(VOICE_UI_TICK_MS));
    }
    (void)call_global(s_L, "__odk_shutdown");
    if (s_L) {
        lua_close(s_L);
        s_L = NULL;
    }
    free(s_script);
    s_script = NULL;
    s_task = NULL;
    ESP_LOGI(TAG, "voice UI task exited");
    vTaskDelete(NULL);
}

void odk_voice_ui_set_sub(odk_sub_t *sub)
{
    s_sub = sub;
}

void odk_voice_ui_stop(void)
{
    if (s_task == NULL) {
        return;
    }
    s_run = false;
    /* Wait for task teardown (bounded). */
    for (int i = 0; i < 100 && s_task != NULL; i++) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

/* Prepend the read-only builtin Lua lib dir to package.path so voice-UI
 * scripts can require() shared libraries (e.g. the AIODI design system).
 * CLAW_PATH_SYSTEM is the fixed read-only system mount; the writable DATA
 * root is intentionally not searched here. */
static void voice_ui_add_lib_path(lua_State *L)
{
    const char *system_root = claw_paths_get(CLAW_PATH_SYSTEM);
    if (system_root == NULL) {
        return;
    }
    lua_getglobal(L, "package");
    lua_getfield(L, -1, "path");
    const char *cur = lua_tostring(L, -1);
    if (cur == NULL) {
        cur = "";
    }
    size_t need = strlen(system_root) * 2 + strlen(cur) + 64;
    char *newpath = malloc(need);
    if (newpath != NULL) {
        snprintf(newpath, need,
                 "%s/scripts/builtin/lib/?.lua;%s/scripts/builtin/?.lua;%s",
                 system_root, system_root, cur);
        lua_pop(L, 1); /* old package.path */
        lua_pushstring(L, newpath);
        lua_setfield(L, -2, "path");
        free(newpath);
    } else {
        lua_pop(L, 1); /* old package.path */
    }
    lua_pop(L, 1); /* package */
}

static odk_err_t load_and_start(const char *lua_src, const char *mode,
                                 const char *app_id, const char *title)
{
#if CONFIG_IDF_TARGET_ESP32S3
    esp_lcd_panel_handle_t panel = NULL;
#else
    esp_lcd_panel_handle_t panel = odk_display_get_panel();
#endif
    const char *data_root = claw_paths_get(CLAW_PATH_DATA);
    esp_err_t data_root_err;

#if !CONFIG_IDF_TARGET_ESP32S3
    if (panel == NULL) {
        ESP_LOGE(TAG, "display panel not ready");
        return ODK_ERR_NOT_FOUND;
    }
#endif
    if (data_root == NULL || data_root[0] == '\0') {
        ESP_LOGE(TAG, "LVGL DATA root is not configured");
        return ODK_ERR_STORAGE;
    }

    odk_voice_ui_stop();

    /* The Shell Runner opens luaopen_lvgl directly and can boot even when
     * app_claw_start() was skipped (for example while the C6 link is absent).
     * Keep the LVGL D: filesystem valid for runtime TTFs in that path too. */
    data_root_err = lua_module_lvgl_set_data_root(data_root);
    if (data_root_err != ESP_OK) {
        ESP_LOGE(TAG, "failed to configure LVGL DATA root %s: %s",
                 data_root, esp_err_to_name(data_root_err));
        return ODK_ERR_STORAGE;
    }

    /* aiodi.ensure_svg_file writes icon SVGs with C stdio. On device the
     * process cwd is NOT the storage partition, so a relative "icons/..."
     * path lands in the wrong tree and lvgl.image then fails to resolve the
     * D: icons the launcher requests (w=0 h=0, silent fallback to glyph
     * text). Expose DATA_ROOT so aiodi writes an absolute path into the same
     * tree the LVGL D: drive reads from, and pre-create the icons dir (C
     * stdio will not mkdir it for us). */
    {
        char icons_dir[256];
        int n = snprintf(icons_dir, sizeof(icons_dir), "%s/icons", data_root);
        if (n > 0 && (size_t)n < sizeof(icons_dir)) {
            mkdir(icons_dir, 0755);
        }
    }

    free(s_script);
    s_script = strdup(lua_src);
    if (s_script == NULL) {
        return ODK_ERR_OOM;
    }

    lua_State *L = luaL_newstate();
    if (L == NULL) {
        free(s_script);
        s_script = NULL;
        return ODK_ERR_OOM;
    }
    /* lua_module_lvgl::process_events reads cap_lua exec ctx from extraspace.
     * Fresh states have garbage there → null-ish deref crash. Clear it. */
    *(void **)lua_getextraspace(L) = NULL;
    luaL_openlibs(L);
    luaL_requiref(L, "lvgl", luaopen_lvgl, 1);
    lua_pop(L, 1);
    voice_ui_add_lib_path(L);

    int w = 0, h = 0;
#if CONFIG_IDF_TARGET_ESP32S3
    esp_lcd_panel_handle_t active_panel = odk_s3_display_get_panel();
    esp_lcd_panel_io_handle_t active_io = odk_s3_display_get_io();
    esp_lcd_touch_handle_t active_touch = odk_s3_touch_get_handle();
    odk_s3_display_get_size(&w, &h);
#else
    esp_lcd_panel_handle_t active_panel = panel;
    esp_lcd_panel_io_handle_t active_io = NULL;
    esp_lcd_touch_handle_t active_touch = odk_touch_get_handle();
    odk_display_get_size(&w, &h);
#endif
#if CONFIG_IDF_TARGET_ESP32S3
    (void)panel;
#else
    panel = active_panel;
#endif
    lua_pushlightuserdata(L, active_panel);
    lua_setglobal(L, "PANEL");
    if (active_io != NULL) {
        lua_pushlightuserdata(L, active_io);
    } else {
        lua_pushnil(L);
    }
    lua_setglobal(L, "IO");
    {
        esp_lcd_touch_handle_t tp = active_touch;
        if (tp != NULL) {
            lua_pushlightuserdata(L, tp);
        } else {
            lua_pushnil(L);
        }
        lua_setglobal(L, "TOUCH");
    }
    lua_pushinteger(L, w);
    lua_setglobal(L, "WIDTH");
    lua_pushinteger(L, h);
    lua_setglobal(L, "HEIGHT");
#if CONFIG_IDF_TARGET_ESP32S3
    lua_pushnumber(L, 0.5);
#else
    lua_pushinteger(L, 2);
#endif
    lua_setglobal(L, "UI_SCALE");
    /* aiodi.ensure_svg_file: absolute write path for icon SVGs (device only;
     * sim leaves DATA_ROOT nil and keeps its cwd-relative icons/ dir). */
    lua_pushstring(L, data_root);
    lua_setglobal(L, "DATA_ROOT");
    lua_getglobal(L, "lvgl");
#if CONFIG_IDF_TARGET_ESP32S3
    lua_getfield(L, -1, "PANEL_IF_IO");
#else
    lua_getfield(L, -1, "PANEL_IF_MIPI_DSI");
#endif
    lua_setglobal(L, "PANEL_IF");
    lua_getfield(L, -1, "SYMBOL"); /* lvgl still on stack */
    lua_setglobal(L, "ICONS");
    lua_pop(L, 1);

    /* sub_get()/sub_request_fresh(): subscription snapshot bindings for the
     * launcher's Homepage #2. Registered in every voice-UI state (the launcher
     * reads them; generated UIs ignore them). */
    lua_pushcfunction(L, voice_ui_lua_sub_get);
    lua_setglobal(L, "sub_get");
    lua_pushcfunction(L, voice_ui_lua_sub_request_fresh);
    lua_setglobal(L, "sub_request_fresh");
    lua_pushcfunction(L, voice_ui_lua_usb_connected);
    lua_setglobal(L, "usb_connected");

    if (luaL_loadstring(L, s_script) != LUA_OK || lua_pcall(L, 0, 1, 0) != LUA_OK) {
        ESP_LOGE(TAG, "App module load failed: %s", lua_tostring(L, -1));
        lua_close(L);
        free(s_script);
        s_script = NULL;
        return ODK_ERR_HTTP;
    }
    if (!lua_istable(L, -1)) {
        ESP_LOGE(TAG, "App source must return a module table");
        lua_pop(L, 1);
        lua_close(L);
        free(s_script);
        s_script = NULL;
        return ODK_ERR_HTTP;
    }
    lua_getfield(L, -1, "on_start");
    bool has_on_start = lua_isfunction(L, -1);
    lua_pop(L, 1);
    if (!has_on_start) {
        ESP_LOGE(TAG, "App module has no on_start(ctx)");
        lua_pop(L, 1);
        lua_close(L);
        free(s_script);
        s_script = NULL;
        return ODK_ERR_HTTP;
    }
    lua_setglobal(L, "__odk_module");
    lua_pushstring(L, mode != NULL ? mode : "app");
    lua_setglobal(L, "__odk_mode");
    lua_pushstring(L, app_id != NULL ? app_id : "voice");
    lua_setglobal(L, "__odk_app_id");
    lua_pushstring(L, title != NULL ? title : "Voice");
    lua_setglobal(L, "__odk_title");

    s_L = L;
    s_run = true;
    BaseType_t ok = xTaskCreatePinnedToCore(voice_ui_task, "voice_ui", VOICE_UI_TASK_STACK,
                                            NULL, VOICE_UI_TASK_PRIO, &s_task,
                                            VOICE_UI_TASK_CORE);
    if (ok != pdPASS) {
        s_run = false;
        call_global(L, "__odk_shutdown");
        lua_close(L);
        s_L = NULL;
        free(s_script);
        s_script = NULL;
        return ODK_ERR_OOM;
    }
    return ODK_OK;
}

odk_err_t odk_voice_ui_run(odk_svc_llm_t *llm, const char *transcript,
                             char *out, size_t outlen)
{
    if (transcript == NULL || transcript[0] == '\0') {
        snprintf(out, outlen, "ui failed: empty transcript\n");
        return ODK_ERR_DENIED;
    }

    /* Explicit teardown of the current session. This is a clean stop (no
     * immediate re-init), which the LVGL adapter handles reliably. */
    if (strcmp(transcript, "stop") == 0) {
        if (s_task == NULL) {
            snprintf(out, outlen, "no UI running\n");
            return ODK_OK;
        }
        odk_voice_ui_stop();
        snprintf(out, outlen, "UI stopped\n");
        return ODK_OK;
    }

    /* Re-launching a UI while one is already live tears down the display and
     * re-registers it on the still-running esp_lvgl_adapter worker, which
     * races the adapter's recursive LVGL lock and deadlocks the pipeline.
     * Require an explicit `cerb ui stop` first; a fresh launch is always safe. */
    if (s_task != NULL) {
        snprintf(out, outlen, "UI already running; run 'cerb ui stop' first\n");
        return ODK_ERR_DENIED;
    }

    /* Built-in stress demo: multi-widget dashboard without LLM. Exercises
     * Direct dirty regions (slider/list/arc), flex layout, and tick animation. */
    if (strcmp(transcript, "demo") == 0) {
        static const char *demo_lua =
            "local lvgl = require('lvgl')\n"
            "local App = {}\n"
            "local S = UI_SCALE\n"
            "local W, H = WIDTH, HEIGHT\n"
            "local taps, playing = 0, false\n"
            "local status, level_lbl, bar, arc, sw\n"
            "function App.on_start(ctx)\n"
            "  local root = ctx.root\n"
            "  root:set_flex({ flow='column', main='start', cross='center', "
            "track='start' })\n"
            "  local hdr = lvgl.container(root, {\n"
            "    w=W-16*S, h=28*S, bg_color='#132033', radius=10*S, pad=6*S, "
            "border_width=0 })\n"
            "  hdr:set_flex({ flow='row', main='space_between', cross='center', "
            "track='center' })\n"
            "  lvgl.label(hdr, { text=ICONS.wifi .. ' Vault', "
            "text_color='#8fd3ff' })\n"
            "  status = lvgl.label(hdr, { text=ICONS.home .. ' Open DeskOS', "
            "text_color='#ffffff' })\n"
            "  lvgl.label(hdr, { text=ICONS.battery_3 .. ' 76%', "
            "text_color='#9ae6b4' })\n"
            "  local hero = lvgl.container(root, {\n"
            "    w=W-16*S, h=56*S, bg_color='#15263a', radius=12*S, pad=8*S, "
            "border_width=0 })\n"
            "  hero:set_flex({ flow='column', main='center', cross='center', "
            "track='center' })\n"
            "  lvgl.label(hero, { text='Sunny · 26 C', text_color='#ffe08a' })\n"
            "  lvgl.label(hero, { text=ICONS.gps .. ' Shanghai', "
            "text_color='#94a3b8' })\n"
            "  local ctrl = lvgl.container(root, {\n"
            "    w=W-16*S, h=100*S, bg_color='#15263a', radius=12*S, pad=10*S, "
            "pad_row=6*S, border_width=0 })\n"
            "  ctrl:set_flex({ flow='column', main='start', cross='center', "
            "track='start' })\n"
            "  level_lbl = lvgl.label(ctrl, { text=ICONS.volume_mid .. ' Level 42', "
            "text_color='#e2e8f0' })\n"
            "  bar = lvgl.bar(ctrl, { w=W-48*S, h=12*S, min=0, max=100, value=42, "
            "bg_color='#263241' })\n"
            "  local slider = lvgl.slider(ctrl, { w=W-48*S, h=16*S, min=0, max=100, "
            "value=42 })\n"
            "  slider:on('value_changed', function()\n"
            "    local v = slider:get_value()\n"
            "    bar:set_value(v, false)\n"
            "    arc:set_value(v, false)\n"
            "    level_lbl:set_text(ICONS.volume_mid .. ' Level ' .. v)\n"
            "  end)\n"
            "  local row = lvgl.container(ctrl, {\n"
            "    w=W-48*S, h=28*S, bg_opa=0, border_width=0, pad=0, pad_column=10*S })\n"
            "  row:set_flex({ flow='row', main='space_between', cross='center', "
            "track='center' })\n"
            "  lvgl.checkbox(row, { text='Notify', checked=true, "
            "text_color='#e2e8f0' })\n"
            "  sw = lvgl.switch(row, { checked=true })\n"
            "  sw:on('value_changed', function()\n"
            "    status:set_text(sw:get_value() and (ICONS.ok .. ' Live') or "
            "(ICONS.mute .. ' Mute'))\n"
            "  end)\n"
            "  arc = lvgl.arc(ctrl, { w=40*S, h=40*S, min=0, max=100, value=42 })\n"
            "  local media = lvgl.container(root, {\n"
            "    w=W-16*S, h=36*S, bg_color='#15263a', radius=12*S, pad=4*S, "
            "border_width=0 })\n"
            "  media:set_flex({ flow='row', main='space_evenly', cross='center', "
            "track='center' })\n"
            "  local function mbtn(sym, color)\n"
            "    return lvgl.button(media, { text=sym, w=44*S, h=28*S, "
            "bg_color=color, text_color='#ffffff', radius=8*S })\n"
            "  end\n"
            "  mbtn(ICONS.prev, '#334155'):on('clicked', function()\n"
            "    status:set_text(ICONS.prev .. ' Prev')\n"
            "  end)\n"
            "  local play = mbtn(ICONS.play, '#2f80ed')\n"
            "  play:on('clicked', function()\n"
            "    playing = not playing\n"
            "    play:set_text(playing and ICONS.pause or ICONS.play)\n"
            "    status:set_text(playing and (ICONS.audio .. ' Playing') or "
            "(ICONS.pause .. ' Paused'))\n"
            "  end)\n"
            "  mbtn(ICONS.next, '#334155'):on('clicked', function()\n"
            "    status:set_text(ICONS.next .. ' Next')\n"
            "  end)\n"
            "  local list = lvgl.list(root, {\n"
            "    w=W-16*S, h=110*S, bg_color='#101929', radius=12*S, "
            "border_width=0 })\n"
            "  local rooms = {\n"
            "    {ICONS.home, 'Living room'}, {ICONS.bell, 'Hallway'},\n"
            "    {ICONS.settings, 'Kitchen'}, {ICONS.charge, 'Garage'},\n"
            "    {ICONS.gps, 'Garden'}, {ICONS.bluetooth, 'Studio'},\n"
            "    {ICONS.wifi, 'Office'}, {ICONS.warning, 'Basement'}\n"
            "  }\n"
            "  for _, r in ipairs(rooms) do\n"
            "    local item = list:add_button(r[2], r[1])\n"
            "    item:on('clicked', function()\n"
            "      taps = taps + 1\n"
            "      status:set_text(ICONS.ok .. ' ' .. r[2] .. ' #' .. taps)\n"
            "      print('voice_ui room=' .. r[2] .. ' taps=' .. taps)\n"
            "    end)\n"
            "  end\n"
            "  local refresh = lvgl.button(root, {\n"
            "    text=ICONS.refresh .. ' Refresh', w=160*S, h=36*S, "
            "bg_color='#2f80ed', text_color='#ffffff', radius=10*S })\n"
            "  refresh:on('clicked', function()\n"
            "    taps = taps + 1\n"
            "    status:set_text(ICONS.refresh .. ' synced #' .. taps)\n"
            "    print('voice_ui refresh taps=' .. taps)\n"
            "  end)\n"
            "end\n"
            "function App.on_tick(ctx)\n"
            "  -- The App Runner owns LVGL event processing.\n"
            "end\n"
            "return App\n";
        odk_err_t err = load_and_start(demo_lua, "app", "voice_demo", "Voice Demo");
        if (err != ODK_OK) {
            snprintf(out, outlen, "ui demo failed (error %d)\n", (int)err);
            return err;
        }
        snprintf(out, outlen,
                 "voice UI stress demo running (slider/list/arc/media + tick anim)\n");
        return ODK_OK;
    }

    /* AIODI OS shell: boots the require()-able `launcher` module — home icon
     * grid + app screens + navigation, built on the `aiodi` design system.
     * No LLM needed. */
    if (strcmp(transcript, "launcher") == 0) {
        static const char *launcher_lua =
            "local L = require('launcher')\n"
            "return {\n"
            "  on_start = function(ctx) return L.on_start(ctx) end,\n"
            "  on_tick = function(ctx) return L.on_tick(ctx) end,\n"
            "  on_stop = function(ctx) return L.on_stop(ctx) end,\n"
            "}\n";
        odk_err_t err = load_and_start(launcher_lua, "shell", "launcher", "Open DeskOS");
        if (err != ODK_OK) {
            snprintf(out, outlen, "ui launcher failed (error %d)\n", (int)err);
            return err;
        }
        snprintf(out, outlen, "AIODI launcher running\n");
        return ODK_OK;
    }

    /* Isolated swipe-cost demo: 3 flat colored pages in the launcher's exact
     * scroll geometry, no SVG/radius/big-font content. Isolates whether swipe
     * jank lives in the scroll container + render path or in page content. */
    if (strcmp(transcript, "swipe") == 0) {
        static const char *swipe_lua =
            "local S = require('minimal_swipe')\n"
            "return {\n"
            "  on_start = function(ctx) return S.on_start(ctx) end,\n"
            "  on_tick = function(ctx) return S.on_tick(ctx) end,\n"
            "  on_stop = function(ctx) return S.on_stop(ctx) end,\n"
            "}\n";
        odk_err_t err = load_and_start(swipe_lua, "shell", "swipe", "Swipe Demo");
        if (err != ODK_OK) {
            snprintf(out, outlen, "ui swipe failed (error %d)\n", (int)err);
            return err;
        }
        snprintf(out, outlen, "minimal swipe demo running\n");
        return ODK_OK;
    }

    if (llm == NULL) {
        snprintf(out, outlen, "ui failed: LLM not ready\n");
        return ODK_ERR_DENIED;
    }

    char *lua_buf = malloc(VOICE_UI_LUA_BUF);
    if (lua_buf == NULL) {
        snprintf(out, outlen, "ui failed: oom\n");
        return ODK_ERR_OOM;
    }
    lua_buf[0] = '\0';

    ESP_LOGI(TAG, "voice UI generate from transcript (%u chars)", (unsigned)strlen(transcript));

    char lint_reason[128];
    const char *user = transcript;
    char *retry_msg = NULL;
    odk_llm_usage_t usage = {0};
    odk_err_t err = ODK_OK;
    for (int attempt = 0; attempt < 2; attempt++) {
        err = svc_llm_complete(llm, s_system_prompt, user, lua_buf, VOICE_UI_LUA_BUF, &usage);
        if (err != ODK_OK) {
            snprintf(out, outlen, "ui llm failed (error %d)\n", (int)err);
            free(retry_msg);
            free(lua_buf);
            return err;
        }
        strip_markdown_fences(lua_buf);
        int viol = voice_ui_lint(lua_buf, lint_reason, sizeof(lint_reason));
        if (viol) {
            ESP_LOGW(TAG, "AIODI lint (attempt %d): %s", attempt, lint_reason);
        } else {
            ESP_LOGI(TAG, "AIODI lint clean");
        }
        if (viol == 0 || attempt == 1) break;

        /* One corrective retry: fold the violations into the user message. */
        size_t need = strlen(transcript) + strlen(lint_reason) + 256;
        retry_msg = malloc(need);
        if (retry_msg == NULL) break;
        snprintf(retry_msg, need, VOICE_UI_RETRY_FMT, transcript, lint_reason);
        user = retry_msg;
        ESP_LOGW(TAG, "regenerating once to fix AIODI violations");
    }
    free(retry_msg);

    if (strstr(lua_buf, "on_start") == NULL || strstr(lua_buf, "return") == NULL) {
        ESP_LOGW(TAG, "LLM Lua missing App on_start module; preview=%.120s", lua_buf);
        snprintf(out, outlen, "ui failed: LLM did not return an App module\n");
        free(lua_buf);
        return ODK_ERR_HTTP;
    }

    err = load_and_start(lua_buf, "app", "voice_generated", "Voice");
    free(lua_buf);
    if (err != ODK_OK) {
        snprintf(out, outlen, "ui run failed (error %d)\n", (int)err);
        return err;
    }

    snprintf(out, outlen,
             "voice UI running (tokens in=%u out=%u, quota remaining=%u)\n"
             "  (simulated mic transcript -> LLM Lua+LVGL on panel)\n",
             (unsigned)usage.in_tokens, (unsigned)usage.out_tokens,
             (unsigned)svc_llm_quota_remaining(llm));
    return ODK_OK;
}
