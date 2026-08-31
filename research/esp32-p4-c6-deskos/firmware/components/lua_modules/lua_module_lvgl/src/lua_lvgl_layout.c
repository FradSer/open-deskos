/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "lua_lvgl_private.h"

static void lua_lvgl_scroll_begin_cb(lv_event_t *event)
{
    lua_lvgl_obj_record_t *record = (lua_lvgl_obj_record_t *)lv_event_get_user_data(event);
    lv_anim_t *anim;

    if (!record || lv_event_get_code(event) != LV_EVENT_SCROLL_BEGIN) {
        return;
    }
    /* A direct finger drag emits SCROLL_BEGIN without an animation. The
     * release snap carries its lv_anim_t as the event parameter. A zero
     * duration still starts an LVGL animation: its default ease-out path
     * samples the start value at t=0 and can therefore complete without ever
     * applying the selected snap endpoint. Use the step path for that special
     * case so early_apply commits the endpoint before a reverse touch arrives. */
    anim = (lv_anim_t *)lv_event_get_param(event);
    if (anim) {
        lv_anim_set_duration(anim, record->scroll_snap_anim_ms);
        if (record->scroll_snap_anim_ms == 0) {
            lv_anim_set_path_cb(anim, lv_anim_path_step);
        }
    }
}

static bool lua_lvgl_snapshot_layer_valid(const lua_lvgl_obj_record_t *record)
{
    return record && record->valid && record->obj && lv_obj_is_valid(record->obj);
}

static uint8_t lua_lvgl_snapshot_selected_layer(const lua_lvgl_obj_record_t *record)
{
    int32_t page_width;
    int32_t selected;

    if (!record || !record->obj || record->scroll_snapshot_layer_count == 0) {
        return 0;
    }
    page_width = record->scroll_snapshot_page_width;
    if (page_width <= 0) {
        return 0;
    }
    selected = (lv_obj_get_scroll_x(record->obj) + page_width / 2) / page_width;
    if (selected < 0) {
        return 0;
    }
    if (selected >= record->scroll_snapshot_layer_count) {
        return record->scroll_snapshot_layer_count - 1;
    }
    return (uint8_t)selected;
}

/* A transform changes only the marker's draw bounds (LVGL classifies
 * LV_STYLE_TRANSFORM_WIDTH as layout-free), unlike changing its base width.
 * That lets a pager interpolate its three tiny dots every native scroll frame
 * without making the screen or the pager page tree layout-dirty again. */
static void lua_lvgl_update_scroll_snapshot_indicators(lua_lvgl_obj_record_t *record)
{
    int32_t scroll_x;
    int32_t page_width;
    int32_t active_width;
    int32_t idle_width;
    lv_obj_t *bar;
    lv_obj_t *pager;

    if (!record || !record->obj || record->scroll_snapshot_indicator_count == 0 ||
            !lua_lvgl_snapshot_layer_valid(record->scroll_snapshot_indicator_pager)) {
        return;
    }
    page_width = record->scroll_snapshot_page_width;
    active_width = record->scroll_snapshot_indicator_active_width;
    idle_width = record->scroll_snapshot_indicator_idle_width;
    if (page_width <= 0 || active_width <= 0 || idle_width <= 0) {
        return;
    }

    pager = record->scroll_snapshot_indicator_pager->obj;
    scroll_x = lv_obj_get_scroll_x(record->obj);
    for (uint8_t i = 0; i < record->scroll_snapshot_indicator_count; i++) {
        lua_lvgl_obj_record_t *indicator = record->scroll_snapshot_indicators[i];
        lv_obj_t *hit;
        int64_t page_x;
        int64_t distance;
        int32_t visual_width;
        int32_t transform_width;
        int32_t marker_x;
        int32_t marker_y;
        uint8_t intensity;

        if (!lua_lvgl_snapshot_layer_valid(indicator)) {
            continue;
        }
        hit = lv_obj_get_parent(indicator->obj);
        if (!hit) {
            continue;
        }
        page_x = (int64_t)i * page_width;
        distance = page_x - scroll_x;
        if (distance < 0) {
            distance = -distance;
        }
        if (distance > page_width) {
            distance = page_width;
        }
        visual_width = active_width - (int32_t)(((int64_t)(active_width - idle_width) *
                distance + page_width / 2) / page_width);
        /* LVGL applies transform width on both sides of the object. */
        transform_width = (visual_width - active_width) / 2;
        marker_x = (record->scroll_snapshot_indicator_hit_width - active_width) / 2;
        marker_y = (lv_obj_get_height(hit) - record->scroll_snapshot_indicator_height) / 2;
        intensity = (uint8_t)(((int64_t)(page_width - distance) * LV_OPA_COVER) /
                              page_width);

        if (lv_obj_get_width(indicator->obj) != active_width ||
                lv_obj_get_height(indicator->obj) != record->scroll_snapshot_indicator_height) {
            lv_obj_set_size(indicator->obj, active_width,
                            record->scroll_snapshot_indicator_height);
        }
        if (lv_obj_get_x(indicator->obj) != marker_x ||
                lv_obj_get_y(indicator->obj) != marker_y) {
            lv_obj_set_pos(indicator->obj, marker_x, marker_y);
        }
        if (lv_obj_get_style_transform_width(indicator->obj, LV_PART_MAIN) != transform_width) {
            lv_obj_set_style_transform_width(indicator->obj, transform_width, LV_PART_MAIN);
        }
        if (record->scroll_snapshot_indicator_intensity[i] != intensity) {
            lv_obj_set_style_bg_color(indicator->obj,
                    lv_color_mix(record->scroll_snapshot_indicator_active_color,
                                 record->scroll_snapshot_indicator_idle_color,
                                 intensity),
                    LV_PART_MAIN);
            record->scroll_snapshot_indicator_intensity[i] = intensity;
        }
    }

    /* The invisible hit slots always remain centred. Only their child marker
     * transforms change during a drag, avoiding pager-bar position churn. */
    bar = lv_obj_get_parent(pager);
    if (bar) {
        int32_t pager_width = record->scroll_snapshot_indicator_count *
                record->scroll_snapshot_indicator_hit_width;
        int32_t pager_x = (lv_obj_get_width(bar) - pager_width) / 2;
        if (lv_obj_get_x(pager) != pager_x || lv_obj_get_y(pager) != 0) {
            lv_obj_set_pos(pager, pager_x, 0);
        }
    }
}

