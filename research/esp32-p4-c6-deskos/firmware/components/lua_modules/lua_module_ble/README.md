# Lua Network and capability API

This is the preserved research API. Read the applicable section before you call a module. Load its listed Lua name with require(). Use documented options. Release handles when the section requires cleanup. Test hardware operations only in an authorized device task.

## Contents

- [lua_module_ble/README.md](#lua-module-ble-readme)
- [lua_module_ble_hid/README.md](#lua-module-ble-hid-readme)
- [lua_module_ble_hid/lib/ble_hid_actions.md](#lua-module-ble-hid-lib-ble-hid-actions)
- [lua_module_call_capability/README.md](#lua-module-call-capability-readme)
- [lua_module_event_publisher/README.md](#lua-module-event-publisher-readme)
- [lua_module_http_server/README.md](#lua-module-http-server-readme)

<!-- doc: lua_module_ble/README.md -->
<a id="lua-module-ble-readme"></a>

## Lua BLE

This document is written for LLMs and Lua script generation. It explains how
to use the `ble` module exposed by `components/lua_modules/lua_module_ble` for
ordinary BLE Peripheral advertising and GATT Server tasks.

### When To Use

- Use this module for normal BLE advertising, GATT service discovery,
  characteristic read/write, notify, and indicate.
- Use `lua_module_ble_hid` only when the user explicitly asks for HID keyboard,
  mouse, media keys, typing, key combos, cursor movement, clicking, or scrolling.
- Do not use `ble_hid` as a fallback for ordinary BLE advertising or GATT tasks.

### Core Rules

- Import the module with `local ble = require("ble")`.
- `lua_module_ble` and `lua_module_ble_hid` must not advertise at the same time.
- To switch from ordinary BLE to HID, call `ble.adv_stop()` then `ble.deinit()`
  before starting `lua_module_ble_hid`.
- To switch from HID to ordinary BLE, stop and deinitialize `lua_module_ble_hid`
  before calling `ble.init()` / `ble.adv_start(...)`.
- Call `ble.smp_config(opts)` before `ble.init()` when custom security is needed.
- Call `ble.init()` before setting name, MTU, GATT, advertising, events, or stats.
- Register events with `ble.on_event(fn)`, then call `ble.process_events(...)`
  in a loop; otherwise Lua callbacks will not run.
- Define a GATT profile once with `ble.gatts_define(profile)`. Hot modification
  is not supported; call `ble.deinit()` before defining a different profile.
- Use stable `conn_index` values `0..2` for peer operations. `conn_handle` is
  diagnostic only.
- Call `ble.notify()` or `ble.indicate()` only after a peer connects and
  subscribes to the characteristic.
- Unsupported: scanning, observer mode, Central mode, GATT Client, extended
  advertising, passkey / numeric-comparison Lua callbacks, and Lua
  bond-management APIs.

### How To Call

- `ble.smp_config(opts)`: configure security before `ble.init()`.
- `ble.init()`: start the BLE controller and NimBLE host. Idempotent.
- `ble.deinit()`: stop advertising, disconnect peers, drain events, and release
  this module's BLE state. Idempotent.
- `ble.set_name(name)`: set the GAP device name. `name` must be 28 bytes or less.
- `ble.set_max_mtu(mtu)`: set preferred ATT MTU from `23..517` before connections.
- `ble.gatts_define(profile)`: define and activate a dynamic GATT Server.
- `ble.gatts_set_value(opts)`: update a characteristic cached value without
  notifying peers.
- `ble.adv_start(opts)`: start Legacy Advertising.
- `ble.adv_stop()`: stop advertising and disable automatic re-advertising.
- `ble.on_event(fn_or_nil)`: register or clear the single BLE event callback.
- `ble.process_events(timeout_ms)`: dispatch up to 8 queued events.
- `ble.stats([opts])`: inspect module state, connections, or cached characteristic
  values.
- `ble.disconnect([opts])`: disconnect a peer by `conn_index`; the index may be
  omitted only when exactly one peer is connected.
- `ble.notify(opts)`: send a notification to a subscribed peer.
- `ble.indicate(opts)`: send an indication to a subscribed peer.

Most operations return `true` on success or `nil, err` on recoverable runtime
failure. Parameter type and shape errors raise Lua errors.

### Minimal Advertising Example

Prefer the runtime script when the agent only needs to start ordinary BLE
advertising. It initializes BLE, defines a simple `fff0/fff1` GATT service,
starts advertising, and runs an event loop:

```json
{"path":"/fatfs/skills/ble/scripts/start_ble.lua","args":{},"timeout_ms":0}
```

Stop ordinary BLE advertising with:

```json
{"path":"/fatfs/skills/ble/scripts/stop_ble.lua","args":{},"timeout_ms":5000}
```

Use direct Lua when generating a custom advertising script:

```lua
local ble = require("ble")

assert(ble.init())
assert(ble.set_name("esp-claw"))
assert(ble.adv_start({
    data = {
        name = "esp-claw",
    },
}))

while true do
    ble.process_events(100)
end
```

### Minimal GATT Example

Use the same runtime start/stop scripts as the advertising example when the
default `fff0/fff1` GATT service is enough. Use direct Lua when the generated
script needs a custom GATT profile or event behavior.

This example exposes service `fff0` with one read/write/notify characteristic.
A peer must subscribe before `ble.notify()` can succeed.

```lua
local ble = require("ble")

local subscribed = {}

assert(ble.init())
assert(ble.set_name("esp-claw"))

assert(ble.gatts_define({
    services = {
        {
            uuid = "fff0",
            characteristics = {
                {
                    uuid = "fff1",
                    id = "rx_tx",
                    properties = {
                        read = true,
                        write = true,
                        notify = true,
                    },
                    permissions = {
                        read = true,
                        write = true,
                    },
                    value = "hello",
                    max_len = 128,
                },
            },
        },
    },
}))

assert(ble.on_event(function(ev)
    if ev.type == "gatts_write" and ev.characteristic_id == "rx_tx" then
        ble.gatts_set_value({ characteristic_id = "rx_tx", data = ev.data })
        if subscribed[ev.conn_index] then
            ble.notify({
                conn_index = ev.conn_index,
                characteristic = "rx_tx",
                data = "echo:" .. ev.data,
            })
        end
    elseif ev.type == "subscribe_changed" and ev.characteristic_id == "rx_tx" then
        subscribed[ev.conn_index] = ev.notify or ev.indicate
    elseif ev.type == "disconnected" then
        subscribed[ev.conn_index] = nil
    end
end))

assert(ble.adv_start({
    data = {
        name = "esp-claw",
        service_uuids = { "fff0" },
    },
}))

while true do
    ble.process_events(100)
end
```

Common advertising fields:

```lua
ble.adv_start({
    data = {
        name = "esp-claw",
        service_uuids = { "fff0" },
        manufacturer_data = "\x01\x02",
    },
    scan_response = {
        name = "esp-claw",
    },
})
```

Advertising payloads are Legacy Advertising payloads and must fit the 31-byte AD
data limit. `adv_start()` sets `adv_requested = true`; advertising automatically
restarts after a disconnect if a connection slot becomes free. `ble.adv_stop()`
clears `adv_requested`.

UUIDs may be 16-bit, 32-bit, or 128-bit strings. Prefer stable characteristic
`id` values for lookup. Do not declare descriptor `2902`; NimBLE creates CCCD
automatically for notify and indicate characteristics.

### Events

Register one global callback with `ble.on_event(fn)`. Events are delivered only
when Lua calls `ble.process_events(timeout_ms)`.

| `ev.type` | Key fields |
|-----------|------------|
| `adv_started` | `reason` = `"user_start"` or `"re_advertise"` |
| `adv_stopped` | `reason` = `"user_stop"`, `"connection_full"`, `"complete"`, `"deinit"`, or `"error"`; `error_code` on errors |
| `connected` | `conn_index`, `conn_handle`, `peer_addr`, `peer_addr_type` |
| `disconnected` | `conn_index`, `reason` = `"local"`, `"remote"`, `"timeout"`, `"deinit"`, or `"error"` |
| `mtu_changed` | `conn_index`, `mtu` |
| `security_changed` | `conn_index`, `encrypted`, `authenticated`, `bonded`, `key_size`, `reason` |
| `gatts_read` | `conn_index`, `service_id`, `characteristic_id`, `uuid_service`, `uuid_characteristic`, `uuid_descriptor`, `offset` |
| `gatts_write` | `conn_index`, `service_id`, `characteristic_id`, `uuid_service`, `uuid_characteristic`, `uuid_descriptor`, `data`, `offset` |
| `subscribe_changed` | `conn_index`, `service_id`, `characteristic_id`, `uuid_service`, `uuid_characteristic`, `notify`, `indicate` |
| `notify_complete` | `conn_index`, `characteristic_id`, `status`, `error_code` |
| `indicate_complete` | `conn_index`, `characteristic_id`, `status`, `error_code` |

### Security

Default security is bonding enabled, Secure Connections enabled, MITM disabled
and Just Works pairing with no input/output capability.

Call `ble.smp_config()` before `ble.init()` to change policy:

```lua
ble.smp_config({
    bonding = true,
    secure_connections = true,
    mitm = false,
    io_cap = "no_io", -- "no_io" | "display_only" | "display_yes_no" | "keyboard_only" | "keyboard_display"
    key_dist = { enc = true, id = true },
    repeat_pairing = "delete_retry", -- "ignore" | "delete_retry"
    require_bond_persist = false,
})
```

`mitm = true` requires `io_cap` other than `"no_io"`, otherwise the call returns
`nil, "ble_smp_invalid_config"`. GATT permissions using `read_authenticated` or
`write_authenticated` also require a MITM-capable SMP config. Encrypted-only
permissions work with the default Just Works policy.

Bond persistence requires `CONFIG_BT_NIMBLE_NVS_PERSIST=y`. If
`require_bond_persist = true` and persistence is disabled, `ble.init()` returns
`nil, "ble_smp_nvs_persist_disabled"`.

### Stats And Connections

`ble.stats()` returns module state:

```lua
local stats = ble.stats()
print(stats.adv_active, stats.adv_requested, stats.preferred_mtu)

for _, conn in ipairs(stats.connections) do
    print(conn.conn_index, conn.connected, conn.encrypted, conn.mtu)
end
```

`stats.connections` always has 3 Lua table entries. The table is indexed with
Lua's normal 1-based indexes, but each connection entry exposes stable
`conn_index` values `0..2` for calls such as `ble.disconnect()`, `ble.notify()`,
and `ble.indicate()`.

Read a cached characteristic value with:

```lua
local char = ble.stats({
    char = {
        characteristic_id = "rx_tx",
    },
})
print(char.value)
```

### Common Errors

Successful mutating operations usually return `true`. Runtime failures return
`nil, err`. Parameter validation errors raise Lua errors.

Common recoverable errors:

- `ble_init_not_initialized`: call `ble.init()` first.
- `ble_invalid_state`: operation is not valid in the current state.
- `ble_conn_index_required`: multiple peers are connected; pass `conn_index`.
- `ble_conn_not_found`: no peer exists at that `conn_index`.
- `ble_adv_data_too_long`: advertising payload exceeds 31 bytes.
- `ble_gatt_char_not_found`: characteristic lookup failed.
- `ble_gatt_char_ambiguous`: UUID lookup matched multiple characteristics.
- `ble_gatt_not_subscribed`: peer has not subscribed to notify or indicate.
- `ble_gatt_indicate_in_progress`: connection already has a pending indication.
- `ble_smp_invalid_config`: SMP config or authenticated permission is invalid.
- `ble_smp_security_failed`: secure notify or indicate was attempted before the
  connection met the required security level.
- `ble_smp_nvs_persist_disabled`: bond persistence was required but is disabled.

<!-- doc: lua_module_ble_hid/README.md -->
<a id="lua-module-ble-hid-readme"></a>

## Lua BLE HID

It exposes the device as a composite BLE HID peripheral with media control,
keyboard, and mouse input reports.

### How to call
Lua name: `ble_hid`.
- Call `ble_hid.init([{ name = "esp-claw-hid" }])` before advertising or sending reports
- Call `ble_hid.start([{ name = "esp-claw-hid" }])` to start HID advertising
- Pair from the host operating system Bluetooth settings with the advertised name
- Call `ble_hid.status()` to read `{ initialized, advertising, connected, bonded }`
- Call `ble_hid.media(key [, gesture])` to send a Consumer Control report
- Call `ble_hid.key(key)` to press and release one keyboard key
- Call `ble_hid.combo(key_or_modifier, ...)` to press a shortcut such as `CTRL+C`
- Call `ble_hid.text(text)` to type printable ASCII text on a US keyboard layout
- Call `ble_hid.mouse_move(dx, dy [, wheel [, pan]])` to move the mouse
- Call `ble_hid.mouse_scroll(wheel [, pan])` to scroll vertically or horizontally
- Call `ble_hid.mouse_button(button [, gesture])` to click, press, or release a mouse button
- Call `ble_hid.release_all()` before stopping or after interrupted pointer/key actions
- Call `ble_hid.stop()` to stop advertising, and `ble_hid.deinit()` to release the HID stack

`init` and `start` accept an optional `name` field. The name length must be 29
bytes or less. The default name is `esp-claw-hid`.

### Example
```lua
local ble_hid = require("ble_hid")

local ok, err = ble_hid.init({ name = "esp-claw-hid" })
if not ok then
    error(err)
end

ok, err = ble_hid.start({ name = "esp-claw-hid" })
if not ok then
    error(err)
end

print("Pair with esp-claw-hid from the host Bluetooth settings")

local status = ble_hid.status()
print("connected:", status.connected, "bonded:", status.bonded)

ble_hid.media("play_pause")
ble_hid.media("volume_up")
ble_hid.key("ENTER")
ble_hid.combo("CTRL", "C")
ble_hid.text("hello")
ble_hid.mouse_move(20, 0)
ble_hid.mouse_button("left", "click")
ble_hid.mouse_scroll(-3, 0)

ble_hid.release_all()
ble_hid.stop()
ble_hid.deinit()
```

### Supported Input

Media keys:
- `volume_up`
- `volume_down`
- `play_pause`
- `next_track`
- `previous_track`
- `mute`

Media gestures:
- `single`
- `double`
- `long`

Keyboard keys include:
- `A` through `Z`
- `0` through `9`
- `ENTER`, `ESC`, `BACKSPACE`, `TAB`, `SPACE`
- `MINUS`, `EQUAL`, `LEFT_BRACKET`, `RIGHT_BRACKET`, `BACKSLASH`
- `SEMICOLON`, `QUOTE`, `GRAVE`, `COMMA`, `PERIOD`, `SLASH`
- `CAPS_LOCK`, `F1` through `F12`
- `PRINT_SCREEN`, `SCROLL_LOCK`, `PAUSE`, `INSERT`, `HOME`
- `PAGE_UP`, `DELETE`, `END`, `PAGE_DOWN`
- `RIGHT`, `LEFT`, `DOWN`, `UP`

Keyboard modifiers for `combo`:
- `CTRL`, `CONTROL`
- `SHIFT`
- `ALT`, `OPTION`
- `GUI`, `COMMAND`, `CMD`, `META`
- `RIGHT_CTRL`, `RIGHT_SHIFT`, `RIGHT_ALT`, `RIGHT_GUI`

Mouse buttons:
- `left`
- `right`
- `middle`

Mouse button gestures:
- `click`
- `down`
- `up`

`ble_hid.text(text)` simulates basic ASCII on a standard US keyboard layout. It
supports letters, digits, common printable punctuation, space, newline, and tab.
It does not support Unicode, IME input, emoji, dead keys, or non-US layout
correction.

### Return Values

Most operations return `true` on success. Runtime failures return `nil, err`.
Argument validation errors raise Lua errors.

Typical failures are:
- `HID not initialized`: call `ble_hid.init()` first
- `not connected`: pair and connect from the host before sending reports
- `unsupported ...`: use one of the supported key, modifier, media, button, or gesture names

### HID Reports

The module owns one BLE HID service with three input reports:
- Consumer Control: report ID `1`, 1 byte
- Keyboard: report ID `2`, 8 bytes, `modifier + reserved + 6 keycodes`
- Mouse: report ID `3`, 5 bytes, `buttons + x + y + wheel + horizontal pan`

The C implementation sends report payload bytes with:

```c
esp_hidd_dev_input_set(dev, 0, report_id, data, len);
```

The payload does not include the report ID. ESP-IDF `esp_hidd` owns the HID GATT
service, characteristics, CCCD handling, protocol mode, control point, and BLE
notification transport.

<!-- doc: lua_module_ble_hid/lib/ble_hid_actions.md -->
<a id="lua-module-ble-hid-lib-ble-hid-actions"></a>

## ble_hid_actions.lua

Reusable pure-Lua BLE HID action helper for validating, normalizing, and
running agent-facing media, keyboard, and mouse actions.

### Require

```lua
local actions = require("ble_hid_actions")
```

### Dependencies

- `ble_hid` module
- An initialized and connected BLE HID session before calling `actions.run`

### Action Shape

Actions are Lua tables with a non-empty string `type` field.

Supported action types:
- `media`
- `keyboard_key`
- `keyboard_combo`
- `keyboard_text`
- `mouse_button`
- `mouse_move`
- `mouse_scroll`
- `keyboard`, deprecated legacy alias

### Functions

- `actions.normalize_action(action)`: return a normalized copy of an action, or `nil, err`.
- `actions.validate_action(action)`: normalize and validate an action, or return `nil, err`.
- `actions.run(action)`: validate an action and send it through `ble_hid`, or return `nil, err`.
- `actions.is_implemented(action_type)`: return whether an action type can be executed.
- `actions.action_types()`: return a sorted list of known action type names.

Validation errors are returned as `nil, err`. Errors raised by the underlying
`ble_hid` module, such as unsupported key names, remain Lua errors from
`ble_hid`.

### Actions

#### Media

```lua
{ type = "media", key = "play_pause", gesture = "single" }
```

Fields:
- `key`: required media key string.
- `gesture`: optional gesture string, `single` by default.

Supported media keys are `volume_up`, `volume_down`, `play_pause`,
`next_track`, `previous_track`, and `mute`.

Supported gestures are `single`, `double`, and `long`.

#### Keyboard Key

```lua
{ type = "keyboard_key", key = "ENTER" }
```

Fields:
- `key`: required keyboard key string.

Lowercase single letters and alphabetic key names are normalized to uppercase.
A single uppercase letter, for example `A`, is normalized to
`{ type = "keyboard_combo", keys = { "SHIFT", "A" } }` so it types the
uppercase character.

Keyboard keys include `A` through `Z`, `0` through `9`, `ENTER`, `ESC`,
`BACKSPACE`, `TAB`, `SPACE`, punctuation key names, `F1` through `F12`,
navigation keys, and arrow keys. See `ble_hid` module documentation for the
full supported key list.

#### Keyboard Combo

```lua
{ type = "keyboard_combo", keys = { "CTRL", "C" } }
```

Fields:
- `keys`: required non-empty array of key or modifier strings.

Alphabetic key names are normalized to uppercase.

Supported modifiers are `CTRL`, `CONTROL`, `SHIFT`, `ALT`, `OPTION`, `GUI`,
`COMMAND`, `CMD`, `META`, `RIGHT_CTRL`, `RIGHT_SHIFT`, `RIGHT_ALT`, and
`RIGHT_GUI`.

#### Keyboard Text

```lua
{ type = "keyboard_text", text = "hello" }
```

Fields:
- `text`: required string.

Text input uses the underlying `ble_hid.text(text)` behavior. It supports
printable ASCII, space, newline, and tab on a US keyboard layout. Unicode and
IME input are not supported.

#### Mouse Button

```lua
{ type = "mouse_button", button = "left", gesture = "click" }
```

Fields:
- `button`: optional button string, `left` by default.
- `gesture`: optional gesture string, `click` by default.

Supported buttons are `left`, `right`, and `middle`.

Supported gestures are `click`, `down`, and `up`.

#### Mouse Move

```lua
{ type = "mouse_move", dx = 30, dy = 0, scale = 1 }
```

Fields:
- `dx`: optional horizontal movement, `0` by default.
- `dy`: optional vertical movement, `0` by default.
- `scale`: optional multiplier, `1` by default.

Aliases:
- `x` may be used instead of `dx`.
- `y` may be used instead of `dy`.

`actions.run` sends `dx * scale` and `dy * scale` to `ble_hid.mouse_move`.

#### Mouse Scroll

```lua
{ type = "mouse_scroll", vertical = -3, horizontal = 0 }
```

Fields:
- `vertical`: optional wheel movement, `0` by default.
- `horizontal`: optional horizontal pan movement, `0` by default.

Aliases:
- `wheel` may be used instead of `vertical`.
- `pan` may be used instead of `horizontal`.

#### Legacy Keyboard

```lua
{ type = "keyboard", keys = { "CTRL", "C" } }
```

The legacy `keyboard` action is deprecated. It requires a non-empty `keys`
array and normalizes to either:
- `keyboard_key` when `keys` contains one entry.
- `keyboard_combo` when `keys` contains multiple entries.

### Example

```lua
local ble_hid = require("ble_hid")
local actions = require("ble_hid_actions")

local ok, err = ble_hid.init({ name = "esp-claw-hid" })
if not ok then
    error(err)
end

ok, err = ble_hid.start({ name = "esp-claw-hid" })
if not ok then
    error(err)
end

-- Pair and connect from the host Bluetooth settings before sending actions.

local action = {
    type = "keyboard_combo",
    keys = { "CTRL", "C" },
}

ok, err = actions.run(action)
if not ok then
    error(err)
end

actions.run({ type = "media", key = "play_pause" })
actions.run({ type = "keyboard_text", text = "hello" })
actions.run({ type = "mouse_move", dx = 20, dy = 0 })
actions.run({ type = "mouse_button", button = "left", gesture = "click" })
actions.run({ type = "mouse_scroll", vertical = -3 })

ble_hid.release_all()
ble_hid.stop()
ble_hid.deinit()
```

<!-- doc: lua_module_call_capability/README.md -->
<a id="lua-module-call-capability-readme"></a>

## Lua Capability

This module describes how to call registered capabilities directly from Lua.

### How to call
Lua name: `capability`.
- Main API: `ok, out, err = capability.call(name, payload[, opts])`. ALWAYS follow the 3-element pattern, `ok, out, err`, to receive the result, for example `local ok, xxx_out, err = capability.call("xxx", ...)`.
- `name` must match the real registered capability id, for example `qq_send_message`, `qq_send_image`, or `qq_send_file`.

### API

#### `capability.call(name, payload[, opts])`
- Inputs:
  - `name`: required `string`, capability name or id
  - `payload`: optional `nil | table | string`
  - `opts`: optional `table`
- Output:
  - success: `true, output_string, nil`
  - failure: `false, output_string|nil, error_string`

### Payload rules
- `nil` becomes `{}`.
- A Lua `table` is serialized to compact JSON.
- A `string` must already be valid JSON and is passed through unchanged.
- The payload keys must match the target capability schema exactly. For example, `qq_send_message` expects `message`, not `text`.

### Supported `opts`
- `session_id: string`
- `channel: string`
- `chat_id: string`
- `source_cap: string`
- `max_output_bytes: number`, optional output buffer size for this call. Defaults to 65536 and is clamped to `[1024, 262144]`.

If an `opts` field is missing, the module tries to inherit the same field from global `args`.

### IM capability mapping
- QQ text/image/file:
  - `qq_send_message` with required `chat_id` and `message`
  - `qq_send_image` with required `chat_id`, `path`, and optional `caption`
  - `qq_send_file` with required `chat_id`, `path`, and optional `caption`
- Telegram text/image/file:
  - `tg_send_message` with required `chat_id` and `message`
  - `tg_send_image` with required `chat_id`, `path`, and optional `caption`
  - `tg_send_file` with required `chat_id`, `path`, and optional `caption`
- WeChat text/image:
  - `wechat_send_message` with `message`
  - `wechat_send_image` with `path` and optional `caption`
- Always pass `chat_id` explicitly for `qq`, `tg`, and `wechat` calls.
- Prefer putting `chat_id` in `opts` for `qq` and `tg`, and in `payload` for `wechat`.

### If you want to call other generic capabilities
- Use activate_skill to activate the needed capability and learn what is the schema of the input arguments; what is the schema of the return values.
- Then choose the proper input arguments and call the capability with `capability.call`, and use the correct way to parse the results.

### Examples

#### Send a QQ message
```lua
local capability = require("capability")

local ok, out, err = capability.call("qq_send_message", {
  message = "hello from lua"
}, {
  channel = "qq",
  chat_id = "c2c:123456",
  session_id = "demo-session",
  source_cap = "lua_script"
})
print(ok, out, err)
```

#### Send an image or file
```lua
local capability = require("capability")

local ok1, out1, err1 = capability.call("qq_send_image", {
  path = "/fatfs/statistics/ESP-Claw.png",
  caption = "image from lua"
}, {
  channel = "qq",
  chat_id = "c2c:123456",
  source_cap = "lua_script"
})

local ok2, out2, err2 = capability.call("qq_send_file", {
  path = "/fatfs/reports/status.json",
  caption = "latest report"
}, {
  channel = "qq",
  chat_id = "c2c:123456",
  source_cap = "lua_script"
})

print(ok1, out1, err1)
print(ok2, out2, err2)
```

#### Send a Telegram message
```lua
local capability = require("capability")

local ok, out, err = capability.call("tg_send_message", {
  message = "hello from lua"
}, {
  channel = "telegram",
  chat_id = "-1001234567890",
  source_cap = "lua_script"
})
print(ok, out, err)
```

#### Send a Telegram message to another chat
```lua
local capability = require("capability")

local ok, out, err = capability.call("tg_send_message", {
  message = "telegram reply from lua"
}, {
  channel = "telegram",
  chat_id = "-1009876543210",
  source_cap = "lua_script"
})
print(ok, out, err)
```

#### Send a WeChat message
```lua
local capability = require("capability")

local ok, out, err = capability.call("wechat_send_message", {
  chat_id = "room123",
  message = "hello from lua"
}, {
  channel = "wechat",
  source_cap = "lua_script"
})
print(ok, out, err)
```

#### Send a WeChat image
```lua
local capability = require("capability")

local ok, out, err = capability.call("wechat_send_image", {
  chat_id = "wxid_abc123",
  path = "/fatfs/statistics/ESP-Claw.png",
  caption = "image from lua"
}, {
  channel = "wechat",
  source_cap = "lua_script"
})
print(ok, out, err)
```

<!-- doc: lua_module_event_publisher/README.md -->
<a id="lua-module-event-publisher-readme"></a>

## Lua Event Publisher

### Default (use this first — avoids runtime errors)

From **callbacks** (button, timers) or any code path where brevity matters, send IM text with a **single string**. The firmware sets `source_cap = "lua_script"` and fills `channel` / `chat_id` from global `args` when the agent started the script in a chat:

```lua
local ep = require("event_publisher")
ep.publish_message("Button pressed!")
```

**Dot syntax only:** `ep.publish_message(...)`. Do **not** use `ep:publish_message(...)` (colon passes the wrong first argument).

Do **not** write a **partial table** (e.g. only `channel`, `chat_id`, `text`). That fails with `missing required field 'source_cap'`. Either use the **string** form above, or a **complete** table (next section).

### Table form (only when you need extra fields)

If you pass a **table**, **every** of these is required unless noted:

| Field | Required? | Notes |
|-------|-----------|--------|
| `source_cap` | **Yes** | e.g. `"lua_script"` |
| `text` | **Yes** | message body |
| `channel` | If not in `args` | Often use `args.channel` when agent-injected |
| `chat_id` | If not in `args` | Often use `args.chat_id` when agent-injected |

```lua
local ep = require("event_publisher")
ep.publish_message({
  source_cap = "lua_script",
  channel = args.channel,
  chat_id = args.chat_id,
  text = "Button pressed!",
})
```

### Session context (agent / IM)

When the agent runs your script from a chat session, the firmware may merge `channel`, `chat_id`, and `session_id` into the global `args` table. Prefer **string** `publish_message` so you do not forget `source_cap` in callbacks.

If `args.channel` / `args.chat_id` are missing (e.g. CLI run without IM), pass `channel` and `chat_id` explicitly in the **table** (still include `source_cap` and `text`).

### Other APIs

- `publish_trigger` and `publish` always take a **table** as the first argument (see their fields in docs when used).

### Example (CLI / no `args`)

```lua
local event_publisher = require("event_publisher")

event_publisher.publish_message({
  source_cap = "lua_script",
  channel = "custom",
  chat_id = "demo",
  text = "hello"
})
```

<!-- doc: lua_module_http_server/README.md -->
<a id="lua-module-http-server-readme"></a>

## Lua HTTP Server

This module lets a long-running Lua script publish static FatFS files and HTTP
callbacks through the existing open_deskos HTTP server.

### Example

```lua
local http = require("http_server")
local system = require("system")

local app = http.app("panel")
app:mount_static("/fatfs/www/panel")

app:get("/state", function(req)
  return {
    json = {
      ok = true,
      uptime = system.uptime(),
      method = req.method,
      path = req.path,
    },
  }
end)

app:post("/echo", function(req)
  return { json = { ok = true, body = req.body } }
end)

print(app:url())
app:serve_forever()
```

Run scripts that serve callbacks through `lua_run_script_async`, because
`serve_forever()` keeps the Lua state alive until the job is stopped.

### URL Space

- Static files: `/lua/<app_id>/...`
- Callback APIs: `/api/lua/<app_id>/...`

`app_id` may contain only letters, digits, `_`, and `-`.

### Static Page Rules

Open static pages with the trailing slash, for example `/lua/panel/`.
Without the trailing slash, browsers treat `/lua/panel` as a file path and
resolve relative assets like `./app.js` as `/lua/app.js`, which is invalid
because `app.js` would be parsed as the app id.

For packaged skills with a fixed default `app_id`, prefer absolute asset URLs
in HTML:

```html
<link rel="stylesheet" href="/lua/panel/style.css">
<script src="/lua/panel/app.js"></script>
```

If a skill allows callers to change `app_id`, either keep the documented
trailing-slash URL as the required entry point or update the HTML asset URLs to
match the chosen app id.

### Packaged Skill Example

The repository includes a ready-to-run skill example:

```text
components/lua_modules/lua_module_http_server/skills/http_server_lua_demo/
```

It starts a background Lua web page at `/lua/lua_demo/`, shows "Hello World",
and logs every switch toggle from the browser in the Lua script output.
