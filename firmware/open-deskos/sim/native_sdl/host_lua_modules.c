/*
 * host_lua_modules.c — minimal host Lua module stubs for the open-deskos sim.
 *
 * The AIODI launcher (launcher.lua + aiodi.lua) only requires `lvgl` (the C
 * module, registered separately) and reads the injected globals PANEL /
 * WIDTH / HEIGHT / PANEL_IF / ICONS / TOUCH — it does NOT require any Lua-side
 * hardware module at boot. Touch is wired through the C path:
 * lvgl.indev_register('touch', TOUCH) -> lua_lvgl_touch_read_cb, which calls
 * the host esp_lcd_touch_get_data (sim_esp_compat.c) backed by the SDL mouse.
 *
 * This file is therefore intentionally small. As the shell grows to exercise
 * more on-device Lua modules (storage, json, system, ...), add their
 * luaopen_<name> stubs here and register them from sim_register_modules().
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include <lua.h>
#include <lauxlib.h>

#include "esp_err.h"

/* No-op delay module: launcher scripts may `require("delay")` and call
 * delay.ms(); map to SDL_Delay via the vTaskDelay shim's host sleep. */
extern void vTaskDelay(unsigned int ticks);

static int host_delay_ms(lua_State *L)
{
    lua_Integer ms = luaL_optinteger(L, 1, 0);
    if (ms > 0) {
        vTaskDelay((unsigned int)ms);
    }
    return 0;
}

int luaopen_delay(lua_State *L)
{
    lua_newtable(L);
    lua_pushcfunction(L, host_delay_ms);
    lua_setfield(L, -2, "ms");
    return 1;
}