/* At rest the selected live tree must remain visible: clock, calendar,
 * Pomodoro, and quota values continue to change after the bitmap cache is
 * produced. The bitmap must be renderer-transparent until the next drag;
 * drawing a full cached page underneath the live tree doubles the idle
 * composition cost every time dynamic content invalidates. The lightweight
 * dynamic overlay is likewise needed only while the bitmap moves.
 * The selected page is moved to the foreground of the fixed input overlay.
 * Its transparent, full-page input guard catches blank-area touches, so lower
 * overlapping pages cannot receive them. This avoids HIDDEN flag transitions:
 * those flags mark the entire screen layout dirty on every page selection. */
static void lua_lvgl_set_scroll_snapshot_idle_layers(lua_lvgl_obj_record_t *record)
{
    uint8_t selected = lua_lvgl_snapshot_selected_layer(record);

    for (uint8_t i = 0; i < record->scroll_snapshot_layer_count; i++) {
        lua_lvgl_obj_record_t *live = record->scroll_snapshot_live[i];
        lua_lvgl_obj_record_t *image = record->scroll_snapshot_images[i];
        lua_lvgl_obj_record_t *overlay = record->scroll_snapshot_overlays[i];

        if (lua_lvgl_snapshot_layer_valid(live)) {
            if (i == selected) {
                lv_obj_set_style_opa_layered(live->obj, LV_OPA_COVER, LV_PART_MAIN);
                lv_obj_move_foreground(live->obj);
            } else {
                lv_obj_set_style_opa_layered(live->obj, LV_OPA_TRANSP, LV_PART_MAIN);
            }
        }
        if (lua_lvgl_snapshot_layer_valid(image)) {
            lv_obj_set_style_opa_layered(image->obj, LV_OPA_TRANSP, LV_PART_MAIN);
        }
        if (lua_lvgl_snapshot_layer_valid(overlay)) {
            lv_obj_set_style_opa_layered(overlay->obj, LV_OPA_TRANSP, LV_PART_MAIN);
        }
    }
}

/* Before LVGL applies the first raw scroll delta, make the full live trees
 * renderer-transparent and keep their immutable bitmap siblings visible.
 * Small dynamic overlays (clock/date/timer) travel above those bitmaps, so
 * their values stay current without a full-page snapshot on every tick.
 * Doing this inside the native SCROLL_BEGIN callback preserves the cheap path
 * without leaving stale cache content on top while idle. */
