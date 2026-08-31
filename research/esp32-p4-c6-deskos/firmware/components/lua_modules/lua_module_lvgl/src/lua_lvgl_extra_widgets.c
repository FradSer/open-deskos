/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "lua_lvgl_private.h"

#if defined(ESP_PLATFORM) && LV_USE_PPA && LV_USE_PPA_IMG
#include "esp_cache.h"
#endif

/* A snapshot is CPU-rendered once while the pager is idle, then immutable for
 * its whole drag lifetime. PPA reads PSRAM directly, so write back the source
 * buffer once before the image becomes visible; doing this in the draw path
 * would repeat a full-image cache sync for every partial refresh stripe. */
static esp_err_t lua_lvgl_snapshot_sync_for_ppa(const lv_draw_buf_t *draw_buf)
{
#if defined(ESP_PLATFORM) && LV_USE_PPA && LV_USE_PPA_IMG
    if (!draw_buf || !draw_buf->data || draw_buf->data_size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_cache_msync(draw_buf->data, draw_buf->data_size,
                           ESP_CACHE_MSYNC_FLAG_DIR_C2M |
                           ESP_CACHE_MSYNC_FLAG_TYPE_DATA |
                           ESP_CACHE_MSYNC_FLAG_UNALIGNED);
#else
    (void)draw_buf;
    return ESP_OK;
#endif
}

static int lua_lvgl_image(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_IMAGE);
}

/* lvgl.snapshot_take(src, parent?) -> image widget
 *
 * Renders `src` (with its children) into an offscreen RGB565 draw buffer and
 * returns a lv_image widget showing that bitmap. The image widget owns the
 * draw buffer (released via lv_draw_buf_destroy when the widget is deleted or
 * the runtime is torn down), so the returned image can be moved/scaled freely
 * without re-drawing the source's widget tree — this is what makes pager
 * swipes blit one bitmap per page instead of re-rendering ~100 widgets/frame.
 *
 * The draw buffer is attached to the image widget's record->data with
 * LUA_LVGL_SNAPSHOT_DATA_MAGIC so lua_lvgl_record_release_resources() picks
 * lv_draw_buf_destroy() over free(). */
int lua_lvgl_snapshot_take(lua_State *L)
{
    lua_lvgl_obj_ud_t *src_ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *src;
    const char *src_error = NULL;
    lv_obj_t *parent = NULL;
    lv_obj_t *img = NULL;
    lv_draw_buf_t *draw_buf = NULL;
    lua_lvgl_snapshot_t *snap = NULL;
    lua_lvgl_obj_ud_t *img_ud = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    src = lua_lvgl_validate_ud_locked(src_ud, NULL, &src_error);
    if (!src) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", src_error);
    }
    /* Optional parent (any widget userdata) for the returned image. */
    if (!lua_isnoneornil(L, 2)) {
        lua_lvgl_obj_ud_t *parent_ud = lua_lvgl_check_ud(L, 2);
        parent = lua_lvgl_validate_ud_locked(parent_ud, NULL, &src_error);
        if (!parent) {
            lua_lvgl_unlock();
            return luaL_error(L, "%s", src_error);
        }
    }

#if LV_USE_SNAPSHOT
    draw_buf = lv_snapshot_take(src, LV_COLOR_FORMAT_RGB565);
#else
    draw_buf = NULL;
#endif
    if (!draw_buf) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl.snapshot_take: snapshot failed (is LV_USE_SNAPSHOT enabled?)");
    }
    err = lua_lvgl_snapshot_sync_for_ppa(draw_buf);
    if (err != ESP_OK) {
        lv_draw_buf_destroy(draw_buf);
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl.snapshot_take: PPA source cache sync failed: %s", esp_err_to_name(err));
    }

    snap = (lua_lvgl_snapshot_t *)calloc(1, sizeof(*snap));
    if (!snap) {
        lv_draw_buf_destroy(draw_buf);
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl.snapshot_take: allocation failed");
    }
    snap->draw_buf = draw_buf;

    img = lv_image_create(parent);
    if (!img) {
        lv_draw_buf_destroy(draw_buf);
        free(snap);
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl.snapshot_take: image creation failed");
    }
    /* LVGL 9.5: a snapshot draw_buf's header carries LV_IMAGE_FLAGS_ALLOCATED,
     * so lv_image_set_src treats the pointer as a draw_buf and validates
     * unaligned_data/handlers — pass the draw_buf itself, not a hand-rolled
     * lv_image_dsc_t (which would hit "Invalid draw buffer"). The image does
     * NOT free it on delete; lua_lvgl_record_release_resources() destroys it
     * via the SNAPSHOT_DATA_MAGIC path. */
    lv_image_set_src(img, draw_buf);

    img_ud = lua_lvgl_push_obj(L, img, LUA_LVGL_OBJ_IMAGE);
    if (!img_ud || !img_ud->record) {
        lv_obj_delete(img);
        lv_draw_buf_destroy(draw_buf);
        free(snap);
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl.snapshot_take: record allocation failed");
    }
    img_ud->record->data = snap;
    img_ud->record->data_size = LUA_LVGL_SNAPSHOT_DATA_MAGIC;
    lua_lvgl_unlock();
    return 1;
}

