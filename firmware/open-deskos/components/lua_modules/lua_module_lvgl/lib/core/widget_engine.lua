--
-- core/widget_engine.lua -- Open DeskOS Widget Layout, Sizing & Lifecycle Engine
--
-- Calculates grid geometry and instantiates multi-size widgets using AIODI grid
-- tiles. Enforces grid cell positioning at the harness level so widgets are never
-- stacked at (0, 0).
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local state_store = require("state_store")
local plugin_registry = require("core.plugin_registry")

local M = {}

local NO_SCROLL = { dir = "none", scrollbar = "off" }

--- Parse size string like "2x1", "2x2", "1x1", "3x4" into col_span and row_span.
-- @param size string
-- @return integer, integer (col_span, row_span)
function M.parse_size(size)
    if type(size) ~= "string" then
        return 1, 1
    end
    local c, r = size:match("^(%d+)x(%d+)$")
    if c and r then
        return tonumber(c) or 1, tonumber(r) or 1
    end
    return 1, 1
end

--- Calculate pixel bounds for a grid tile given grid metrics, col, row, and spans.
-- @param g table: Grid metrics from aiodi.grid_metrics()
-- @param col integer: 1-indexed column (1..cols)
-- @param row integer: 1-indexed row (1..rows)
-- @param col_span integer: Number of columns to span (default 1)
-- @param row_span integer: Number of rows to span (default 1)
-- @return table: { x = px, y = px, w = px, h = px, col = col, row = row, col_span = col_span, row_span = row_span }
function M.calculate_rect(g, col, row, col_span, row_span)
    g = g or aiodi.grid_metrics()
    col = col or 1
    row = row or 1
    col_span = col_span or 1
    row_span = row_span or 1

    local cell = g.cell
    local gutter = g.gutter

    -- In-grid relative coordinates (top-left of grid is 0, 0)
    local x = (col - 1) * (cell + gutter)
    local y = (row - 1) * (cell + gutter)
    local w = col_span * cell + (col_span - 1) * gutter
    local h = row_span * cell + (row_span - 1) * gutter

    return {
        x = math.floor(x),
        y = math.floor(y),
        w = math.floor(w),
        h = math.floor(h),
        col = col,
        row = row,
        col_span = col_span,
        row_span = row_span,
    }
end

--- Instantiate a widget inside parent grid container.
-- @param grid_parent lvgl_obj: Parent aiodi.grid LVGL container
-- @param item table: { plugin = "id", widget = "size", col = 1, row = 1, col_span = 2, row_span = 1, opts = {} }
-- @param host_ctx table: Host context with callbacks (invalidate_snapshot, etc.)
-- @return table|nil: Standard widget instance { root, on_tick, on_click, destroy, source_rect, plugin_id }
function M.create_widget(grid_parent, item, host_ctx)
    if not grid_parent or not item or not item.plugin then
        return nil
    end

    local g = host_ctx and host_ctx.grid_metrics or aiodi.grid_metrics()
    local col = item.col or 1
    local row = item.row or 1
    local size_str = item.widget or "1x1"
    local c_span, r_span = M.parse_size(size_str)
    c_span = item.col_span or c_span
    r_span = item.row_span or r_span

    local rect = M.calculate_rect(g, col, row, c_span, r_span)
    local plugin_id = item.plugin
    local plugin = plugin_registry.get(plugin_id)

    if not plugin then
        -- Fallback tile if plugin is not found
        local tile = aiodi.tile(grid_parent, {
            col = col, row = row, col_span = c_span, row_span = r_span,
            bg_color = aiodi.colors.surface,
            pad = 0,
        })
        aiodi.label(tile, {
            text = plugin_id .. "\n(missing)",
            font = aiodi.font(aiodi.px(16)),
            color = aiodi.colors.secondary,
            align = "center",
        })
        return {
            root = tile,
            source_rect = rect,
            plugin_id = plugin_id,
        }
    end

    local builder = plugin_registry.get_widget(plugin_id, size_str)
    if not builder then
        -- Default generic tile
        local tile = aiodi.tile(grid_parent, {
            col = col, row = row, col_span = c_span, row_span = r_span,
            bg_color = plugin.manifest.accent or aiodi.colors.surface,
            pad = 0,
        })
        local icon_size = math.floor(math.min(rect.w, rect.h) * 0.5)
        aiodi.icon_label(tile, {
            name = plugin.manifest.icon or "star",
            size = icon_size,
            color = aiodi.colors.primary,
            align = "center",
        })
        return {
            root = tile,
            source_rect = rect,
            plugin_id = plugin_id,
        }
    end

    -- Construct widget context
    local state = state_store.namespace(plugin_id)
    local widget_ctx = {
        plugin_id = plugin_id,
        manifest = plugin.manifest,
        state = state,
        size = size_str,
        col = col,
        row = row,
        col_span = c_span,
        row_span = r_span,
        w = rect.w,
        h = rect.h,
        x = rect.x,
        y = rect.y,
        grid_metrics = g,
        invalidate_snapshot = function()
            if host_ctx and host_ctx.invalidate_snapshot then
                host_ctx.invalidate_snapshot()
            end
        end,
    }

    local spec = {
        x = rect.x,
        y = rect.y,
        w = rect.w,
        h = rect.h,
        col = col,
        row = row,
        col_span = c_span,
        row_span = r_span,
        size = size_str,
        opts = item.opts or {},
    }

    local ok, res = pcall(builder, grid_parent, spec, widget_ctx)
    if not ok then
        print("[widget_engine] Error creating widget " .. plugin_id .. ":" .. size_str .. " -> " .. tostring(res))
        local err_tile = aiodi.tile(grid_parent, {
            col = col, row = row, col_span = c_span, row_span = r_span,
            bg_color = aiodi.colors.red,
            pad = aiodi.space.sm,
        })
        aiodi.label(err_tile, {
            text = plugin_id .. "\nerror",
            font = aiodi.font(aiodi.px(16)),
            color = aiodi.colors.primary,
            align = "center",
        })
        return {
            root = err_tile,
            source_rect = rect,
            plugin_id = plugin_id,
        }
    end

    -- Normalize result into standard widget instance table
    local instance = {}
    if type(res) == "table" then
        instance = res
        instance.root = res.root or grid_parent
    else
        instance.root = grid_parent
    end

    -- Harness level enforcement: ensure LVGL grid cell parameters are strictly set
    if instance.root and instance.root ~= grid_parent then
        if type(instance.root.set_grid_cell) == "function" then
            pcall(function()
                instance.root:set_grid_cell({
                    col = col,
                    row = row,
                    col_span = c_span,
                    row_span = r_span,
                })
            end)
        end
        instance.root:set_scroll(NO_SCROLL)
    end

    instance.plugin_id = plugin_id
    instance.source_rect = rect

    return instance
end

return M