static void lua_lvgl_set_scroll_snapshot_drag_layers(lua_lvgl_obj_record_t *record)
{
    uint8_t selected = lua_lvgl_snapshot_selected_layer(record);

    for (uint8_t i = 0; i < record->scroll_snapshot_layer_count; i++) {
        lua_lvgl_obj_record_t *live = record->scroll_snapshot_live[i];
        lua_lvgl_obj_record_t *image = record->scroll_snapshot_images[i];
        lua_lvgl_obj_record_t *overlay = record->scroll_snapshot_overlays[i];

        if (lua_lvgl_snapshot_layer_valid(live)) {
            lv_obj_set_style_opa_layered(live->obj, LV_OPA_TRANSP, LV_PART_MAIN);
            if (i == selected) {
                lv_obj_move_foreground(live->obj);
            }
        }
        if (lua_lvgl_snapshot_layer_valid(image)) {
            lv_obj_set_style_opa_layered(image->obj, LV_OPA_COVER, LV_PART_MAIN);
        }
        if (lua_lvgl_snapshot_layer_valid(overlay)) {
            lv_obj_set_style_opa_layered(overlay->obj, LV_OPA_COVER, LV_PART_MAIN);
        }
    }
}

static void lua_lvgl_finish_scroll_snapshot(lua_lvgl_obj_record_t *record)
{
    if (!record || !record->scroll_snapshot_active) {
        return;
    }

    /* Keep the phase until the restored live-layer refresh has completed;
     * the trace captures it at REFRESH_START with the matching slow frame. */
    lua_lvgl_indev_trace_pager_phase_locked(LUA_LVGL_PAGER_TRACE_PHASE_RESTORE);
    lua_lvgl_indev_trace_pager_scroll_end_locked();
    lua_lvgl_set_scroll_snapshot_idle_layers(record);
    lua_lvgl_update_scroll_snapshot_indicators(record);
    record->scroll_snapshot_active = false;
    record->scroll_snapshot_snap_active = false;
    record->scroll_snapshot_restarting = false;
    record->scroll_snapshot_replacement_pending = false;
}

static bool lua_lvgl_prepare_scroll_snapshot_replacement(lua_lvgl_obj_record_t *record,
                                                          lv_obj_t *obj, int32_t x, int32_t y,
                                                          bool anim)
{
    if (!anim || !record || !record->scroll_snapshot_active ||
            !record->scroll_snapshot_snap_active) {
        return false;
    }

    /* lv_obj_scroll_to_x() deletes the current x animation before it emits
     * SCROLL_BEGIN for the replacement. Mark it first so the old animation's
     * deleted callback cannot expose the live pages in that gap. This also
     * covers a target equal to the current offset: LVGL still deletes an
     * unstarted predecessor, but starts no replacement and emits no end. The
     * caller below detects that bounded no-op and completes the transition. */
    record->scroll_snapshot_replacement_pending = true;
    return true;
}

static void lua_lvgl_scroll_snapshot_replacement_started_cb(lv_anim_t *anim)
{
    lua_lvgl_obj_record_t *record = (lua_lvgl_obj_record_t *)lv_anim_get_user_data(anim);

    if (record) {
        /* lv_obj_scroll_by() emits the replacement BEGIN before it deletes
         * the previous animation. Do not clear the pending guard on that old
         * nested END: if the old animation had not reached its first timer
         * pass, LVGL emits no END at all. The replacement's own start callback
         * is the only reliable point at which its final END may select the new
         * transparent live input layer. */
        record->scroll_snapshot_replacement_pending = false;
    }
}

