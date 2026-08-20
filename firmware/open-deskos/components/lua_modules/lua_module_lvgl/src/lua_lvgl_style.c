/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "lua_lvgl_private.h"

static void lua_lvgl_apply_color_style_field(lua_State *L, int index, lv_obj_t *obj, const char *field)
{
    lv_color_t color;

    lua_getfield(L, index, field);
    if (!lua_isnil(L, -1)) {
        if (lua_lvgl_parse_color(L, -1, &color) != ESP_OK) {
            luaL_error(L, "lvgl style '%s' must be a 0xRRGGBB number or '#RRGGBB' string", field);
        }
        if (strcmp(field, "bg_color") == 0) {
            lv_obj_set_style_bg_color(obj, color, 0);
            /* Keep pressed look stable: default theme recolors black@35% and
             * may grow the widget — both flash badly on DSI direct FBs. */
            lv_obj_set_style_bg_color(obj, color, LV_STATE_PRESSED);
            lv_obj_set_style_recolor_opa(obj, LV_OPA_TRANSP, LV_STATE_PRESSED);
            lv_obj_set_style_transform_width(obj, 0, LV_STATE_PRESSED);
            lv_obj_set_style_transform_height(obj, 0, LV_STATE_PRESSED);
        } else if (strcmp(field, "text_color") == 0) {
            lv_obj_set_style_text_color(obj, color, 0);
            lv_obj_set_style_text_color(obj, color, LV_STATE_PRESSED);
        } else if (strcmp(field, "border_color") == 0) {
            lv_obj_set_style_border_color(obj, color, 0);
        } else if (strcmp(field, "line_color") == 0) {
            lv_obj_set_style_line_color(obj, color, 0);
            lv_obj_set_style_arc_color(obj, color, 0);
        }
    }
    lua_pop(L, 1);
}

static void lua_lvgl_apply_text_align_style_field(lua_State *L, int index, lv_obj_t *obj)
{
    const char *value;
    lv_text_align_t align;

    lua_getfield(L, index, "text_align");
    if (lua_isnil(L, -1)) {
        lua_pop(L, 1);
        return;
    }
    value = luaL_checkstring(L, -1);
    if (strcmp(value, "left") == 0) {
        align = LV_TEXT_ALIGN_LEFT;
    } else if (strcmp(value, "center") == 0) {
        align = LV_TEXT_ALIGN_CENTER;
    } else if (strcmp(value, "right") == 0) {
        align = LV_TEXT_ALIGN_RIGHT;
    } else {
        luaL_error(L, "lvgl style 'text_align' must be left, center, or right");
        return;
    }
    lua_pop(L, 1);
    lv_obj_set_style_text_align(obj, align, 0);
}

static void lua_lvgl_apply_style_int_field(lua_State *L, int index, lv_obj_t *obj, const char *field)
{
    int value;

    lua_getfield(L, index, field);
    if (lua_isnil(L, -1)) {
        lua_pop(L, 1);
        return;
    }
    if (!lua_isinteger(L, -1)) {
        luaL_error(L, "lvgl style '%s' must be an integer", field);
    }
    value = (int)lua_tointeger(L, -1);
    lua_pop(L, 1);

    if (strcmp(field, "bg_opa") == 0) {
        lv_obj_set_style_bg_opa(obj, (lv_opa_t)value, 0);
    } else if (strcmp(field, "pressed_bg_opa") == 0) {
        /* Immediate visual acknowledgement without the theme's transform:
         * LVGL resolves this state on the display task, so it never waits for
         * the queued Lua event callback. */
        lv_obj_set_style_bg_opa(obj, (lv_opa_t)value, LV_STATE_PRESSED);
    } else if (strcmp(field, "opa") == 0) {
        lv_obj_set_style_opa(obj, (lv_opa_t)value, 0);
    } else if (strcmp(field, "opa_layered") == 0) {
        lv_obj_set_style_opa_layered(obj, (lv_opa_t)value, 0);
    } else if (strcmp(field, "radius") == 0) {
        lv_obj_set_style_radius(obj, value, 0);
    } else if (strcmp(field, "clip_corner") == 0) {
        /* Clip children to the rounded corners. Without it a square child laid
         * into a rounded parent (a progress fill in its track) punches its own
         * corners back out through the radius. */
        lv_obj_set_style_clip_corner(obj, value != 0, 0);
    } else if (strcmp(field, "border_width") == 0) {
        lv_obj_set_style_border_width(obj, value, 0);
    } else if (strcmp(field, "pad") == 0) {
        lv_obj_set_style_pad_all(obj, value, 0);
    } else if (strcmp(field, "pad_row") == 0) {
        lv_obj_set_style_pad_row(obj, value, 0);
    } else if (strcmp(field, "pad_column") == 0) {
        lv_obj_set_style_pad_column(obj, value, 0);
    } else if (strcmp(field, "line_width") == 0) {
        lv_obj_set_style_line_width(obj, value, 0);
    } else if (strcmp(field, "arc_width") == 0) {
        lv_obj_set_style_arc_width(obj, value, 0);
    } else if (strcmp(field, "shadow_width") == 0) {
        lv_obj_set_style_shadow_width(obj, value, 0);
    } else if (strcmp(field, "shadow_opa") == 0) {
        lv_obj_set_style_shadow_opa(obj, (lv_opa_t)value, 0);
    } else if (strcmp(field, "flex_grow") == 0) {
        /* Flex item grow factor. Without this, `flex_grow=` in create opts is
         * a silent no-op and siblings with a fixed width (e.g. peek Start)
         * squeeze content-sized neighbours to zero. */
        lv_obj_set_flex_grow(obj, (uint8_t)value);
    }
}

