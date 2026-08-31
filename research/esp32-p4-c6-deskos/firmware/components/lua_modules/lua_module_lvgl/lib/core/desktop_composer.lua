--
-- core/desktop_composer.lua -- Declarative Desktop Layout Composer
--
-- Parses declarative layout specs (e.g. config/desktop_layout.lua), builds
-- pages (Dashboard, Multi-size Widget Grids), and manages page-scoped tick dispatching.
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local widget_engine = require("core.widget_engine")
local dashboard_engine = require("core.dashboard_engine")
local plugin_registry = require("core.plugin_registry")

local M = {}

local NO_SCROLL = { dir = "none", scrollbar = "off" }

--- Compose the entire desktop from a layout specification array.
-- @param pages_list table: Array of LVGL page slot containers from pager.create()
-- @param layout_spec table: Array of page definitions from config/desktop_layout.lua
-- @param host_ctx table: Host context { invalidate_snapshot, grid_metrics }
-- @return table: { page_entries = { [1..N] = { type, widgets, on_tick } }, on_tick = function(cur_page) }
function M.compose(pages_list, layout_spec, host_ctx)
    local g = host_ctx and host_ctx.grid_metrics or aiodi.grid_metrics()
    local page_entries = {}

    for i, page_spec in ipairs(layout_spec) do
        local page_obj = pages_list[i]
        if not page_obj then
            break
        end

        local entry = {
            type = page_spec.type or "grid",
            title = page_spec.title or ("Page " .. i),
            widgets = {},
            on_tick = nil,
        }

        if entry.type == "dashboard" then
            -- 1. Dashboard Narrative Flow Page (Full width)
            local dash_res = dashboard_engine.render_page(page_obj, g, host_ctx)
            if dash_res then
                entry.on_tick = dash_res.on_tick
            end

        elseif entry.type == "grid" then
            -- 2. Widget Grid Page (Multi-size widgets placed on aiodi.grid)
            local grid = aiodi.grid(page_obj, g)

            for _, item in ipairs(page_spec.items or {}) do
                local w_instance = widget_engine.create_widget(grid, item, {
                    grid_metrics = g,
                    invalidate_snapshot = host_ctx and host_ctx.invalidate_snapshot,
                })

                if w_instance then
                    if w_instance.root and type(w_instance.on_click) == "function" then
                        w_instance.root:set_clickable(true)
                        w_instance.root:on("clicked", function()
                            w_instance.on_click(host_ctx)
                        end)
                    end
                    table.insert(entry.widgets, w_instance)
                end
            end

            -- Page tick dispatches to all mounted widgets on this grid
            -- Reuse a single tick-context table per tick (no per-widget
            -- allocation in the 60 FPS hot path).
            entry.on_tick = function(now)
                local tick_ctx = { now = now, host_ctx = host_ctx }
                for _, w in ipairs(entry.widgets) do
                    if type(w.on_tick) == "function" then
                        pcall(w.on_tick, tick_ctx)
                    end
                end
            end
        end

        page_entries[i] = entry
    end

    local composer_instance = {
        page_entries = page_entries,
        on_tick = function(current_page, now)
            local active_entry = page_entries[current_page]
            if active_entry and type(active_entry.on_tick) == "function" then
                pcall(active_entry.on_tick, now)
            end
        end,
    }

    return composer_instance
end

return M