static void lua_lvgl_scroll_snapshot_cb(lv_event_t *event)
{
    lua_lvgl_obj_record_t *record = (lua_lvgl_obj_record_t *)lv_event_get_user_data(event);
    lv_event_code_t code = lv_event_get_code(event);
    lv_anim_t *anim;
    bool snap_animation;

    if (!record || record->scroll_snapshot_layer_count == 0) {
        return;
    }
    if (code == LV_EVENT_SCROLL_BEGIN) {
        anim = (lv_anim_t *)lv_event_get_param(event);
        snap_animation = anim != NULL;
        if (snap_animation) {
            lua_lvgl_indev_trace_pager_phase_locked(LUA_LVGL_PAGER_TRACE_PHASE_SNAP);
        } else {
            lua_lvgl_indev_trace_pager_phase_locked(LUA_LVGL_PAGER_TRACE_PHASE_DRAG);
        }
        if (snap_animation && record->scroll_snapshot_snap_active) {
            /* lv_obj_scroll_by() announces the replacement animation before
             * lv_anim_start() deletes the old one. Keep the pending guard
             * until the replacement itself starts: deleting an animation
             * before its first timer pass emits no SCROLL_END at all. */
            record->scroll_snapshot_replacement_pending = true;
            lv_anim_set_user_data(anim, record);
            lv_anim_set_start_cb(anim, lua_lvgl_scroll_snapshot_replacement_started_cb);
        }
        if (!snap_animation && record->scroll_snapshot_snap_active) {
            /* A new drag begins after LVGL has already cleared the input
             * device's scroll object. Stop the old release snap here, while
             * retaining the bitmap layers across its nested SCROLL_END. */
            record->scroll_snapshot_restarting = true;
            lv_obj_stop_scroll_anim(record->obj);
            record->scroll_snapshot_restarting = false;
            record->scroll_snapshot_snap_active = false;
            record->scroll_snapshot_replacement_pending = false;
        }
        if (!record->scroll_snapshot_active) {
            lua_lvgl_indev_trace_pager_scroll_begin_locked();
            lua_lvgl_set_scroll_snapshot_drag_layers(record);
            record->scroll_snapshot_active = true;
        }
        if (snap_animation) {
            record->scroll_snapshot_snap_active = true;
        }
    } else if (code == LV_EVENT_SCROLL) {
        lua_lvgl_update_scroll_snapshot_indicators(record);
    } else if (code == LV_EVENT_SCROLL_END && record->scroll_snapshot_active) {
        /* lv_indev_scroll_handler sends SCROLL_END(indev) immediately after
         * it starts a release snap. Its animation deletion later sends the
         * final SCROLL_END(NULL). Restoring at the former makes the visible
         * snap redraw the complete live widget tree frame by frame. */
        if (record->scroll_snapshot_restarting ||
                record->scroll_snapshot_replacement_pending ||
                (record->scroll_snapshot_snap_active && lv_event_get_param(event) != NULL)) {
            return;
        }
        lua_lvgl_finish_scroll_snapshot(record);
    }
}

static size_t lua_lvgl_read_scroll_snapshot_layer(lua_State *L, int opts_index,
                                                   const char *field,
                                                   lua_lvgl_obj_ud_t **out)
{
    size_t count;

    lua_getfield(L, opts_index, field);
    luaL_checktype(L, -1, LUA_TTABLE);
    count = lua_rawlen(L, -1);
    if (count == 0 || count > LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX) {
        luaL_error(L, "lvgl scroll snapshot '%s' must contain 1..%d objects",
                   field, LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX);
    }
    for (size_t i = 0; i < count; i++) {
        lua_rawgeti(L, -1, (lua_Integer)i + 1);
        out[i] = lua_lvgl_check_ud(L, -1);
        lua_pop(L, 1);
    }
    lua_pop(L, 1);
    return count;
}

typedef struct {
    lua_lvgl_obj_ud_t *indicators[LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX];
    lua_lvgl_obj_ud_t *pager;
    size_t count;
    int32_t hit_width;
    int32_t idle_width;
    int32_t active_width;
    int32_t height;
    lv_color_t active_color;
    lv_color_t idle_color;
} lua_lvgl_scroll_snapshot_indicator_opts_t;

static int32_t lua_lvgl_read_positive_int_field(lua_State *L, int table_index,
                                                 const char *field)
{
    lua_Integer value;

    lua_getfield(L, table_index, field);
    value = luaL_checkinteger(L, -1);
    lua_pop(L, 1);
    if (value <= 0 || value > INT32_MAX) {
        luaL_error(L, "lvgl scroll snapshot page_indicators.%s must be a positive int32", field);
    }
    return (int32_t)value;
}

/* The marker block is optional so existing snapshot users keep their current
 * behaviour. When present it must match the page count exactly: the native
 * scroll callback never needs to enter Lua to map a bitmap offset to a dot. */