void lua_lvgl_apply_style_opts_locked(lua_State *L, int index, lv_obj_t *obj)
{
    if (!lua_lvgl_opt_table(L, index)) {
        return;
    }

    lua_lvgl_apply_color_style_field(L, index, obj, "bg_color");
    lua_lvgl_apply_color_style_field(L, index, obj, "text_color");
    lua_lvgl_apply_color_style_field(L, index, obj, "border_color");
    lua_lvgl_apply_color_style_field(L, index, obj, "line_color");
    lua_lvgl_apply_text_align_style_field(L, index, obj);
    lua_lvgl_apply_style_int_field(L, index, obj, "bg_opa");
    lua_lvgl_apply_style_int_field(L, index, obj, "pressed_bg_opa");
    lua_lvgl_apply_style_int_field(L, index, obj, "opa");
    lua_lvgl_apply_style_int_field(L, index, obj, "opa_layered");
    lua_lvgl_apply_style_int_field(L, index, obj, "radius");
    lua_lvgl_apply_style_int_field(L, index, obj, "clip_corner");
    lua_lvgl_apply_style_int_field(L, index, obj, "border_width");
    lua_lvgl_apply_style_int_field(L, index, obj, "pad");
    lua_lvgl_apply_style_int_field(L, index, obj, "pad_row");
    lua_lvgl_apply_style_int_field(L, index, obj, "pad_column");
    lua_lvgl_apply_style_int_field(L, index, obj, "line_width");
    lua_lvgl_apply_style_int_field(L, index, obj, "arc_width");
    lua_lvgl_apply_style_int_field(L, index, obj, "shadow_width");
    lua_lvgl_apply_style_int_field(L, index, obj, "shadow_opa");
    lua_lvgl_apply_style_int_field(L, index, obj, "flex_grow");
    /* `hidden` toggles LV_OBJ_FLAG_HIDDEN: the whole subtree is skipped by the
     * renderer (lv_refr.c lv_obj_refr returns early on HIDDEN). Used by the
     * launcher pager to swap a live page's widget tree out for a snapshot
     * image during a swipe (blit instead of ~100-widget redraw). */
    lua_getfield(L, index, "hidden");
    if (!lua_isnil(L, -1)) {
        if (lua_toboolean(L, -1)) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
        }
    }
    lua_pop(L, 1);
    /* `floating` toggles LV_OBJ_FLAG_FLOATING: the object is skipped by parent
     * flex/grid layout and by parent scroll, so it can be absolutely positioned
     * with x/y inside a laid-out container. Used for the opencode watermark on
     * the agent-quota card (bottom-right, behind the card's content). */
    lua_getfield(L, index, "floating");
    if (!lua_isnil(L, -1)) {
        if (lua_toboolean(L, -1)) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_FLOATING);
        } else {
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_FLOATING);
        }
    }
    lua_pop(L, 1);
    lua_lvgl_apply_font_style_field(L, index, obj);
}
int lua_lvgl_set_style(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_checktype(L, 2, LUA_TTABLE);
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lua_lvgl_apply_style_opts_locked(L, 2, obj);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

/* set_style is exposed as a method on every widget metatable via the base
 * method table in lua_lvgl_methods.c. */
