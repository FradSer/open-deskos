# state_store

Shell-owned namespaced state for App data shared by Home, peek, and the
fullscreen App. A namespace survives App stop and is released only when the
Shell Lua state exits.

```lua
local store = require("state_store")
local state = store.namespace("pomodoro")
state:set("remaining", 1500)
local remaining = state:get("remaining", 0)
state:delete("remaining")
```

Apps must use `get` and `set`; they must not retain or mutate an internal table
outside the namespace interface. Values are Lua values owned by the Shell
state and are not automatically persisted to flash.