static bool lua_lvgl_read_scroll_snapshot_indicators(lua_State *L, int opts_index,
                                                      size_t expected_count,
                                                      lua_lvgl_scroll_snapshot_indicator_opts_t *out)
{
    int indicators_index;

    memset(out, 0, sizeof(*out));
    lua_getfield(L, opts_index, "page_indicators");
    if (lua_isnil(L, -1)) {
        lua_pop(L, 1);
        return false;
    }
    luaL_checktype(L, -1, LUA_TTABLE);
    indicators_index = lua_gettop(L);
    lua_getfield(L, indicators_index, "dots");
    luaL_checktype(L, -1, LUA_TTABLE);
    out->count = lua_rawlen(L, -1);
    if (out->count != expected_count || out->count == 0 ||
            out->count > LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX) {
        luaL_error(L, "lvgl scroll snapshot page_indicators.dots must match page count");
    }
    for (size_t i = 0; i < out->count; i++) {
        lua_rawgeti(L, -1, (lua_Integer)i + 1);
        out->indicators[i] = lua_lvgl_check_ud(L, -1);
        lua_pop(L, 1);
    }
    lua_pop(L, 1);
    lua_getfield(L, indicators_index, "pager");
    out->pager = lua_lvgl_check_ud(L, -1);
    lua_pop(L, 1);
    out->hit_width = lua_lvgl_read_positive_int_field(L, indicators_index, "hit_width");
    out->idle_width = lua_lvgl_read_positive_int_field(L, indicators_index, "idle_width");
    out->active_width = lua_lvgl_read_positive_int_field(L, indicators_index, "active_width");
    out->height = lua_lvgl_read_positive_int_field(L, indicators_index, "height");
    lua_getfield(L, indicators_index, "active_color");
    if (lua_lvgl_parse_color(L, -1, &out->active_color) != ESP_OK) {
        luaL_error(L, "lvgl scroll snapshot page_indicators.active_color is invalid");
    }
    lua_pop(L, 1);
    lua_getfield(L, indicators_index, "idle_color");
    if (lua_lvgl_parse_color(L, -1, &out->idle_color) != ESP_OK) {
        luaL_error(L, "lvgl scroll snapshot page_indicators.idle_color is invalid");
    }
    lua_pop(L, 1);
    lua_pop(L, 1);
    return true;
}

