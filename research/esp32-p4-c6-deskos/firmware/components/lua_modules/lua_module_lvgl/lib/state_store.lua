-- state_store -- the Shell-owned source of truth for App data.
--
-- Namespaces live for the lifetime of the Shell Lua state.  Stopping an App
-- destroys its widgets and runtime callbacks, but never destroys this data.
-- Values are deliberately accessed through get/set so an App cannot replace
-- the namespace table or accidentally create a second source of truth.

local M = {}
local namespaces = {}
local handles = {}

local function valid_name(name)
    return type(name) == "string" and name ~= ""
end

local function namespace(app_id)
    if not valid_name(app_id) then
        error("state_store: app_id must be a non-empty string", 2)
    end

    local data = namespaces[app_id]
    if not data then
        data = { values = {}, version = 0 }
        namespaces[app_id] = data
    end

    local methods = {}
    function methods:get(key, default)
        local value = data.values[key]
        if value == nil then
            return default
        end
        return value
    end
    function methods:set(key, value)
        if type(key) ~= "string" or key == "" then
            error("state_store: key must be a non-empty string", 2)
        end
        data.values[key] = value
        data.version = data.version + 1
        return value
    end
    function methods:delete(key)
        if data.values[key] ~= nil then
            data.values[key] = nil
            data.version = data.version + 1
        end
    end
    function methods:version()
        return data.version
    end
    local store = setmetatable({}, {
        __index = function(_, key)
            local method = methods[key]
            if method ~= nil then
                return method
            end
            return data.values[key]
        end,
        __newindex = function(_, key, value)
            methods:set(key, value)
        end,
    })
    return store
end

function M.namespace(app_id)
    if not handles[app_id] then
        handles[app_id] = namespace(app_id)
    end
    return handles[app_id]
end

function M.reset()
    namespaces = {}
    handles = {}
end

return M
