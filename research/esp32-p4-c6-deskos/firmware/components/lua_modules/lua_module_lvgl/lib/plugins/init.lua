--
-- plugins/init.lua -- Builtin Plugins Auto-Loader & Registry Bootstrapper
--
local plugin_registry = require("core.plugin_registry")

local M = {}

local BUILTIN_PLUGINS = {
    "plugins.clock",
    "plugins.calendar",
    "plugins.pomodoro",
    "plugins.quota",
    "plugins.year",
    "plugins.almanac",
    "plugins.settings",
    "plugins.chat",
    "plugins.dice",
    "plugins.breath",
    "plugins.hydrate",
    "plugins.mantra",
    "plugins.stars",
}

function M.load_all()
    for _, mod_name in ipairs(BUILTIN_PLUGINS) do
        print("[plugins.init] loading " .. mod_name)
        local ok, plugin = pcall(require, mod_name)
        if ok and type(plugin) == "table" then
            plugin_registry.register(plugin)
        else
            print("[plugins.init] Failed to load plugin " .. mod_name .. ": " .. tostring(plugin))
        end
    end
end

return M