int lua_lvgl_set_flex(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lv_flex_flow_t flow;
    lv_flex_align_t main_align;
    lv_flex_align_t cross_align;
    lv_flex_align_t track_align;
    const char *flow_text;
    const char *main_text;
    const char *cross_text;
    const char *track_text;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_checktype(L, 2, LUA_TTABLE);
    flow_text = lua_lvgl_get_opt_string_field(L, 2, "flow");
    main_text = lua_lvgl_get_opt_string_field(L, 2, "main");
    cross_text = lua_lvgl_get_opt_string_field(L, 2, "cross");
    track_text = lua_lvgl_get_opt_string_field(L, 2, "track");
    if (lua_lvgl_parse_flex_flow(flow_text, &flow) != ESP_OK ||
            lua_lvgl_parse_flex_align(main_text, &main_align) != ESP_OK ||
            lua_lvgl_parse_flex_align(cross_text, &cross_align) != ESP_OK ||
            lua_lvgl_parse_flex_align(track_text, &track_align) != ESP_OK) {
        return luaL_error(L, "lvgl flex option is invalid");
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
    lv_obj_set_flex_flow(obj, flow);
    lv_obj_set_flex_align(obj, main_align, cross_align, track_align);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_grid(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int32_t *cols;
    int32_t *rows;
    lv_grid_align_t col_align;
    lv_grid_align_t row_align;
    const char *col_align_text;
    const char *row_align_text;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_checktype(L, 2, LUA_TTABLE);
    cols = lua_lvgl_build_grid_tracks(L, 2, "cols");
    rows = lua_lvgl_build_grid_tracks(L, 2, "rows");
    col_align_text = lua_lvgl_get_opt_string_field(L, 2, "col_align");
    row_align_text = lua_lvgl_get_opt_string_field(L, 2, "row_align");
    if (lua_lvgl_parse_grid_align(col_align_text, &col_align) != ESP_OK ||
            lua_lvgl_parse_grid_align(row_align_text, &row_align) != ESP_OK) {
        free(cols);
        free(rows);
        return luaL_error(L, "lvgl grid align option is invalid");
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        free(cols);
        free(rows);
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        free(cols);
        free(rows);
        return luaL_error(L, "%s", obj_error);
    }
    free(ud->record->grid_cols);
    free(ud->record->grid_rows);
    ud->record->grid_cols = cols;
    ud->record->grid_rows = rows;
    lv_obj_set_grid_dsc_array(obj, cols, rows);
    lv_obj_set_grid_align(obj, col_align, row_align);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_grid_cell(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int col;
    int row;
    int col_span;
    int row_span;
    lv_grid_align_t col_align;
    lv_grid_align_t row_align;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_checktype(L, 2, LUA_TTABLE);
    col = lua_lvgl_get_opt_int_field(L, 2, "col", 1);
    row = lua_lvgl_get_opt_int_field(L, 2, "row", 1);
    col_span = lua_lvgl_get_opt_int_field(L, 2, "col_span", 1);
    row_span = lua_lvgl_get_opt_int_field(L, 2, "row_span", 1);
    if (col < 1 || row < 1 || col_span < 1 || row_span < 1 ||
            lua_lvgl_parse_grid_align(lua_lvgl_get_opt_string_field(L, 2, "col_align"), &col_align) != ESP_OK ||
            lua_lvgl_parse_grid_align(lua_lvgl_get_opt_string_field(L, 2, "row_align"), &row_align) != ESP_OK) {
        return luaL_error(L, "lvgl grid cell option is invalid");
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
    lv_obj_set_grid_cell(obj, col_align, col - 1, col_span, row_align, row - 1, row_span);
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_set_scroll(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lv_dir_t dir;
    lv_scrollbar_mode_t scrollbar;
    lv_scroll_snap_t snap_x;
    lv_scroll_snap_t snap_y;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;
    int elastic = -1;
    int momentum = -1;
    int scroll_one = -1;
    int snap_anim_ms = -1;

    luaL_checktype(L, 2, LUA_TTABLE);
    if (lua_lvgl_parse_dir(lua_lvgl_get_opt_string_field(L, 2, "dir"), &dir) != ESP_OK ||
            lua_lvgl_parse_scrollbar(lua_lvgl_get_opt_string_field(L, 2, "scrollbar"), &scrollbar) != ESP_OK ||
            lua_lvgl_parse_scroll_snap(lua_lvgl_get_opt_string_field(L, 2, "snap_x"), &snap_x) != ESP_OK ||
            lua_lvgl_parse_scroll_snap(lua_lvgl_get_opt_string_field(L, 2, "snap_y"), &snap_y) != ESP_OK) {
        return luaL_error(L, "lvgl scroll option is invalid");
    }
    /* Optional physics knobs: elastic overscroll + throw/momentum coast. */
    lua_getfield(L, 2, "elastic");
    if (!lua_isnil(L, -1)) {
        elastic = lua_toboolean(L, -1) ? 1 : 0;
    }
    lua_pop(L, 1);
    lua_getfield(L, 2, "momentum");
    if (!lua_isnil(L, -1)) {
        momentum = lua_toboolean(L, -1) ? 1 : 0;
    }
    lua_pop(L, 1);
    lua_getfield(L, 2, "scroll_one");
    if (!lua_isnil(L, -1)) {
        scroll_one = lua_toboolean(L, -1) ? 1 : 0;
    }
    lua_pop(L, 1);
    lua_getfield(L, 2, "snap_anim_ms");
    if (!lua_isnil(L, -1)) {
        snap_anim_ms = (int)luaL_checkinteger(L, -1);
        if (snap_anim_ms < 0 || snap_anim_ms > UINT16_MAX) {
            lua_pop(L, 1);
            return luaL_error(L, "lvgl scroll snap animation duration is invalid");
        }
    }
    lua_pop(L, 1);

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    lv_obj_set_scroll_dir(obj, dir);
    lv_obj_set_scrollbar_mode(obj, scrollbar);
    /* LVGL toggles LV_STATE_SCROLLED for every scroll gesture even when the
     * scrollbar is disabled. The default theme still contributes a
     * SCROLLED-only scrollbar style, so that otherwise-invisible state change
     * takes the LV_STYLE_PROP_ANY path and recursively refreshes every child.
     * A pager can contain a full live page tree below its bitmap surface; do
     * not make that tree layout-dirty solely for an off-screen scrollbar. */
    if (scrollbar == LV_SCROLLBAR_MODE_OFF) {
        lv_obj_remove_theme(obj, LV_PART_SCROLLBAR | LV_STATE_SCROLLED);
    }
    lv_obj_set_scroll_snap_x(obj, snap_x);
    lv_obj_set_scroll_snap_y(obj, snap_y);
    if (dir == LV_DIR_NONE) {
        lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    } else {
        lv_obj_add_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    }
    if (elastic >= 0) {
        if (elastic) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_SCROLL_ELASTIC);
        } else {
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLL_ELASTIC);
        }
    }
    if (momentum >= 0) {
        if (momentum) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_SCROLL_MOMENTUM);
        } else {
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLL_MOMENTUM);
        }
    }
    if (scroll_one >= 0) {
        if (scroll_one) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_SCROLL_ONE);
        } else {
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLL_ONE);
        }
    }
    if (snap_anim_ms >= 0) {
        ud->record->scroll_snap_anim_ms = (uint16_t)snap_anim_ms;
        if (!ud->record->scroll_snap_anim_hooked) {
            lv_obj_add_event_cb(obj, lua_lvgl_scroll_begin_cb, LV_EVENT_SCROLL_BEGIN, ud->record);
            ud->record->scroll_snap_anim_hooked = true;
        }
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

/* obj:set_scroll_snapshot_layers({ live = {...}, snapshots = {...},
 *                                  overlays = {...}, page_width = N,
 *                                  page_indicators = { ... } })
 *
 * Keeps matching pre-rendered image layers available for active scrolling.
 * At rest the selected live tree renders above its cache so time-dependent
 * widgets remain correct; native SCROLL_BEGIN flips to the bitmap plus small
 * moving dynamic overlay before the first raw delta and final SCROLL_END
 * restores the live view. The binding stores records rather than raw objects
 * so a later child deletion degrades safely instead of retaining a dangling
 * lv_obj_t pointer. */
int lua_lvgl_set_scroll_snapshot_layers(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    lua_lvgl_obj_ud_t *live_uds[LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX] = {0};
    lua_lvgl_obj_ud_t *image_uds[LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX] = {0};
    lua_lvgl_obj_ud_t *overlay_uds[LUA_LVGL_SCROLL_SNAPSHOT_LAYER_MAX] = {0};
    lua_lvgl_scroll_snapshot_indicator_opts_t indicator_opts;
    lua_Integer page_width;
    size_t live_count;
    size_t image_count;
    size_t overlay_count;
    bool has_indicators;
    esp_err_t err;
    lv_obj_t *obj;
    const char *obj_error = NULL;

    luaL_checktype(L, 2, LUA_TTABLE);
    live_count = lua_lvgl_read_scroll_snapshot_layer(L, 2, "live", live_uds);
    image_count = lua_lvgl_read_scroll_snapshot_layer(L, 2, "snapshots", image_uds);
    overlay_count = lua_lvgl_read_scroll_snapshot_layer(L, 2, "overlays", overlay_uds);
    lua_getfield(L, 2, "page_width");
    page_width = luaL_checkinteger(L, -1);
    lua_pop(L, 1);
    if (live_count != image_count || live_count != overlay_count) {
        return luaL_error(L, "lvgl scroll snapshot live, snapshots, and overlays counts must match");
    }
    if (page_width <= 0 || page_width > INT32_MAX) {
        return luaL_error(L, "lvgl scroll snapshot page_width must be a positive int32");
    }
    has_indicators = lua_lvgl_read_scroll_snapshot_indicators(L, 2, live_count,
                                                               &indicator_opts);
    if (has_indicators && (indicator_opts.active_width < indicator_opts.idle_width ||
            indicator_opts.hit_width < indicator_opts.active_width)) {
        return luaL_error(L, "lvgl scroll snapshot page_indicators widths are invalid");
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
    for (size_t i = 0; i < live_count; i++) {
        if (!lua_lvgl_validate_ud_locked(live_uds[i], NULL, &obj_error) ||
                !lua_lvgl_validate_ud_locked(image_uds[i], NULL, &obj_error) ||
                !lua_lvgl_validate_ud_locked(overlay_uds[i], NULL, &obj_error)) {
            lua_lvgl_unlock();
            return luaL_error(L, "%s", obj_error);
        }
        if (live_uds[i]->record == image_uds[i]->record ||
                live_uds[i]->record == overlay_uds[i]->record ||
                image_uds[i]->record == overlay_uds[i]->record) {
            lua_lvgl_unlock();
            return luaL_error(L, "lvgl scroll snapshot layers must be distinct");
        }
    }
    if (has_indicators) {
        if (!lua_lvgl_validate_ud_locked(indicator_opts.pager, NULL, &obj_error)) {
            lua_lvgl_unlock();
            return luaL_error(L, "%s", obj_error);
        }
        for (size_t i = 0; i < indicator_opts.count; i++) {
            if (!lua_lvgl_validate_ud_locked(indicator_opts.indicators[i], NULL, &obj_error)) {
                lua_lvgl_unlock();
                return luaL_error(L, "%s", obj_error);
            }
        }
    }

    if (ud->record->scroll_snapshot_active) {
        lua_lvgl_set_scroll_snapshot_idle_layers(ud->record);
    }
    memset(ud->record->scroll_snapshot_live, 0, sizeof(ud->record->scroll_snapshot_live));
    memset(ud->record->scroll_snapshot_images, 0, sizeof(ud->record->scroll_snapshot_images));
    memset(ud->record->scroll_snapshot_overlays, 0, sizeof(ud->record->scroll_snapshot_overlays));
    memset(ud->record->scroll_snapshot_indicators, 0,
           sizeof(ud->record->scroll_snapshot_indicators));
    memset(ud->record->scroll_snapshot_indicator_intensity, 0xff,
           sizeof(ud->record->scroll_snapshot_indicator_intensity));
    ud->record->scroll_snapshot_indicator_pager = NULL;
    ud->record->scroll_snapshot_indicator_count = 0;
    for (size_t i = 0; i < live_count; i++) {
        ud->record->scroll_snapshot_live[i] = live_uds[i]->record;
        ud->record->scroll_snapshot_images[i] = image_uds[i]->record;
        ud->record->scroll_snapshot_overlays[i] = overlay_uds[i]->record;
    }
    ud->record->scroll_snapshot_layer_count = (uint8_t)live_count;
    ud->record->scroll_snapshot_page_width = (int32_t)page_width;
    ud->record->scroll_snapshot_active = false;
    ud->record->scroll_snapshot_snap_active = false;
    ud->record->scroll_snapshot_restarting = false;
    ud->record->scroll_snapshot_replacement_pending = false;
    if (has_indicators) {
        for (size_t i = 0; i < indicator_opts.count; i++) {
            ud->record->scroll_snapshot_indicators[i] = indicator_opts.indicators[i]->record;
        }
        ud->record->scroll_snapshot_indicator_pager = indicator_opts.pager->record;
        ud->record->scroll_snapshot_indicator_count = (uint8_t)indicator_opts.count;
        ud->record->scroll_snapshot_indicator_hit_width = indicator_opts.hit_width;
        ud->record->scroll_snapshot_indicator_idle_width = indicator_opts.idle_width;
        ud->record->scroll_snapshot_indicator_active_width = indicator_opts.active_width;
        ud->record->scroll_snapshot_indicator_height = indicator_opts.height;
        ud->record->scroll_snapshot_indicator_active_color = indicator_opts.active_color;
        ud->record->scroll_snapshot_indicator_idle_color = indicator_opts.idle_color;
    }
    /* Enter the live-first idle state before the home screen becomes visible.
     * A failed setup never reaches this point, so its live fallback remains
     * intact. */
    lua_lvgl_set_scroll_snapshot_idle_layers(ud->record);
    lua_lvgl_update_scroll_snapshot_indicators(ud->record);
    if (!ud->record->scroll_snapshot_hooked) {
        lv_obj_add_event_cb(obj, lua_lvgl_scroll_snapshot_cb, LV_EVENT_SCROLL_BEGIN, ud->record);
        lv_obj_add_event_cb(obj, lua_lvgl_scroll_snapshot_cb, LV_EVENT_SCROLL, ud->record);
        lv_obj_add_event_cb(obj, lua_lvgl_scroll_snapshot_cb, LV_EVENT_SCROLL_END, ud->record);
        ud->record->scroll_snapshot_hooked = true;
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

int lua_lvgl_get_scroll(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;
    int32_t x;
    int32_t y;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    x = lv_obj_get_scroll_x(obj);
    y = lv_obj_get_scroll_y(obj);
    lua_lvgl_unlock();
    lua_pushinteger(L, x);
    lua_pushinteger(L, y);
    return 2;
}

int lua_lvgl_scroll_to(lua_State *L)
{
    lua_lvgl_obj_ud_t *ud = lua_lvgl_check_ud(L, 1);
    int32_t x = (int32_t)luaL_checkinteger(L, 2);
    int32_t y = (int32_t)luaL_checkinteger(L, 3);
    bool anim = lua_isnoneornil(L, 4) ? true : lua_toboolean(L, 4);
    esp_err_t err = lua_lvgl_lock();
    lv_obj_t *obj;
    const char *obj_error = NULL;
    bool replacement_prepared;

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    obj = lua_lvgl_validate_ud_locked(ud, NULL, &obj_error);
    if (!obj) {
        lua_lvgl_unlock();
        return luaL_error(L, "%s", obj_error);
    }
    replacement_prepared = lua_lvgl_prepare_scroll_snapshot_replacement(
        ud->record, obj, x, y, anim);
    lv_obj_scroll_to(obj, x, y, anim ? LV_ANIM_ON : LV_ANIM_OFF);
    if (replacement_prepared && !lv_obj_is_scrolling(obj)) {
        /* Bounded scrolling can reject a request with no replacement BEGIN.
         * The old end was intentionally swallowed, so explicitly finish this
         * no-op transition and deliver its one final Lua scroll-end event. */
        lua_lvgl_finish_scroll_snapshot(ud->record);
        lv_obj_send_event(obj, LV_EVENT_SCROLL_END, NULL);
    }
    lua_lvgl_unlock();
    lua_pushboolean(L, 1);
    return 1;
}

/* Layout helpers are exposed via the base method table in
 * lua_lvgl_methods.c. */
