--
-- core/plugin_registry.lua -- Open DeskOS OS Plugin & Extension Registry
--
-- Manages the lifecycle, registration, discovery, and capability lookup
-- for all plugins (builtin, AI-generated, and third-party extensions).
--
local state_store = require("state_store")

local M = {}

local plugins = {}
local plugin_order = {}
local dashboard_providers = {}

--- Register a plugin in the system catalog.
-- @param spec table: Plugin definition table
--   - manifest: { id, name, icon, accent, desc, category }
--   - state_defaults: optional table of initial state values
--   - widgets: optional table of size-to-builder functions { ["1x1"] = fn, ["2x1"] = fn, ... }
--   - dashboard: optional table with metric_key, get_value(state, now), icon
function M.register(spec)
    if type(spec) ~= "table" then
        error("plugin_registry.register: spec must be a table")
    end

    local manifest = spec.manifest or {}
    local id = manifest.id or spec.id
    if not id or type(id) ~= "string" or id == "" then
        error("plugin_registry.register: plugin must have a valid string id")
    end

    local plugin_entry = {
        id = id,
        manifest = {
            id = id,
            name = manifest.name or spec.name or id,
            icon = manifest.icon or spec.icon or "star",
            accent = manifest.accent or spec.accent,
            desc = manifest.desc or spec.desc or "",
            category = manifest.category or spec.category or "general",
            version = manifest.version or "1.0.0",
        },
        state_defaults = spec.state_defaults or {},
        widgets = spec.widgets or {},
        dashboard = spec.dashboard or nil,
        raw = spec,
    }

    -- Seed state defaults into state_store if not already set
    if plugin_entry.state_defaults then
        local ns = state_store.namespace(id)
        for k, v in pairs(plugin_entry.state_defaults) do
            if ns[k] == nil then
                ns[k] = v
            end
        end
    end

    if not plugins[id] then
        table.insert(plugin_order, id)
    end
    plugins[id] = plugin_entry

    if plugin_entry.dashboard then
        dashboard_providers[id] = plugin_entry.dashboard
    else
        dashboard_providers[id] = nil
    end

    return plugin_entry
end

--- Get a registered plugin by ID.
function M.get(id)
    if not id then return nil end
    return plugins[id]
end

--- List all registered plugins in registration order.
function M.list()
    local result = {}
    for _, id in ipairs(plugin_order) do
        table.insert(result, plugins[id])
    end
    return result
end

--- Get a widget builder for a specific plugin and size.
-- @param id string: Plugin ID
-- @param size string: Desired size ("1x1", "2x1", "1x2", "2x2", "3x1", "3x2", "3x4")
-- @return function|nil: Widget constructor function(parent, spec, ctx)
function M.get_widget(id, size)
    local plugin = plugins[id]
    if not plugin or not plugin.widgets then
        return nil
    end

    -- 1. Exact match
    if type(plugin.widgets[size]) == "function" then
        return plugin.widgets[size]
    end

    -- 2. Fallbacks
    if type(plugin.widgets["1x1"]) == "function" then
        return plugin.widgets["1x1"]
    end

    -- 3. First available widget builder
    for _, builder in pairs(plugin.widgets) do
        if type(builder) == "function" then
            return builder
        end
    end

    return nil
end

--- Get all dashboard providers.
function M.get_dashboard_providers()
    return dashboard_providers
end

--- Unregister a plugin (for dynamic reload / hot-swapping).
function M.unregister(id)
    if not id or not plugins[id] then return false end
    plugins[id] = nil
    dashboard_providers[id] = nil
    for i, pid in ipairs(plugin_order) do
        if pid == id then
            table.remove(plugin_order, i)
            break
        end
    end
    return true
end

--- Clear all registered plugins.
function M.clear()
    plugins = {}
    plugin_order = {}
    dashboard_providers = {}
end

return M
