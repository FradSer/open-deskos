/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "lua_lvgl_private.h"

int lua_lvgl_set_text(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    const char *text = luaL_checkstring(L, 2);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    switch (type) {
    case LUA_LVGL_OBJ_LABEL:
    case LUA_LVGL_OBJ_LIST_TEXT:
    case LUA_LVGL_OBJ_LIST_BUTTON:
        lv_label_set_text(obj, text);
        break;
    case LUA_LVGL_OBJ_BUTTON:
        if (!ud->record->aux_obj || !lv_obj_is_valid(ud->record->aux_obj)) {
            ud->record->aux_obj = lv_label_create(obj);
            lv_obj_align(ud->record->aux_obj, LV_ALIGN_CENTER, 0, 0);
        }
        lv_label_set_text(ud->record->aux_obj, text);
        break;
    case LUA_LVGL_OBJ_CHECKBOX:
        lv_checkbox_set_text(obj, text);
        break;
    case LUA_LVGL_OBJ_DROPDOWN:
        lv_dropdown_set_text(obj, text);
        break;
    case LUA_LVGL_OBJ_TEXTAREA:
        lv_textarea_set_text(obj, text);
        break;
    default:
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl set_text does not support this object type");
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_get_pos(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lua_pushinteger(L, lv_obj_get_x(obj));
    lua_pushinteger(L, lv_obj_get_y(obj));
    lua_lvgl_unlock();
    return 2;
}

int lua_lvgl_get_size(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lua_pushinteger(L, lv_obj_get_width(obj));
    lua_pushinteger(L, lv_obj_get_height(obj));
    lua_lvgl_unlock();
    return 2;
}

int lua_lvgl_get_coords(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    lv_area_t coords;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_get_coords(obj, &coords);
    lua_pushinteger(L, coords.x1);
    lua_pushinteger(L, coords.y1);
    lua_pushinteger(L, lv_area_get_width(&coords));
    lua_pushinteger(L, lv_area_get_height(&coords));
    lua_lvgl_unlock();
    return 4;
}

int lua_lvgl_is_valid(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lua_lvgl_obj_record_t *record = ud->record;
    bool valid = false;

    if (lua_lvgl_lock() == ESP_OK) {
        if (s_lvgl.runtime_initialized &&
                record &&
                record->generation == s_lvgl.generation &&
                record->valid &&
                record->obj &&
                lv_obj_is_valid(record->obj)) {
            valid = true;
        } else if (record) {
            record->valid = false;
            record->obj = NULL;
        }
        lua_lvgl_unlock();
    }
    lua_pushboolean(L, valid);
    return 1;
}

int lua_lvgl_get_value(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }

    switch (type) {
    case LUA_LVGL_OBJ_BAR:
        lua_pushinteger(L, lv_bar_get_value(obj));
        break;
    case LUA_LVGL_OBJ_SLIDER:
        lua_pushinteger(L, lv_slider_get_value(obj));
        break;
    case LUA_LVGL_OBJ_ARC:
        lua_pushinteger(L, lv_arc_get_value(obj));
        break;
    case LUA_LVGL_OBJ_SCALE:
        lua_pushinteger(L, ud->record->value_cache);
        break;
    case LUA_LVGL_OBJ_DROPDOWN:
        lua_pushinteger(L, (lua_Integer)lv_dropdown_get_selected(obj) + 1);
        break;
    case LUA_LVGL_OBJ_ROLLER:
        lua_pushinteger(L, (lua_Integer)lv_roller_get_selected(obj) + 1);
        break;
    case LUA_LVGL_OBJ_CHECKBOX:
    case LUA_LVGL_OBJ_SWITCH:
        lua_pushboolean(L, lv_obj_has_state(obj, LV_STATE_CHECKED));
        break;
    case LUA_LVGL_OBJ_SPINBOX:
        lua_pushinteger(L, lv_spinbox_get_value(obj));
        break;
    default:
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl get_value does not support this object type");
    }
    lua_lvgl_unlock();
    return 1;
}

int lua_lvgl_set_value(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lua_lvgl_obj_type_t type;
    bool anim = lua_toboolean(L, 3);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }

    switch (type) {
    case LUA_LVGL_OBJ_BAR:
        lv_bar_set_value(obj, (int32_t)luaL_checkinteger(L, 2), anim ? LV_ANIM_ON : LV_ANIM_OFF);
        break;
    case LUA_LVGL_OBJ_SLIDER:
        lv_slider_set_value(obj, (int32_t)luaL_checkinteger(L, 2), anim ? LV_ANIM_ON : LV_ANIM_OFF);
        break;
    case LUA_LVGL_OBJ_ARC:
        lv_arc_set_value(obj, (int32_t)luaL_checkinteger(L, 2));
        break;
    case LUA_LVGL_OBJ_SCALE:
        ud->record->value_cache = (int)luaL_checkinteger(L, 2);
        break;
    case LUA_LVGL_OBJ_DROPDOWN: {
        int selected = (int)luaL_checkinteger(L, 2);
        lv_dropdown_set_selected(obj, selected > 0 ? (uint32_t)(selected - 1) : 0);
        break;
    }
    case LUA_LVGL_OBJ_ROLLER: {
        int selected = (int)luaL_checkinteger(L, 2);
        lv_roller_set_selected(obj, selected > 0 ? (uint32_t)(selected - 1) : 0, anim ? LV_ANIM_ON : LV_ANIM_OFF);
        break;
    }
    case LUA_LVGL_OBJ_CHECKBOX:
    case LUA_LVGL_OBJ_SWITCH:
        if (lua_toboolean(L, 2)) {
            lv_obj_add_state(obj, LV_STATE_CHECKED);
        } else {
            lv_obj_remove_state(obj, LV_STATE_CHECKED);
        }
        break;
    case LUA_LVGL_OBJ_SPINBOX:
        lv_spinbox_set_value(obj, (int32_t)luaL_checkinteger(L, 2));
        break;
    default:
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl set_value does not support this object type");
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_range(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int min_value = (int)luaL_checkinteger(L, 2);
    int max_value = (int)luaL_checkinteger(L, 3);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_argcheck(L, max_value > min_value, 3, "max must be greater than min");
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }

    switch (type) {
    case LUA_LVGL_OBJ_BAR:
        lv_bar_set_range(obj, min_value, max_value);
        break;
    case LUA_LVGL_OBJ_SLIDER:
        lv_slider_set_range(obj, min_value, max_value);
        break;
    case LUA_LVGL_OBJ_ARC:
        lv_arc_set_range(obj, min_value, max_value);
        break;
    case LUA_LVGL_OBJ_SCALE:
        lv_scale_set_range(obj, min_value, max_value);
        break;
    case LUA_LVGL_OBJ_SPINBOX:
        lv_spinbox_set_range(obj, min_value, max_value);
        break;
    default:
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl set_range does not support this object type");
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_arc_bg_angles(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int start_angle = (int)luaL_checkinteger(L, 2);
    int end_angle = (int)luaL_checkinteger(L, 3);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (type != LUA_LVGL_OBJ_ARC) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl set_bg_angles only supports arc objects");
    }

    lv_arc_set_bg_angles(obj, start_angle, end_angle);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_pos(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int x = (int)luaL_checkinteger(L, 2);
    int y = (int)luaL_checkinteger(L, 3);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_set_pos(obj, x, y);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_size(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int w = (int)luaL_checkinteger(L, 2);
    int h = (int)luaL_checkinteger(L, 3);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_argcheck(L, w > 0 && h > 0, 2, "width and height must be positive");
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_set_size(obj, w, h);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_frame(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int x = (int)luaL_checkinteger(L, 2);
    int y = (int)luaL_checkinteger(L, 3);
    int w = (int)luaL_checkinteger(L, 4);
    int h = (int)luaL_checkinteger(L, 5);
    int radius = (int)luaL_checkinteger(L, 6);
    luaL_argcheck(L, w > 0 && h > 0, 4,
                  "frame width and height must be positive");
    luaL_argcheck(L, radius >= 0, 6,
                  "frame radius must be non-negative");

    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    /* Geometry and clipping update under one LVGL lock so the renderer cannot
     * observe a partially-updated rounded frame. */
    lv_obj_set_pos(obj, x, y);
    lv_obj_set_size(obj, w, h);
    /* Hero cover animates radius every tick; LVGL invalidates on every
     * set_style_radius even when the value is unchanged, rebuilding the SW
     * rounded-corner mask each frame. Skip the radius/clip writes when the
     * current style already matches so a steady geometry tick is a pure
     * pos/size update (see hero_transition_contract — set_frame stays the
     * geometry-only path, this only avoids redundant invalidation). */
    bool want_clip = radius > 0;
    if (lv_obj_get_style_radius(obj, LV_PART_MAIN) != radius ||
        lv_obj_get_style_clip_corner(obj, LV_PART_MAIN) != want_clip) {
        lv_obj_set_style_radius(obj, radius, LV_PART_MAIN);
        lv_obj_set_style_clip_corner(obj, want_clip, LV_PART_MAIN);
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_transform(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int32_t scale_x = (int32_t)luaL_checkinteger(L, 2);
    int32_t scale_y = (int32_t)luaL_checkinteger(L, 3);
    int32_t pivot_x = (int32_t)luaL_checkinteger(L, 4);
    int32_t pivot_y = (int32_t)luaL_checkinteger(L, 5);
    luaL_argcheck(L, scale_x > 0 && scale_y > 0, 2,
                  "transform scale must be positive");
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    /* LVGL uses 256 as the identity scale. Pivot is expressed in the
     * untransformed object's local coordinates; the Hero transition keeps it
     * at the full-screen frame centre so the source rect remains the anchor. */
    lv_obj_set_style_transform_scale_x(obj, scale_x, LV_PART_MAIN);
    lv_obj_set_style_transform_scale_y(obj, scale_y, LV_PART_MAIN);
    lv_obj_set_style_transform_pivot_x(obj, pivot_x, LV_PART_MAIN);
    lv_obj_set_style_transform_pivot_y(obj, pivot_y, LV_PART_MAIN);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_clickable(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    bool clickable = lua_toboolean(L, 2);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (clickable) {
        lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    } else {
        lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

/* obj:reparent(new_parent) — move obj under a new parent (lv_obj_set_parent).
 * Used by the snapshot pager to keep a snapshot image out of a slot's tree
 * while that slot is cleaned, then move it in as the only child. */
int lua_lvgl_reparent(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lua_lvgl_obj_ud_t *parent_ud = lua_lvgl_check_ud(L, 2);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    lv_obj_t *parent;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    parent = lua_lvgl_validate_ud_locked(parent_ud, NULL, &obj_error);
    if (!parent) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_set_parent(obj, parent);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_align(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    const char *align_value = luaL_checkstring(L, 2);
    int x = (int)luaL_optinteger(L, 3, 0);
    int y = (int)luaL_optinteger(L, 4, 0);
    lv_align_t align;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (lua_lvgl_parse_align(L, align_value, &align) != ESP_OK) {
        return luaL_error(L, "lvgl align must be top_left, top_mid, top_right, bottom_left, bottom_mid, bottom_right, left_mid, right_mid, or center");
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_align(obj, align, x, y);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

/* These functions are exposed exclusively as methods on per-type metatables
 * built in lua_lvgl_methods.c. They are no longer registered on the `lvgl`
 * module table itself. */