static int lua_lvgl_line(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_LINE);
}

static int lua_lvgl_arc(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_ARC);
}

static int lua_lvgl_spinner(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_SPINNER);
}

static int lua_lvgl_scale(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_SCALE);
}

static int lua_lvgl_checkbox(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_CHECKBOX);
}

static int lua_lvgl_switch(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_SWITCH);
}

static int lua_lvgl_dropdown(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_DROPDOWN);
}

static int lua_lvgl_roller(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_ROLLER);
}

static int lua_lvgl_keyboard(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_KEYBOARD);
}

static int lua_lvgl_list(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_LIST);
}

static int lua_lvgl_textarea(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_TEXTAREA);
}

static int lua_lvgl_table(lua_State *L)
{
    return lua_lvgl_create_widget(L, LUA_LVGL_OBJ_TABLE);
}
int lua_lvgl_list_add_text(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    const char *text = luaL_checkstring(L, 2);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *list;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    list = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!list) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (type != LUA_LVGL_OBJ_LIST) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl list:add_text requires a list object");
    }
    obj = lv_list_add_text(list, text);
    if (!lua_lvgl_push_obj(L, obj, LUA_LVGL_OBJ_LIST_TEXT)) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl object record allocation failed");
    }
    lua_lvgl_unlock();
    return 1;
}

int lua_lvgl_list_add_button(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    const char *text = luaL_checkstring(L, 2);
    const char *symbol = lua_isnoneornil(L, 3) ? NULL : luaL_checkstring(L, 3);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *list;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    list = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!list) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (type != LUA_LVGL_OBJ_LIST) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl list:add_button requires a list object");
    }
    obj = lv_list_add_button(list, symbol, text);
    if (!lua_lvgl_push_obj(L, obj, LUA_LVGL_OBJ_LIST_BUTTON)) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl object record allocation failed");
    }
    lua_lvgl_unlock();
    return 1;
}

int lua_lvgl_table_set_cell(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int row = (int)luaL_checkinteger(L, 2);
    int col = (int)luaL_checkinteger(L, 3);
    const char *text = luaL_checkstring(L, 4);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *table;
    const char *obj_error = NULL;

    luaL_argcheck(L, row > 0 && col > 0, 2, "row and col are 1-based and must be positive");
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    table = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!table) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (type != LUA_LVGL_OBJ_TABLE) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl table:set_cell requires a table object");
    }
    lv_table_set_cell_value(table, (uint32_t)(row - 1), (uint32_t)(col - 1), text);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_table_get_cell(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int row = (int)luaL_checkinteger(L, 2);
    int col = (int)luaL_checkinteger(L, 3);
    lua_lvgl_obj_type_t type;
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *table;
    const char *value;
    const char *obj_error = NULL;

    luaL_argcheck(L, row > 0 && col > 0, 2, "row and col are 1-based and must be positive");
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    table = lua_lvgl_validate_ud_locked(ud, &type, &obj_error);
    if (!table) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    if (type != LUA_LVGL_OBJ_TABLE) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl table:get_cell requires a table object");
    }
    value = lv_table_get_cell_value(table, (uint32_t)(row - 1), (uint32_t)(col - 1));
    lua_pushstring(L, value ? value : "");
    lua_lvgl_unlock();
    return 1;
}

/* Only factories are registered on the `lvgl` module table. The list and
 * table compound operations above are exposed as methods on the list/table
 * metatables in lua_lvgl_methods.c. */
const luaL_Reg lua_lvgl_extra_widget_funcs[] = {
    {"image", lua_lvgl_image},
    {"snapshot_take", lua_lvgl_snapshot_take},
    {"line", lua_lvgl_line},
    {"arc", lua_lvgl_arc},
    {"spinner", lua_lvgl_spinner},
    {"scale", lua_lvgl_scale},
    {"checkbox", lua_lvgl_checkbox},
    {"switch", lua_lvgl_switch},
    {"dropdown", lua_lvgl_dropdown},
    {"roller", lua_lvgl_roller},
    {"keyboard", lua_lvgl_keyboard},
    {"list", lua_lvgl_list},
    {"textarea", lua_lvgl_textarea},
    {"table", lua_lvgl_table},
    {NULL, NULL},
};
