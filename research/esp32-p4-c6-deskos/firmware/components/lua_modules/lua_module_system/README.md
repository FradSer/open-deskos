# Lua System, hardware and media API

This is the preserved research API. Read the applicable section before you call a module. Load its listed Lua name with require(). Use documented options. Release handles when the section requires cleanup. Test hardware operations only in an authorized device task.

## Contents

- [lua_driver_adc/README.md](#lua-driver-adc-readme)
- [lua_driver_gpio/README.md](#lua-driver-gpio-readme)
- [lua_driver_i2c/README.md](#lua-driver-i2c-readme)
- [lua_driver_i2c/lib/lib_si12t_touch.md](#lua-driver-i2c-lib-lib-si12t-touch)
- [lua_driver_i2c/lib/ssd1306.md](#lua-driver-i2c-lib-ssd1306)
- [lua_driver_mcpwm/README.md](#lua-driver-mcpwm-readme)
- [lua_driver_pcnt/README.md](#lua-driver-pcnt-readme)
- [lua_driver_rmt/README.md](#lua-driver-rmt-readme)
- [lua_driver_rmt/lib/ir_driver.md](#lua-driver-rmt-lib-ir-driver)
- [lua_driver_touch/README.md](#lua-driver-touch-readme)
- [lua_driver_uart/README.md](#lua-driver-uart-readme)
- [lua_module_audio/README.md](#lua-module-audio-readme)
- [lua_module_board_manager/README.md](#lua-module-board-manager-readme)
- [lua_module_button/README.md](#lua-module-button-readme)
- [lua_module_camera/README.md](#lua-module-camera-readme)
- [lua_module_delay/README.md](#lua-module-delay-readme)
- [lua_module_environmental_sensor/README.md](#lua-module-environmental-sensor-readme)
- [lua_module_fuel_gauge/README.md](#lua-module-fuel-gauge-readme)
- [lua_module_fuel_gauge/lib/lib_fuel_gauge.md](#lua-module-fuel-gauge-lib-lib-fuel-gauge)
- [lua_module_image/README.md](#lua-module-image-readme)
- [lua_module_imu/README.md](#lua-module-imu-readme)
- [lua_module_ir/README.md](#lua-module-ir-readme)
- [lua_module_json/README.md](#lua-module-json-readme)
- [lua_module_knob/README.md](#lua-module-knob-readme)
- [lua_module_led_strip/README.md](#lua-module-led-strip-readme)
- [lua_module_magnetometer/README.md](#lua-module-magnetometer-readme)
- [lua_module_sci/README.md](#lua-module-sci-readme)
- [lua_module_storage/README.md](#lua-module-storage-readme)
- [lua_module_system/README.md](#lua-module-system-readme)
- [lua_module_system/lib/arg_schema.md](#lua-module-system-lib-arg-schema)
- [lua_module_thread/README.md](#lua-module-thread-readme)
- [lua_module_vision/README.md](#lua-module-vision-readme)

<!-- doc: lua_driver_adc/README.md -->
<a id="lua-driver-adc-readme"></a>

## Lua ADC (one-shot)

This module describes how to read a voltage (in millivolts) from an
Read calibrated millivolts from an ADC-capable GPIO with the ESP-IDF one-shot driver. The module selects attenuation and bit width. It does not expose raw ADC codes.

### How to call
Lua name: `adc`.
- Create a channel with `local ch = adc.new(gpio)`
  - `gpio`: a GPIO number wired to an ADC-capable pad. ADC unit and
    channel are resolved automatically from the GPIO. If the chip does not
    support on-chip calibration, `new()` raises a Lua error — wrap in
    `pcall` if you want to handle that gracefully.
- `ch:read()` → current voltage in millivolts (integer). Blocking, returns
  within microseconds.
- `ch:get_gpio()` → the GPIO number this channel is bound to.
- `ch:close()` when you're done. Handles are also cleaned up on garbage
  collection, but explicit `close()` is preferred for determinism.

### Example: read a potentiometer
```lua
local adc = require("adc")
local delay = require("delay")

local ch = adc.new(4)   -- GPIO 4
for _ = 1, 5 do
    print(string.format("%d mV", ch:read()))
    delay.delay_ms(200)
end
ch:close()
```

### Notes
- `ch:read()` is blocking on the order of microseconds. For fast streaming
  or high-rate sampling, the one-shot driver is not the right tool.
- Multiple channels can coexist; just call `adc.new()` for each GPIO.

<!-- doc: lua_driver_gpio/README.md -->
<a id="lua-driver-gpio-readme"></a>

## Lua GPIO

### How to call
Lua name: `gpio`.
- Call `gpio.set_direction(pin, mode)` to set pin mode
- Call `gpio.set_level(pin, level)` to set output level
- Call `gpio.get_level(pin)` to read pin level

<!-- doc: lua_driver_i2c/README.md -->
<a id="lua-driver-i2c-readme"></a>

## Lua I2C

It is built on top of the `i2c_bus` component and supports scanning a bus
and talking to multiple devices on the same bus.

### How to call
Lua name: `i2c`.
- Create a bus with `local bus = i2c.new(port, sda, scl [, freq_hz])`
  - `port`: I2C port number, usually `0` or `1`
  - `sda`, `scl`: GPIO numbers for SDA and SCL
  - `freq_hz`: optional clock frequency in Hz, default `400000`
- Scan the bus for devices with `local addrs = bus:scan()`
  - Returns a Lua array of 7-bit addresses that ACKed
- Attach a device with `local dev = bus:device(addr [, clk_speed])`
  - `addr`: 7-bit I2C address (0-127)
  - `clk_speed`: optional per-device override in Hz, `0` to inherit the bus speed
- Read/write on a device:
  - `dev:read_byte([mem_addr])` → integer (0-255)
  - `dev:read(len [, mem_addr])` → binary string of `len` bytes
  - `dev:write_byte(value [, mem_addr])`
  - `dev:write(data [, mem_addr])` where `data` is a string or a table of bytes
  - `dev:address()` → the 7-bit address
- Close handles when you're done with `dev:close()` and `bus:close()`.
  **Always close every device before closing its bus.** Handles are also
  cleaned up automatically on garbage collection, but explicit close is
  preferred so resources are released deterministically.

`mem_addr` is the 8-bit internal register/memory address inside the device.
Omit it (or pass `nil`) for devices that have no internal address. Any error
raises a Lua error, so wrap calls in `pcall` if you want to handle failures.

### Reusable libraries
- `ssd1306`: Pure-Lua SSD1306 OLED helper for I2C panels. Use
  `local ssd1306 = require("ssd1306")` after opening an I2C device handle.
- `lib_si12t_touch`: Pure-Lua Si12T 12-channel capacitive touch helper. Use
  `local si12t_touch = require("lib_si12t_touch")`; it can reuse an existing
  I2C bus or create one from `port`, `sda`, and `scl` options.

See `scripts/builtin/lib/ssd1306.md` and
`scripts/builtin/lib/lib_si12t_touch.md` for the full library APIs.

### Example: scan the bus
```lua
local i2c = require("i2c")

local bus = i2c.new(0, 21, 22, 400000)
for _, addr in ipairs(bus:scan()) do
    print(string.format("found device at 0x%02X", addr))
end
bus:close()
```

### Example: read a register from a device
```lua
local i2c = require("i2c")

local bus = i2c.new(0, 21, 22)
local dev = bus:device(0x68)             -- MPU6050-style address
local who_am_i = dev:read_byte(0x75)     -- read register 0x75
print(string.format("WHO_AM_I = 0x%02X", who_am_i))

dev:write_byte(0x00, 0x6B)               -- wake up (PWR_MGMT_1 = 0)
local raw = dev:read(14, 0x3B)           -- burst-read 14 bytes from 0x3B

dev:close()
bus:close()
```

### Example: write multiple bytes
```lua
-- pass a string
dev:write("\x01\x02\x03")

-- or a table of bytes (with optional leading register address)
dev:write({0xA0, 0x55, 0xAA}, 0x10)
```

<!-- doc: lua_driver_i2c/lib/lib_si12t_touch.md -->
<a id="lua-driver-i2c-lib-lib-si12t-touch"></a>

## lib_si12t_touch.lua

Reusable Lua driver for the Si12T 12-channel capacitive touch IC (TS1..TS12). It uses the builtin `i2c` module and exports `require("lib_si12t_touch")`.

### When to use

Use this library when a script needs to read the touched/untouched state of a Si12T's 12 capacitive channels. The IC is self-contained on a single I2C address (`0x68` when `ID_SEL=GND`, `0x78` when `ID_SEL=VDD`).

### Loading

```lua
local si12t_touch = require("lib_si12t_touch")
```

The script must also have access to the `i2c` module. You can either pass an existing I2C bus handle or let the library create one from GPIO options.

### Constructor

```lua
local touch = si12t_touch.new(opts)
```

`opts` is a table:

- `bus`: existing I2C bus userdata. Recommended when the script already owns a bus.
- `port`: I2C port number. Required if `bus` is not provided.
- `sda`: SDA GPIO. Required if `bus` is not provided.
- `scl`: SCL GPIO. Required if `bus` is not provided.
- `freq_hz`: I2C frequency in Hz. Defaults to `100000`.
- `frequency`: alias of `freq_hz`.
- `addr`: 7-bit I2C address. Must be `0x68` or `0x78`. Defaults to `0x78`.
- `threshold`: sensitivity 0..7 (lower = more sensitive). Defaults to `3`.
- `channels`: which channels to enable. Defaults to all 12. Accepts:
    - `nil` or `"all"` — enable all 12 channels.
    - integer bitmask, TS1=bit0..TS12=bit11 (e.g. `0x007` for TS1/TS2/TS3).
    - array of 1-based channel numbers, e.g. `{1, 2, 3}`.
    - comma-separated string, e.g. `"1,2,3"`.

If `bus` is omitted, the library creates and owns the I2C bus and will close it from `touch:close()` when `opts.close_bus = true`.

### Methods

- `touch:address()`: returns the configured 7-bit I2C address.
- `touch:threshold()`: returns the current threshold (0..7).
- `touch:channel_mask()`: returns the current 12-bit enabled-channel bitmask.
- `touch:read()`: returns a 12-bit bitmask of currently-touched channels (TS1=bit0). Disabled channels are masked out.
- `touch:read_channels()`: returns `{ [1]=bool, ..., [12]=bool }`.
- `touch:set_threshold(value)`: re-arm the chip with a new sensitivity (0..7).
- `touch:set_channels(spec)`: re-arm the chip with a new enabled-channel set. `spec` accepts the same forms as the `channels` option.
- `touch:close()`: closes the I2C device and, if owned by the touch handle, the I2C bus.

### Module constants

- `si12t_touch.channels()`: returns `12`.
- `si12t_touch.channel_mask_all()`: returns `0xFFF`.

### Example

```lua
local si12t_touch = require("lib_si12t_touch")
local i2c = require("i2c")

local bus = i2c.new(0, 39, 40, 100000)
local touch = si12t_touch.new({
    bus = bus,
    -- addr = 0x78,           -- default
    -- threshold = 3,         -- default
    channels = {1, 2, 3},     -- only TS1/TS2/TS3
})

local mask = touch:read()
print(string.format("status=0x%03X", mask))

touch:close()
bus:close()
```

<!-- doc: lua_driver_i2c/lib/ssd1306.md -->
<a id="lua-driver-i2c-lib-ssd1306"></a>

## ssd1306.lua

Reusable pure-Lua SSD1306 OLED driver for I2C-connected SSD1306 panels.

### Require

```lua
local ssd1306 = require("ssd1306")
```

### Dependencies

- `i2c` module
- An opened I2C device handle for the OLED address, usually `0x3C`

### Constructor

```lua
local oled = ssd1306.new(dev, opts)
```

`dev` must be an I2C device handle with a `write` method.

`opts`:
- `width`: `128` by default
- `height`: `64` by default
- `addr`: metadata only, `0x3C` by default
- `external_vcc`: `false` by default
- `segment_remap`: `true` by default
- `com_scan_dec`: `true` by default

Supported sizes are `128x64` and `128x32`.

### Methods

- `oled:init()`: initialize the panel.
- `oled:clear(color)`: clear the framebuffer to lit or unlit pixels.
- `oled:pixel(x, y, color)`: set one pixel.
- `oled:fill_rect(x, y, w, h, color)`: fill a rectangle.
- `oled:draw_char(x, y, ch, color)`: draw one 5x7 ASCII character.
- `oled:draw_text(x, y, text, color)`: draw ASCII text.
- `oled:invert(enable)`: enable or disable display inversion.
- `oled:contrast(value)`: set contrast from `0` to `255`.
- `oled:show()`: flush the framebuffer to the panel.
- `oled:close()`: mark the display closed.

`color` is truthy for lit pixels and `false` or `nil` for cleared pixels.

### Example

```lua
local i2c = require("i2c")
local ssd1306 = require("ssd1306")

local bus = i2c.new(0, 14, 13, 400000)
local dev = bus:device(0x3C)
local oled = ssd1306.new(dev, { width = 128, height = 64 })

oled:init()
oled:clear(false)
oled:draw_text(10, 10, "SSD1306 OK", true)
oled:show()

oled:close()
dev:close()
bus:close()
```

<!-- doc: lua_driver_mcpwm/README.md -->
<a id="lua-driver-mcpwm-readme"></a>

## Lua MCPWM

This module describes how to use `mcpwm` from Lua for generic PWM output.

### How to call
Lua name: `mcpwm`.
- Create a PWM handle with `local pwm = mcpwm.new({ gpio = 2, frequency_hz = 1000, duty_percent = 50 })`
- A single handle can also drive two outputs with `gpio`/`gpio_a` and `gpio_b`
- Start output with `pwm:start()` or `pwm:set_enabled(true)`
- Change duty cycle on channel 1 with `pwm:set_duty(percent)`
- Change duty cycle on a specific channel with `pwm:set_duty(channel, percent)`
- Change frequency with `pwm:set_frequency(hz)`
- Query the number of outputs on a handle with `pwm:get_channel_count()`
- Stop output with `pwm:stop()` or `pwm:set_enabled(false)`
- Release resources with `pwm:close()`

### Config table
- `gpio` or `gpio_a`: required primary output GPIO
- `gpio_b`: optional secondary output GPIO on the same operator
- `group_id`: optional, defaults to `0`
- `resolution_hz`: optional, defaults to `1000000`
- `frequency_hz`: optional, defaults to `1000`
- `duty_percent`: optional, defaults to `50` for channel 1
- `duty_percent_b`: optional, defaults to `50` for channel 2
- `invert`: optional, defaults to `false` for channel 1
- `invert_b`: optional, defaults to `false` for channel 2

### Example
```lua
local mcpwm = require("mcpwm")

local pwm = mcpwm.new({
    gpio = 2,
    gpio_b = 4,
    frequency_hz = 1000,
    duty_percent = 25,
    duty_percent_b = 75,
})

pwm:start()
pwm:set_duty(75)
pwm:set_duty(2, 40)
pwm:stop()
pwm:close()
```

<!-- doc: lua_driver_pcnt/README.md -->
<a id="lua-driver-pcnt-readme"></a>

## Lua PCNT

This module is PCNT/ENCODER driver for pulse counting from Lua.

### How to call
Lua name: `pcnt`.
- Create a unit with `local unit = pcnt.new({ edge_gpio = 4 })`
- Start counting with `unit:start()`
- Read the current count with `unit:get_count()`
- Clear the counter with `unit:clear()`
- Stop counting with `unit:stop()`
- Release resources with `unit:close()`

### Config table
- `low_limit`: optional, defaults to `-32768`
- `high_limit`: optional, defaults to `32767`
- `accum_count`: optional, defaults to `false`
- `glitch_ns`: optional glitch filter width in nanoseconds
- `edge_gpio`: optional edge input GPIO for the first channel
- `level_gpio`: optional level input GPIO for the first channel
- `pos_edge`: optional, one of `"hold"`, `"increase"`, `"decrease"`, defaults to `"increase"`
- `neg_edge`: optional, one of `"hold"`, `"increase"`, `"decrease"`, defaults to `"hold"`
- `high_level`: optional, one of `"keep"`, `"inverse"`, `"hold"`, defaults to `"keep"`
- `low_level`: optional, one of `"keep"`, `"inverse"`, `"hold"`, defaults to `"keep"`
- `invert_edge`: optional, defaults to `false`
- `invert_level`: optional, defaults to `false`

Additional channels can be added before `start()` with `unit:add_channel(opts)`,
using the same channel fields.

### Example
```lua
local pcnt = require("pcnt")
local delay = require("delay")

local unit = pcnt.new({
    edge_gpio = 4,
    glitch_ns = 1000,
})

unit:start()
delay.delay_ms(1000)
print("count", unit:get_count())
unit:clear()
unit:stop()
unit:close()
```

### Rotary encoder example

For an EC11-style quadrature encoder, wire channel A and channel B to two
PCNT-capable GPIOs. The channel action mapping below follows ESP-IDF's
`examples/peripherals/pcnt/rotary_encoder` example:

```lua
local pcnt = require("pcnt")
local delay = require("delay")

local gpio_a = 0
local gpio_b = 2

local encoder = pcnt.new({
    low_limit = -100,
    high_limit = 100,
    accum_count = true,
    glitch_ns = 1000,
    edge_gpio = gpio_a,
    level_gpio = gpio_b,
    pos_edge = "decrease",
    neg_edge = "increase",
    high_level = "keep",
    low_level = "inverse",
})

encoder:add_channel({
    edge_gpio = gpio_b,
    level_gpio = gpio_a,
    pos_edge = "increase",
    neg_edge = "decrease",
    high_level = "keep",
    low_level = "inverse",
})

encoder:clear()
encoder:start()

while true do
    print("encoder count", encoder:get_count())
    delay.delay_ms(1000)
end
```

The same example is available as `test/rotary_encoder.lua`. Adjust `gpio_a`
and `gpio_b` for your board before running it.

<!-- doc: lua_driver_rmt/README.md -->
<a id="lua-driver-rmt-readme"></a>

## Lua RMT

This module exposes the ESP-IDF RMT peripheral to Lua for raw symbol transmit
and receive. Use this driver for protocol libraries that need precise pulses,
such as IR, LED strips, pulse capture, or custom one-wire protocols.

### How to call

Lua name: `rmt`.
- Create a TX channel with `local tx = rmt.tx({ gpio = 39 })`
- Create an RX channel with `local rx = rmt.rx({ gpio = 38 })`
- Send raw symbols with `tx:send(symbols [, timeout_ms])`
- Receive raw symbols with `local symbols, err = rx:receive(timeout_ms)`
- For loopback or externally triggered captures, arm RX first with `rx:start()`,
  then fetch the result with `local symbols, err = rx:read(timeout_ms)`
- Inspect configuration with `handle:info()`
- Close handles with `handle:close()`

### TX options

| Field               | Type    | Default | Meaning                         |
|---------------------|---------|---------|---------------------------------|
| `gpio`              | integer | required | Output GPIO                     |
| `resolution_hz`     | integer | `1000000` | RMT tick resolution             |
| `mem_block_symbols` | integer | `64`    | RMT memory block size           |
| `trans_queue_depth` | integer | `4`     | Pending transmit queue depth    |
| `carrier_hz`        | integer | unset   | Optional carrier frequency      |
| `carrier_duty`      | number  | `0.33`  | Carrier duty cycle, `0.0-1.0`   |

### RX options

| Field                 | Type    | Default | Meaning                         |
|-----------------------|---------|---------|---------------------------------|
| `gpio`                | integer | required | Input GPIO                      |
| `resolution_hz`       | integer | `1000000` | RMT tick resolution             |
| `mem_block_symbols`   | integer | `128`   | RMT memory block size           |
| `max_symbols`         | integer | `256`   | Maximum captured symbols        |
| `signal_range_min_ns` | integer | `1250`  | Shorter pulses are filtered     |
| `signal_range_max_ns` | integer | `32000000` | Longer idle ends a receive   |

### Symbol format

Each symbol is a table:

- `level0`: `0` or `1`
- `duration0`: RMT ticks
- `level1`: `0` or `1`
- `duration1`: RMT ticks

At the default `1000000` Hz resolution, one tick is one microsecond.

### Example

```lua
local rmt = require("rmt")

local tx = rmt.tx({ gpio = 39, carrier_hz = 38000 })
tx:send({
    { level0 = 1, duration0 = 9000, level1 = 0, duration1 = 4500 },
    { level0 = 1, duration0 = 560,  level1 = 0, duration1 = 560 },
})
tx:close()
```

<!-- doc: lua_driver_rmt/lib/ir_driver.md -->
<a id="lua-driver-rmt-lib-ir-driver"></a>

## ir_driver

`ir_driver` is a Lua IR helper built on top of the low-level `rmt` driver.
Use it when a script needs IR learn/replay behavior without depending on the
native `ir` C module.

Load it with:

```lua
local ir_driver = require("ir_driver")
```

### Constructor

```lua
local dev = ir_driver.new({
    tx_gpio = 39,
    rx_gpio = 38,
    ctrl_gpio = 44,
    carrier_hz = 38000,
})
```

Options:
- `tx_gpio`: IR transmitter GPIO.
- `rx_gpio`: IR receiver GPIO.
- `ctrl_gpio`: optional enable/power GPIO.
- `ctrl_active_level`: active level for `ctrl_gpio`, default `0`.
- `carrier_hz`: TX carrier frequency, default `38000`.
- `tx_resolution_hz`: RMT TX resolution, default `1000000`.
- `rx_resolution_hz`: RMT RX resolution, default `1000000`.
- `rx_max_symbols`: maximum captured symbols, default `256`.
- `signal_range_min_ns`: RX glitch filter threshold, default `1250`.
- `signal_range_max_ns`: RX idle-end threshold, default `32000000`.
- `rx_invert`: invert received levels, default `true` for active-low IR receivers.

At least one of `tx_gpio` or `rx_gpio` is required.

### Raw Symbols

Symbols use the same shape as the `rmt` driver:

```lua
{
    { level0 = 1, duration0 = 9000, level1 = 0, duration1 = 4500 },
    { level0 = 1, duration0 = 560,  level1 = 0, duration1 = 560 },
}
```

At the default 1 MHz resolution, durations are microseconds.

### Methods

- `dev:send_raw(symbols [, timeout_ms])`
- `dev:send_nec(address, command [, timeout_ms])`
- `dev:receive(timeout_ms)` -> `symbols` or `nil, err`
- `dev:start_receive()` then `dev:read_receive(timeout_ms)` for loopback or externally triggered captures
- `dev:receive_nec(timeout_ms [, tolerance])` -> decoded table or `nil, err [, symbols]`
- `dev:info()`
- `dev:name()`
- `dev:close()`

`ir_driver.build_nec(address, command)` returns NEC symbols without opening hardware.
`ir_driver.decode_nec(symbols [, tolerance])` decodes NEC symbols and returns:

```lua
{
    address = 0x00FF,
    command = 0x10EF,
    raw = 0x10EF00FF,
}
```

### Example

```lua
local ir_driver = require("ir_driver")

local dev = ir_driver.new({
    tx_gpio = 39,
    rx_gpio = 38,
    ctrl_gpio = 44,
})

local symbols, err = dev:receive(5000)
if symbols then
    dev:send_raw(symbols)
else
    print("receive failed: " .. tostring(err))
    dev:send_nec(0x00FF, 0x10EF)
end

dev:close()
```

<!-- doc: lua_driver_touch/README.md -->
<a id="lua-driver-touch-readme"></a>

## Lua Touch

This module describes how to read capacitive touch channel data from Lua.
When a request mentions `touch`, `touch channels`, or `capacitive sensor`, use this module by default.

### How to call
Lua name: `touch`.
- Open the device with one of:
  - `local keys = touch.new({ gpios = { 2, 3, 4 } })` — provide GPIOs directly
  - `local keys = touch.new("touch_inputs", { gpios = { 2, 3, 4 }, threshold_milli = 20 })` — choose a name and threshold
- Call `local sample = keys:read()` to get all channel states
- Call `local pressed = keys:is_pressed(index)` to check one channel (1-based index)
- Call `keys:name()` to get the device name string
- Call `keys:close()` when done

### Options table
`gpios` is required. Other fields are optional.

| Field             | Type    | Meaning                                              |
|-------------------|---------|------------------------------------------------------|
| `device`          | string  | Optional name returned by `keys:name()`              |
| `gpios`           | array   | GPIO numbers of touch channels to read               |
| `threshold_milli` | integer | Active threshold in permille of benchmark (default from Kconfig) |

### Data format
`keys:read()` returns a table with:
- `sample.keys` — array of touch channel tables, each containing:
  - `key.index` — 1-based key index
  - `key.channel` — touch sensor channel number
  - `key.gpio` — GPIO number
  - `key.pressed` — boolean
  - `key.smooth` — smoothed raw sensor value
  - `key.benchmark` — baseline reference value
  - `key.delta` — difference between smooth and benchmark
  - `key.threshold` — active threshold value
- `sample.count` — total number of keys
- `sample.any_pressed` — boolean, true if any key is pressed
- `sample.pressed_count` — number of currently pressed keys

### Example
```lua
local touch = require("touch")

local keys = touch.new({ gpios = { 2, 3, 4 } })
local sample = keys:read()
for _, key in ipairs(sample.keys) do
    print(key.index, key.gpio, key.channel, key.smooth)
end
keys:close()
```

<!-- doc: lua_driver_uart/README.md -->
<a id="lua-driver-uart-readme"></a>

## Lua UART

This module describes how to open a UART port and read/write bytes or text
lines from Lua. The module wraps ESP-IDF's UART driver and follows a pure
polling model — scripts call `read` / `read_line` with a timeout and get
back whatever is available.

### How to call
Lua name: `uart`.
- Open a port with `local u = uart.new(port, tx, rx, baud [, opts])`
  - `port`: UART port number. **Start from `1`** (`UART_NUM_1`) by
    default — port `0` is normally claimed by the system log console, so
    opening it from a script will fight the bootloader / `printf` output.
    Each port has a single owner; a second `uart.new()` for the same
    port raises a Lua error.
  - `tx`, `rx`: GPIO numbers for TX and RX pins
  - `baud`: baud rate, e.g. `9600`, `115200`
  - `opts` (optional table, omit entirely for the common **8N1** case):
    - `data_bits`: `5`–`8`, default `8`
    - `parity`: `"none"` / `"even"` / `"odd"`, default `"none"`
    - `stop_bits`: `1` or `2`, default `1`
  - The RX ring buffer is fixed at 1 KiB and writes are blocking (no TX
    ring buffer); flow control is disabled.
- `u:read(len [, timeout_ms])` → string of up to `len` bytes. Timeout in
  milliseconds, default `0` (non-blocking — returns immediately with
  whatever is buffered, possibly empty). The returned string may be
  shorter than `len` if the timeout fires first.
- `u:read_line([max_len, timeout_ms])` → string ending with `\n` (or
  truncated at `max_len` / timeout). Default `max_len` is `1024`. The
  trailing `\n` is kept; strip with `line:gsub("[\r\n]+$", "")` if needed.
- `u:write(data)` → number of bytes sent. `data` is a string or a table
  of byte integers `0..255`.
- `u:available()` → number of bytes currently sitting in the RX buffer.
- `u:flush_input()` → discard all buffered RX data.
- `u:close()` when you're done. Handles are also cleaned up on garbage
  collection; explicit close is preferred for determinism.

### Example: AT-command style request/response
```lua
local uart = require("uart")
local delay = require("delay")

local u = uart.new(1, 17, 18, 115200)
u:flush_input()
u:write("AT\r\n")

delay.delay_ms(50)
local reply = u:read_line(128, 500)   -- up to 500 ms for the response
print("reply:", reply)

u:close()
```

### Example: binary polling loop
```lua
local uart = require("uart")
local delay = require("delay")

local u = uart.new(1, 17, 18, 9600)
for _ = 1, 10 do
    if u:available() > 0 then
        local chunk = u:read(64)      -- non-blocking
        -- process `chunk` (string; may be 1..64 bytes)
    end
    delay.delay_ms(20)
end
u:close()
```

### Example: non-8N1 frame format
Most serial devices are 8N1, but some legacy / industrial protocols
(e.g. Modbus ASCII, some meters) use 7 data bits with parity. Pass an
`opts` table to override; any field left out keeps its 8N1 default.
```lua
local u = uart.new(1, 17, 18, 9600, {
    data_bits = 7,
    parity    = "even",
    stop_bits = 1,
})
```

### Notes
- All reads are **polling with a timeout**. There is no callback /
  interrupt interface in this module. For high-rate data, poll often
  enough to drain the 1 KiB RX buffer before it overruns.
- Closing a port releases the hardware; the same `port` number can then
  be reopened with different settings.

<!-- doc: lua_module_audio/README.md -->
<a id="lua-module-audio-readme"></a>

## Lua Audio

Object-oriented Lua bindings for audio input, output, playback, recording, and
simple analysis. Board discovery stays in `board_manager`; this module only
wraps codec devices and audio processing helpers.

### How to call
- `local audio = require("audio")`
- Get codec handles and default formats from `board_manager.get_audio_codec_input_params(name)` or `board_manager.get_audio_codec_output_params(name)`
- `audio.new_output(desc)` opens an output codec device and returns an output object
- `audio.new_input(desc)` opens an input codec device and returns an input object
- `audio.player({ output = output })` creates a file, HTTP, or HTTPS player bound to one output object
- `audio.recorder({ input = input })` creates a WAV/AAC recorder bound to one input object
- `audio.analyzer({ input = input })` creates a level and spectrum analyzer bound to one input object
- Close player, recorder, and analyzer objects before closing their input or output device

### Device descriptors

`audio.new_output(desc)` and `audio.new_input(desc)` accept the compact table
returned by board manager:

```lua
local codec, rate, channels, bits = board_manager.get_audio_codec_output_params("audio_dac")
local output = audio.new_output({ codec, rate, channels, bits, volume = 80 })
```

Named fields are also accepted:

```lua
local output = audio.new_output({
    codec       = codec,
    sample_rate = 16000,
    channels    = 1,
    bits        = 16,
    volume      = 80,
})
```

Input and output devices both use `volume` as a percentage from 0 to 100:

```lua
local input = audio.new_input({ codec, rate, channels, bits, volume = 70 })
```

The device is opened immediately. `output:info()` and `input:info()` return the
actual device format after open, which may differ from the requested format on
devices such as UAC.

### Output objects
- `output:info()` returns `{ role, sample_rate, channels, bits, bytes_per_frame }`
- `output:set_volume(percent)` sets output volume from 0 to 100
- `output:get_volume()` returns the current output volume
- `output:set_mute(mute)` mutes or unmutes the output
- `output:write(pcm)` writes raw PCM in the output format
- `output:play_tone(freq_hz, duration_ms)` writes a generated sine tone
- `output:close()` closes the codec device

### Input objects
- `input:info()` returns `{ role, sample_rate, channels, bits, bytes_per_frame }`
- `input:set_volume(percent)` sets input capture volume from 0 to 100
- `input:get_volume()` returns the current input capture volume
- `input:read(bytes)` returns raw PCM from the input device
- `input:close()` closes the codec device

### Player

Create a player from an output object:

```lua
local player = audio.player({ output = output })
```

Supported calls:

- `player:play(path_or_uri [, opts])` starts playback
- `player:play(path_or_uri, { wait = true })` blocks until playback finishes
- `player:stop()` stops playback
- `player:pause()` pauses playback
- `player:resume()` resumes playback
- `player:poll()` returns `{ state, running, music_info = ... }`
- `player:close()` closes the player

Local paths are converted to `file://` URIs automatically. HTTP and HTTPS URIs
can be passed directly.

### Recorder

Create a recorder from an input object:

```lua
local recorder = audio.recorder({ input = input })
```

`recorder:record(path, opts)` requires `opts.duration_ms` and returns
`{ path, duration_ms, bytes, encoding, format }`.

```lua
local storage = require("storage")
local path = storage.join_path(storage.get_root_dir(), "rec.aac")
local info = recorder:record(path, {
    duration_ms = 3000,
    bitrate     = 64000,
})
print(info.path, info.bytes, info.encoding)
```

The output encoding is selected from the file extension. Unsupported extensions
return an error. Supported encodings:

- `.wav` writes PCM with a WAV header
- `.aac` writes AAC-LC with ADTS headers through `esp_audio_codec`

The recording output format defaults to the actual input format. It can be
overridden with `sample_rate`, `channels`, or `bits`. Input PCM is converted
automatically when the requested recording format differs from the device
format.

### Analyzer

Create an analyzer from an input object:

```lua
local analyzer = audio.analyzer({ input = input })
```

Supported calls:

- `analyzer:read_level(duration_ms)` returns RMS and peak level data
- `analyzer:read_spectrum(fft_size, bands)` returns spectrum bands and peak frequency data
- `analyzer:close()` closes the analyzer

### Example
```lua
local audio = require("audio")
local board_manager = require("board_manager")
local storage = require("storage")

local output_codec, output_rate, output_channels, output_bits =
    board_manager.get_audio_codec_output_params("audio_dac")
local output = assert(audio.new_output({ output_codec, output_rate, output_channels, output_bits, volume = 80 }))
local player = assert(audio.player({ output = output }))

local path = storage.join_path(storage.get_root_dir(), "static/test.mp3")
player:play(path, { wait = true })

player:close()
output:close()
```

<!-- doc: lua_module_board_manager/README.md -->
<a id="lua-module-board-manager-readme"></a>

## Lua Board Manager

### How to call
Lua name: `board_manager`.
- Call `board_manager.get_board_info()` to read board metadata such as `name`, `chip`, and `version`
- Call `board_manager.init_device(name)` before using a board-managed peripheral
- Call `board_manager.deinit_device(name)` when the peripheral is no longer needed
- Call `board_manager.get_device_handle(name)` or `board_manager.get_device_config_handle(name)` to resolve low-level handles
- Call `board_manager.get_display_lcd_params(name)` to get `panel_handle`, `io_handle`, `lcd_width`, `lcd_height`, and `panel_if`
- Use the built-in constants `board_manager.PANEL_IF_IO`, `board_manager.PANEL_IF_RGB`, and `board_manager.PANEL_IF_MIPI_DSI`
- `panel_if` returned by `get_display_lcd_params(...)` matches one of those constants
- Call `board_manager.get_lcd_touch_handle(name)` to get the raw LCD touch handle
- Call `board_manager.get_audio_codec_input_params(name)` or `board_manager.get_audio_codec_output_params(name)` to get codec handles and format parameters
- Call `board_manager.get_camera_paths()` to get camera device paths such as `dev_path` and `meta_path`

### Example
```lua
local board_manager = require("board_manager")

local info = board_manager.get_board_info()
print(info.name, info.chip)

board_manager.init_device("display_lcd")
local panel_handle, io_handle, width, height, panel_if =
    board_manager.get_display_lcd_params("display_lcd")
print(width, height, panel_if)
if panel_if == board_manager.PANEL_IF_MIPI_DSI then
    print("using DSI panel")
end

local camera_paths = board_manager.get_camera_paths()
print(camera_paths.dev_path)
```

<!-- doc: lua_module_button/README.md -->
<a id="lua-module-button-readme"></a>

## Lua Button

### How to call
Lua name: `button`.
- Call `local handle = button.new(gpio_num [, active_level [, long_press_ms [, short_press_ms]]])` to create a button handle
- Call `button.on(handle, event, callback)` to subscribe to a button event
- Supported event names include `press_down`, `press_up`, `single_click`, `double_click`, `multiple_click`, `long_press_start`, `long_press_hold`, and `long_press_up`
- Call `button.off(handle [, event])` to remove a subscription or clear callbacks
- Call `button.dispatch()` to poll and dispatch pending button events
- Call `button.get_key_level(handle)` to read the current key level
- Call `button.close(handle)` when the handle is no longer needed

### Example
```lua
local button = require("button")

local handle = button.new(0, 0)
button.on(handle, "single_click", function(evt)
  print(evt.event, evt.repeat_count)
end)

button.dispatch()
button.close(handle)
```

<!-- doc: lua_module_camera/README.md -->
<a id="lua-module-camera-readme"></a>

## Lua Camera

Minimal Lua bindings for the V4L2 camera service. The module exposes one
borrow-and-release frame API and intentionally leaves format conversion and
filesystem I/O to other modules.

### How to call
- `local camera = require("camera")`
- `camera.open(dev_path [, opts])` before any other call (opts is optional, see below)
- `camera.info()` returns `{ width, height, pixel_format }` for the active stream
- `camera.get_frame([timeout_ms])` borrows one frame; release frames when they are no longer needed
- `camera.flush()` drops every queued buffer so the next `get_frame()` returns a fresh capture
- `camera.is_open()` / `camera.is_streaming()` query state without raising
- `camera.list_formats()` reports what the sensor/driver can negotiate
- `camera.close()` when the camera is no longer needed

### Negotiating resolution / pixel format

Pass `opts` to ask the driver for a specific capture configuration. Any field
that is `nil` keeps the driver default. `camera.info()` always reflects what
was actually accepted.

```lua
camera.open(paths.dev_path, {
    width   = 640,
    height  = 480,
    format  = { "JPEG", "RGBP" }, -- priority list; first one the sensor speaks wins
    nearest = true,               -- snap width/height to the closest supported size
})
local stream = camera.info()
print(stream.width, stream.height, stream.pixel_format)
```

#### `opts.format`

Array of FOURCC strings ordered by preference. Valid tokens: `RGBP`, `RGBR`,
`RGB3`, `BGR3`, `YUYV`, `UYVY`, `GREY` / `Y800`, `YU12`, `JPEG`, `MJPG`.

- `{ "RGBP" }` — strictly this format. Errors with the list of advertised
  formats if the sensor does not support it.
- `{ "JPEG", "RGBP", "YUYV" }` — try in order; the first FOURCC the sensor
  actually advertises wins.
- omitted — keep the driver default.

#### `opts.width` / `opts.height`

Requested capture size. Omitted means "use the first size the chosen format
advertises". May be combined with `format` and `nearest`.

#### `opts.nearest`

When `true`, the requested `width`/`height` is snapped to the closest size the
chosen format actually supports before the driver sees the request. Composes
with `format`: the FOURCC is picked first, then the nearest size lookup runs
under that FOURCC. Default `false`, which sends the exact requested size and
returns an error when the driver rejects it.

When the camera is already open and the call requests a reconfiguration (new
format or nearest snap), the session is closed and reopened transparently.

### Discovering what the sensor supports

`camera.list_formats()` returns the minimum information scripts usually need:

```lua
{
    format      = "JPEG",        -- 4-char FOURCC
    description = "Motion-JPEG", -- driver text
    sizes = {                    -- array of discrete sizes (may be empty)
        { w = 1600, h = 1200, fps = { 30, 15 } },  -- fps is optional (only when driver enumerates)
        { w = 640,  h = 480 },
    },
}
```

Walking it:

```lua
for _, f in ipairs(camera.list_formats()) do
    print(string.format("%s  (%s)", f.format, f.description))
    for _, s in ipairs(f.sizes) do
        local fps = s.fps and ("  fps=" .. table.concat(s.fps, ",")) or ""
        print(string.format("  %dx%d%s", s.w, s.h, fps))
    end
end
```

If a driver does not implement `VIDIOC_ENUM_FRAMESIZES` (some JPEG-only
sensors in `esp_video` fall in this bucket), or only reports stepwise /
continuous ranges, `sizes` simply comes back empty. Use `camera.info()` to read
what the active stream is producing, and `camera.open(opts)` with explicit
`{ width, height, format }` to probe what other configurations the driver
actually accepts — that is the only reliable test on drivers that won't
enumerate discrete sizes.

### Flushing stale frames

After long idle or sensor wake-up, the V4L2 queue may already hold buffers
captured before exposure/white balance stabilized. Drop them with:

```lua
camera.flush()                -- discard everything currently queued
local frame <close> = camera.get_frame(1000)
```

`flush()` is rejected with an error if one or more frames are still borrowed.

### Frame lifecycle

`camera.get_frame()` returns an `image.frame` userdata. The type and
its methods live in the `image` module so that any frame producer
(camera, future JPEG/file loaders, network streams) shares one contract:

- `frame:info()` returns `{ width, height, bytes, pixel_format, timestamp_us, valid }`
- `frame:data()` copies the buffer into a Lua string (slow, allocates)
- `frame:release()` returns the buffer to its producer

Important:
- `camera.get_frame()` is a **borrow** API, not a copy. The driver owns the buffer.
- Multiple frames may be borrowed at the same time, up to the camera driver buffer count. Release frames promptly so capture buffers return to the driver.
- Converted `image.frame` views can share the same borrowed camera buffer. Release all derived views before `camera.close()`.
- Prefer the Lua 5.4+ `<close>` attribute so the frame is released
  deterministically when the variable leaves scope:
  ```lua
  do
      local frame <close> = camera.get_frame(1000)
      -- use frame here; auto-released on scope exit
  end
  ```
- The raw format can be RGB565, YUV, GRAY, JPEG or MJPEG depending on the
  driver. Consumers (display, vision, JPEG encode) request the format they
  need through `image`.
- `camera.close()` fails with an explicit error when frames are still borrowed.

### Saving a frame as JPEG

Camera no longer owns JPEG encoding or filesystem I/O. Compose three small
modules instead:

```lua
local camera         = require("camera")
local image = require("image")
local storage        = require("storage")

do
    local frame <close> = camera.get_frame(3000)
    image.save_file(storage.join_path(storage.get_root_dir(), "capture.jpg"), frame)
end
```

### Example
```lua
local camera         = require("camera")
local board_manager  = require("board_manager")

local paths = board_manager.get_camera_paths()
camera.open(paths.dev_path)

local stream = camera.info()
print(stream.width, stream.height, stream.pixel_format)

do
    local frame <close> = camera.get_frame(1000)
    local info = frame:info()
    print(info.width, info.height, info.pixel_format, info.bytes)
end

camera.close()
```

<!-- doc: lua_module_delay/README.md -->
<a id="lua-module-delay-readme"></a>

## Lua Delay

### How to call
Lua name: `delay`.
- Call `delay.delay_ms(ms)` to sleep for a number of milliseconds
- Call `delay.delay_us(us)` for short microsecond delays
- **`ms` must be an integer**
- **`us` must be an integer**
- Negative values are accepted but clamped to `0`
- `delay_us(us)` is a busy-wait intended for short hardware timing only
- `delay_us(us)` accepts `0..1000000`; use `delay_ms(ms)` for longer waits

<!-- doc: lua_module_environmental_sensor/README.md -->
<a id="lua-module-environmental-sensor-readme"></a>

## Lua Environmental Sensor

This module describes how to read environmental data from Lua using one of
Select a compiled Bosch BME690 or DHT-family backend at runtime.

### How to call
Lua name: `environmental_sensor`.
- Open the sensor with one of:
  - `local sensor = environmental_sensor.new()` — default to the compiled BME690 backend
  - `local sensor = environmental_sensor.new("environmental_sensor")` — choose a BME690 board device explicitly
  - `local sensor = environmental_sensor.new({ type = "bme690", peripheral = "i2c_master" })`
  - `local sensor = environmental_sensor.new({ type = "dht", pin = 4, sensor_type = "dht22" })`
- Read all values with `local sample = sensor:read()`
- Or read one value at a time:
  - `sensor:read_temperature()`
  - `sensor:read_humidity()`
- BME690-only helpers:
  - `sensor:read_pressure()`
  - `sensor:read_gas()`
- Inspect sensor identity with:
  - `sensor:name()`
- BME690-only identity helpers:
  - `sensor:chip_id()`
  - `sensor:variant_id()`
- Call `sensor:close()` when needed

### Options table
All fields are optional unless the chosen backend requires them.

| Field              | Type    | Meaning                                                         |
|--------------------|---------|-----------------------------------------------------------------|
| `type`             | string  | Backend type: `"bme690"` or `"dht"`                             |
| `device`           | string  | Board device name to load defaults from                         |
| `peripheral`       | string  | Board I2C master peripheral name, e.g. `"i2c_master"`          |
| `i2c_addr`         | integer | BME690 7-bit I2C address, `0x76` or `0x77`                     |
| `frequency`        | integer | I2C clock in Hz (default `400000`)                             |
| `heater_temp`      | integer | Heater target temperature in Celsius (default `300`)           |
| `heater_duration`  | integer | Heater duration in milliseconds (default `100`)                |
| `pin`              | integer | DHT GPIO number                                                 |
| `sensor_type`      | string  | DHT subtype: `"dht11"`, `"dht22"`, `"si7021"`, and aliases     |

### Data format
- Common:
  - `sample.temperature` — degrees Celsius
  - `sample.humidity` — relative humidity in percent
- BME690-only:
  - `sample.pressure` — pressure in Pa
  - `sample.gas_resistance` — gas resistance in ohms
  - `sample.status` — raw BME690 status flags
  - `sample.gas_index` — gas measurement index from the driver
  - `sample.meas_index` — measurement index from the driver

### Example: BME690
```lua
local environmental_sensor = require("environmental_sensor")

local sensor = environmental_sensor.new()
local sample = sensor:read()

print(string.format("temperature: %.2f C", sample.temperature))
print(string.format("pressure: %.2f Pa", sample.pressure))
print(string.format("humidity: %.2f %%", sample.humidity))
print(string.format("gas resistance: %.2f ohm", sample.gas_resistance))
print(string.format("status: 0x%02X", sample.status))

sensor:close()
```

### Example: DHT
```lua
local environmental_sensor = require("environmental_sensor")

local sensor = environmental_sensor.new({
    type = "dht",
    pin = 4,
    sensor_type = "dht22",
})

local sample = sensor:read()
print(string.format("temperature: %.2f C", sample.temperature))
print(string.format("humidity: %.2f %%", sample.humidity))

sensor:close()
```

### Notes
- Reads are blocking.
- Each BME690 call triggers a forced-mode measurement.
- The BME690 board device must resolve to a valid I2C peripheral, or you must
  pass `peripheral` explicitly in Lua.
- Any setup or read failure raises a Lua error.

<!-- doc: lua_module_fuel_gauge/README.md -->
<a id="lua-module-fuel-gauge-readme"></a>

## Lua Fuel Gauge

This skill describes how to read battery fuel-gauge data from Lua using the existing `i2c` module.
When a request mentions `fuel gauge`, `battery voltage`, `battery current`, or `battery percentage`, use this module by default.

The module supports multiple fuel-gauge ICs through a chip profile architecture.
Currently supported chips: **BQ27220**, **MAX17048** (voltage + SOC only, no current).

### How to call
Lua name: `lib_fuel_gauge`.
- Create a gauge with `local gauge = fuel_gauge.new({ bus = bus })` (defaults to BQ27220)
- Select a specific chip with `local gauge = fuel_gauge.new({ bus = bus, chip = "max17048" })`
- Read all values with `local sample = gauge:read()`
- Or read one value at a time:
  - `gauge:read_voltage_mv()`
  - `gauge:read_current_ma()` (not available on all chips)
  - `gauge:read_soc()`
- Query the active chip with `gauge:chip()`
- List supported chips with `fuel_gauge.supported_chips()`
- Call `gauge:close()` when needed

### Options table
| Field      | Type    | Meaning                                              |
|------------|---------|------------------------------------------------------|
| `chip`     | string  | Chip model name, e.g. `"bq27220"`, `"max17048"`     |
| `port`     | integer | I2C port number                                      |
| `sda`      | integer | SDA GPIO number                                      |
| `scl`      | integer | SCL GPIO number                                      |
| `freq_hz`  | integer | I2C clock in Hz (default `400000`)                   |
| `frequency`| integer | Alias of `freq_hz`                                   |
| `addr`     | integer | 7-bit I2C address (default depends on chip)          |
| `bus`      | userdata| Existing `i2c` bus handle, recommended               |

### Data format
- `sample.chip` — chip name string
- `sample.voltage_mv`
- `sample.current_ma` (nil when the chip has no current register)
- `sample.soc`

### Example
```lua
local fuel_gauge = require("lib_fuel_gauge")
local i2c = require("i2c")

local bus = i2c.new(0, 14, 13, 400000)
local gauge = fuel_gauge.new({
    bus = bus,
    chip = "bq27220",   -- or "max17048"
})

print("chip:", gauge:chip())
local sample = gauge:read()
print(sample.voltage_mv, sample.current_ma, sample.soc)
gauge:close()
bus:close()
```

<!-- doc: lua_module_fuel_gauge/lib/lib_fuel_gauge.md -->
<a id="lua-module-fuel-gauge-lib-lib-fuel-gauge"></a>

## lib_bq27220.lua

Reusable Lua driver for the Texas Instruments BQ27220 battery fuel gauge. It uses the builtin `i2c` module and exports `require("lib_bq27220")`.

### When to use

Use this library when a script needs battery state of charge, voltage, or current from a BQ27220 connected over I2C.

### Loading

```lua
local bq27220 = require("lib_bq27220")
```

The script must also have access to the `i2c` module. You can either pass an existing I2C bus handle or let the library create one from GPIO options.

### Constructor

```lua
local gauge = bq27220.new(opts)
```

`opts` is a table:

- `bus`: existing I2C bus userdata. This is recommended when the script already owns a bus.
- `port`: I2C port number. Required if `bus` is not provided.
- `sda`: SDA GPIO. Required if `bus` is not provided.
- `scl`: SCL GPIO. Required if `bus` is not provided.
- `freq_hz`: I2C frequency in Hz. Defaults to `400000`.
- `frequency`: alias of `freq_hz`.
- `addr`: BQ27220 7-bit address. Defaults to `0x55`.

If `bus` is omitted, the library creates and owns the I2C bus and will close it from `gauge:close()`.

### Methods

- `gauge:address()`: returns the configured 7-bit I2C address.
- `gauge:read_voltage_mv()`: returns voltage in millivolts.
- `gauge:read_current_ma()`: returns signed current in milliamps.
- `gauge:read_soc()`: returns state of charge in percent.
- `gauge:read()`: returns `{ voltage_mv = number, current_ma = number, soc = number }`.
- `gauge:close()`: closes the I2C device and, if owned by the gauge, the I2C bus.

### Example

```lua
local bq27220 = require("lib_bq27220")
local i2c = require("i2c")

local bus = i2c.new(0, 14, 13, 400000)
local gauge = bq27220.new({
    bus = bus,
    addr = 0x55,
})

local sample = gauge:read()
print(sample.soc, sample.voltage_mv, sample.current_ma)

gauge:close()
bus:close()
```

<!-- doc: lua_module_image/README.md -->
<a id="lua-module-image-readme"></a>

## Lua Image

Shared image type and conversion helpers for Lua. Every frame produced by
`camera` (and any future producer such as JPEG / file / network loaders) is an
`image.frame` userdata defined by this module, so consumers like
`display` and `vision` only need to learn one type.

### How to call
- `local image = require("image")`
- `image.convert(frame, format)` ensures the requested `image.*` format exists
  in the frame's shared store and returns a new `image.frame` view for that format.
- `image.resize(frame, opts)` returns a new, independent `image.frame` scaled
  to `opts.width` x `opts.height`. See "Example: resize" below.
- `image.load_file(path)` reads an image file and returns an `image.frame`.
- `image.save_file(path, frame)` saves a frame using the format implied by the
  file suffix.

### Format constants

Use these constants with `image.convert(frame, format)`:

| Constant | Output format |
|---|---|
| `image.RGB565` | RGB565 little-endian |
| `image.RGB565_BE` | RGB565 big-endian |
| `image.RGB888` | RGB888 |
| `image.BGR888` | BGR888 |
| `image.GRAY8` | 8-bit grayscale |
| `image.YUYV` | YUV 4:2:2 packed |
| `image.UYVY` | YUV 4:2:2 packed (swapped) |
| `image.JPEG` | JPEG still |
| `image.MJPEG` | Motion-JPEG frame |

### Frame type: `image.frame`

An `image.frame` is a Lua-visible format view over a shared image store. The
store owns the original buffer and any cached converted buffers. Methods:

- `frame:info()` returns `{ width, height, bytes, pixel_format, timestamp_us, valid }`
- `frame:data()` copies the buffer into a Lua string (slow, allocates)
- `frame:release()` releases this view; the store is freed when the last view is released

Release happens automatically when the variable is declared with the Lua 5.4+
`<close>` attribute or when it is collected by GC, but explicit `<close>` is the
recommended style:

```lua
do
    local frame <close> = camera.get_frame(1000)
    -- ... use frame ...
end
-- frame is already released here
```

Converted frames share the same store as their source. Releasing the source
frame does not invalidate converted views that are still alive. For V4L2 camera
frames, the producer buffer is returned only when the last view for that frame
is released, so release all frame views promptly so capture can continue.

### Pixel format names

`frame:info().pixel_format` is a 4-character FOURCC string. The image module
understands these tokens:

| Token | Meaning |
|---|---|
| `RGBP` | RGB565 little-endian |
| `RGBR` | RGB565 big-endian |
| `RGB3` | RGB888 |
| `BGR3` | BGR888 |
| `GREY` / `Y800` | 8-bit grayscale |
| `YUYV` | YUV 4:2:2 packed |
| `UYVY` | YUV 4:2:2 packed (swapped) |
| `JPEG` | JPEG still |
| `MJPG` | Motion-JPEG frame |

Consumers internally request the format they need (e.g. `display` asks for
`RGBP`; `vision` asks for `GREY`); scripts pass the frame object directly and
never need to select a conversion path manually.

### Example: convert a frame

```lua
local image = require("image")

do
    local gray <close> = image.convert(frame, image.GRAY8)
    local jpeg <close> = image.convert(frame, image.JPEG)
end
```

The converted result is a new `image.frame` view backed by the same shared
store. Repeated conversions reuse cached buffers when possible. Release views
with `<close>`, `frame:release()`, or GC.

### Example: resize

`image.resize(frame, opts)` returns a new, independent `image.frame` at
`opts.width` x `opts.height`. Optional `opts.format` selects the output
(`image.RGB565` or `image.GRAY8` only; defaults to RGB565, or GRAY8 when the
source is already gray). Optional `opts.filter` is `"nearest"` (default) or
`"bilinear"`. Output dimensions follow the same 1920 x 1080 pixel cap as
conversion.

```lua
local image = require("image")

do
    local small <close> = image.resize(frame, { width = 96, height = 96 })

    local probe <close> = image.resize(frame, {
        width  = 64,
        height = 64,
        format = image.GRAY8,
        filter = "bilinear",
    })

    local thumb <close> = image.resize(frame, { width = 160, height = 120 })
    local jpeg  <close> = image.convert(thumb, image.JPEG)
    image.save_file("/sdcard/thumb.jpg", jpeg)
end
```

### Example: load JPEG from disk

```lua
local display = require("display")
local image   = require("image")
local storage = require("storage")

do
    local frame <close> = image.load_file(storage.join_path(storage.get_root_dir(), "picture.jpg"))
    local rgb565 <close> = image.convert(frame, image.RGB565)
    display.draw_image(0, 0, rgb565, {
        mode = "fit",
        width = display.width,
        height = display.height,
    })
    image.save_file(storage.join_path(storage.get_root_dir(), "copy.jpg"), frame)
end
```

`load_file()` and `save_file()` currently support `.jpg` / `.jpeg`. The returned
frame keeps the file bytes alive until `frame:release()`, `<close>`, or GC
releases it. The frame metadata reports the JPEG width, height, byte size, and
`pixel_format = "JPEG"`.

### Resource limits

This module is designed for MCU-class devices and rejects oversized images
before conversion:

- JPEG files loaded from disk are limited to 4 MiB.
- Decoded or converted frames are limited to 1920 x 1080 pixels.
- Conversion may allocate cached output buffers in PSRAM; JPEG encoding may
  also allocate a compressed output buffer and only creates an aligned input
  copy when the source buffer is not already 16-byte aligned.

Use camera resolutions and file sizes that fit the available PSRAM budget, and
release all `image.frame` views promptly. Cached buffers are frame-local and
are released when the last view for that frame is released.

### Example: snapshot to disk

```lua
local camera         = require("camera")
local image          = require("image")
local storage        = require("storage")

do
    local frame <close> = camera.get_frame(3000)
    image.save_file(storage.join_path(storage.get_root_dir(), "snapshot.jpg"), frame)
end
```

### C-side use (for module authors)

Other Lua modules can read or produce frames without going through Lua method
dispatch by linking against this component and using:

- `lua_image_push_frame(L, data, bytes, &info, release_cb, ctx)` — wrap
  a producer-owned buffer as an `image.frame` userdata. `release_cb`
  is called exactly once when the frame is released (via `frame:release()`,
  `<close>`, or `__gc`). On failure the function returns an error code and
  does not invoke `release_cb`; the caller still owns the buffer.
- `lua_image_borrow_frame(L, index, &out)` — read `data`, `bytes`, and
  `info` from the selected frame view without copying. Valid only for the
  duration of the C call; do not retain the pointer after returning to Lua.
- `lua_image_require_format(L, index, fmt, &view)` — get the
  frame in a specific format, possibly converting and caching in the shared
  store. Pair with `lua_image_release_view(&view)` and do not retain `view.data`
  after returning to Lua.

<!-- doc: lua_module_imu/README.md -->
<a id="lua-module-imu-readme"></a>

## Lua IMU

This module describes how to read IMU data from Lua.
When a request mentions `bmi270`, `icm42670`, `mpu6050`, `imu`, `accelerometer`, or `gyroscope`, use this module by default.

### How to call
Lua name: `imu`.
- Open the sensor with one of:
  - `local sensor = imu.new()` — use board defaults from the device named `imu_sensor`
  - `local sensor = imu.new("imu_sensor")` — choose a device name explicitly
  - `local sensor = imu.new({ peripheral = "i2c_master", int_gpio = 21 })` — provide options directly
  - `local sensor = imu.new("imu_sensor", { frequency = 100000 })` — board defaults + per-field overrides
- Call `local sample = sensor:read()` to get accel and gyro raw data
- Call `local temp = sensor:read_temperature()` to read the raw temperature value
- Call `local status = sensor:read_int_status()` to get the interrupt status bits
- Call `sensor:close()` when needed

### Options table
All fields are optional. Any field omitted falls back to the board
`board_devices.yaml` value for the device named by `device` (default
`"imu_sensor"`). On a board that does not declare the device, missing
required fields will raise an error.

| Field        | Type     | Meaning                                                       |
|--------------|----------|---------------------------------------------------------------|
| `device`     | string   | Board device name to read defaults from (default `imu_sensor`)|
| `peripheral` | string   | Board I2C master peripheral name (e.g. `"i2c_master"`)        |
| `i2c_addr`   | integer  | Selected backend's 7-bit I2C address (default `0x68`)         |
| `frequency`  | integer  | I2C clock in Hz (default `400000`)                            |
| `int_gpio`   | integer  | GPIO number wired to the sensor interrupt pin                 |
| `sdo_gpio`   | integer  | Optional address-select pin; for MPU6050 it drives `AD0`      |

### Data format
- `sample.accel.x`, `sample.accel.y`, `sample.accel.z`
- `sample.gyro.x`, `sample.gyro.y`, `sample.gyro.z`
- `sample.sens_time`
- `sample.status`

### Example
```lua
local imu = require("imu")

local sensor = imu.new()                  -- uses board defaults
local sample = sensor:read()
print(sample.accel.x, sample.accel.y, sample.accel.z)
print(sample.gyro.x, sample.gyro.y, sample.gyro.z)
sensor:close()
```

<!-- doc: lua_module_ir/README.md -->
<a id="lua-module-ir-readme"></a>

## Lua IR

This module describes how to use `ir` from Lua for IR transmit and receive.
When a request mentions `ir`, `infrared`, `remote control`, `learn remote`, or `send NEC`, use this module by default.

### How to call

Lua name: `ir`.
- Open the board IR device with one of:
  - `local dev = ir.new()` - use board defaults from the device named `ir_blaster`
  - `local dev = ir.new("ir_blaster")` - choose a board device name explicitly
  - `local dev = ir.new({ tx_gpio = 39, rx_gpio = 38, ctrl_gpio = 44 })` - provide options directly
  - `local dev = ir.new("ir_blaster", { carrier_hz = 38000 })` - board defaults plus per-field overrides
- Call `dev:send_nec(address, command)` to transmit a 32-bit NEC frame
- Call `dev:send_raw(symbols)` to transmit raw RMT symbols
- Call `dev:receive(timeout_ms)` to learn one IR frame
- Call `dev:info()` to inspect the resolved configuration
- Call `dev:name()` to get the device name
- Call `dev:close()` when needed

### Options table

All fields are optional when the board declares an `ir_blaster` device in `board_devices.yaml`.
On a board that does not declare the device, at least one of `tx_gpio` or `rx_gpio` must be provided.

| Field               | Type    | Meaning                                      |
|---------------------|---------|----------------------------------------------|
| `device`            | string  | Board device name to read defaults from      |
| `tx_gpio`           | integer | GPIO used by the IR transmitter              |
| `rx_gpio`           | integer | GPIO used by the IR receiver                 |
| `ctrl_gpio`         | integer | Optional GPIO that powers/enables IR circuit |
| `ctrl_active_level` | integer | Active level for `ctrl_gpio`, default `0`    |
| `carrier_hz`        | integer | IR carrier frequency, default `38000`        |
| `tx_resolution_hz`  | integer | RMT TX resolution                            |
| `rx_resolution_hz`  | integer | RMT RX resolution                            |
| `rx_max_symbols`    | integer | Maximum raw symbols to capture per frame     |

### Data format

`dev:receive(timeout_ms)` returns a symbol array, or `nil, "timeout"` if no valid frame is captured before the timeout.
Each symbol is a table:

- `symbol.level0`
- `symbol.duration0`
- `symbol.level1`
- `symbol.duration1`

`dev:info()` returns:

- `info.name`
- `info.tx_gpio`
- `info.rx_gpio`
- `info.ctrl_gpio`
- `info.carrier_hz`
- `info.tx_resolution_hz`
- `info.rx_resolution_hz`

### Example

```lua
local ir = require("ir")

local dev = ir.new("ir_blaster")
local info = dev:info()
print(info.name, info.tx_gpio, info.rx_gpio, info.carrier_hz)

local symbols, err = dev:receive(5000)
if symbols then
    dev:send_raw(symbols)
else
    print("receive failed: " .. tostring(err))
    dev:send_nec(0x00FF, 0x10EF)
end

dev:close()
```

<!-- doc: lua_module_json/README.md -->
<a id="lua-module-json-readme"></a>

## Lua JSON Module

`lua_module_json` provides JSON encode and decode helpers for Lua scripts.

```lua
local json = require("json")

local text = json.encode({
    ok = true,
    value = 3,
    list = {1, 2, "x"},
})

local data = json.decode(text)
print(data.ok, data.list[3])
```

### API

#### `json.encode(value) -> string`

Serializes a Lua value to a compact JSON string.

Supported values:

- `nil` -> `null`
- boolean -> JSON boolean
- number -> JSON number
- string -> JSON string
- table -> JSON array or object

Tables whose keys are sequential positive integers starting at `1` encode as JSON arrays. Other tables encode as JSON objects. Object keys may be strings or integers; integer keys are converted to string keys.

Unsupported Lua values, unsupported table keys, values nested too deeply, and allocation failures raise a Lua error.

#### `json.decode(text) -> value`

Parses a JSON string and returns the corresponding Lua value.

Mappings:

- JSON object -> Lua table
- JSON array -> 1-based Lua array table
- JSON string -> Lua string
- JSON number -> Lua number
- JSON boolean -> Lua boolean
- JSON `null` -> Lua `nil`

Invalid JSON raises a Lua error.

<!-- doc: lua_module_knob/README.md -->
<a id="lua-module-knob-readme"></a>

## Lua Knob

### How to call
Lua name: `knob`.
- Call `local handle = knob.new(gpio_a, gpio_b [, default_direction])` to create a knob handle
  - `gpio_a` and `gpio_b` are the two encoder signal pins
  - `default_direction`: 0 = positive increase (default), 1 = negative increase
- Call `knob.on(handle, event, callback)` to subscribe to a knob event
- Supported event names: `"left"`, `"right"`, `"h_lim"`, `"l_lim"`, `"zero"`
- Call `knob.off(handle [, event])` to remove a subscription or clear all callbacks
- Call `knob.dispatch()` to poll and dispatch pending knob events
- Call `knob.get_count(handle)` to read the current count value
- Call `knob.clear_count(handle)` to reset count to zero
- Call `knob.close(handle)` when the handle is no longer needed

### Events
| Event    | Description                    |
|----------|--------------------------------|
| `left`   | Rotated counter-clockwise      |
| `right`  | Rotated clockwise              |
| `h_lim`  | Count reached maximum limit    |
| `l_lim`  | Count reached minimum limit    |
| `zero`   | Count returned to zero         |

### Example
```lua
local knob = require("knob")

local handle = knob.new(48, 47)
knob.on(handle, "left", function(evt)
  print("left, count=" .. tostring(evt.count))
end)
knob.on(handle, "right", function(evt)
  print("right, count=" .. tostring(evt.count))
end)

knob.dispatch()
knob.close(handle)
```

<!-- doc: lua_module_led_strip/README.md -->
<a id="lua-module-led-strip-readme"></a>

## Lua LED Strip

When a request mentions `ws2812`, use this `led_strip` module by default.

### How to call
Lua name: `led_strip`.
- Call `local strip = led_strip.new(gpio, max_leds)` to create a strip handle
- Call `strip:set_pixel(index, r, g, b)` to set one pixel
- Call `strip:set_pixel_hsv(index, h, s, v)` to set one pixel using HSV
- Call `strip:refresh()` to apply changes
- Call `strip:clear()` or `strip:close()` when needed

`set_pixel_hsv` uses:
- `h`: `0-359`
- `s`: `0-255`
- `v`: `0-255`

### Example
```lua
local led_strip = require("led_strip")

local strip = led_strip.new(8, 1)
strip:set_pixel(0, 255, 0, 0)
strip:set_pixel_hsv(0, 120, 255, 64)
strip:refresh()
```

<!-- doc: lua_module_magnetometer/README.md -->
<a id="lua-module-magnetometer-readme"></a>

## Lua Magnetometer

This skill describes how to read magnetometer data from Lua.
When a request mentions `bmm350`, `bmm150`, `magnetometer`, `magnetic field`, or `compass`,
use this module by default. The active chip backend is selected at build time via
`CONFIG_LUA_MODULE_MAGNETOMETER_CHIP_*` (BMM350, BMM150, or QMC6309).

### How to call
Lua name: `magnetometer`.
- Open the sensor with one of:
  - `local sensor = magnetometer.new()` — use board defaults from `magnetometer_sensor`
  - `local sensor = magnetometer.new("magnetometer_sensor")` — choose a device name explicitly
  - `local sensor = magnetometer.new({ peripheral = "i2c_master" })` — provide options directly
  - `local sensor = magnetometer.new("magnetometer_sensor", { i2c_addr = 0x15 })` — board defaults + per-field overrides
- Call `local sample = sensor:read()` to get magnetic field data and temperature
- Call `local temp = sensor:read_temperature()` to read temperature
- Call `local status = sensor:read_int_status()` to get the raw interrupt status register
- Call `sensor:calibration_reset()` before collecting calibration samples
- Call `sensor:calibration_add_sample()` repeatedly while rotating the device in all directions
- Call `local cal = sensor:calibration_finish()` to compute and persist hard/soft iron calibration
- Call `local cal = sensor:calibration_get()` to inspect the active calibration
- Call `sensor:calibration_clear()` to clear persisted calibration
- Call `sensor:close()` when needed

### Options table
All fields are optional. Any field omitted falls back to the board
`board_devices.yaml` value for the device named by `device` (default
`"magnetometer_sensor"`). On a board that does not declare the device,
missing required fields will raise an error.

| Field        | Type    | Meaning                                                               |
|--------------|---------|-----------------------------------------------------------------------|
| `device`     | string  | Board device name to read defaults from (default `magnetometer_sensor`) |
| `peripheral` | string  | Board I2C master peripheral name (e.g. `"i2c_master"`)               |
| `i2c_addr`   | integer | 7-bit I2C address (BMM350: `0x14`/`0x15`; BMM150: `0x10`–`0x13`; QMC6309: `0x7C`) |
| `frequency`  | integer | I2C clock in Hz (default `100000`)                                   |
| `int_gpio`   | integer | Optional GPIO number wired to the sensor interrupt pin               |
| `sdo_gpio`   | integer | Optional GPIO to strap SDO/ADSEL for alternate I2C address           |

### Data format
- `sample.magnetic.x`, `sample.magnetic.y`, `sample.magnetic.z`
- `sample.raw_magnetic.x`, `sample.raw_magnetic.y`, `sample.raw_magnetic.z`
- `sample.temperature` (BMM150 and QMC6309 return `0`; no on-chip temperature)
- `sample.status`
- `sample.calibrated`

### Calibration
The module applies a simple hard-iron plus diagonal soft-iron calibration,
matching the approach used by the reference compass app.

Suggested flow:
```lua
sensor:calibration_reset()
for i = 1, 500 do
  sensor:calibration_add_sample()
end
local cal = sensor:calibration_finish()
print(cal.calibrated, cal.sample_count)
```

### Example
```lua
local magnetometer = require("magnetometer")

local sensor = magnetometer.new()
local sample = sensor:read()
print(sample.magnetic.x, sample.magnetic.y, sample.magnetic.z)
print(sample.temperature)
sensor:close()
```

<!-- doc: lua_module_sci/README.md -->
<a id="lua-module-sci-readme"></a>

## Lua DFRobot SCI

This module provides access to the DFRobot RP2040 SCI Acquisition Module
(DFR0999) from Lua. It talks to the SCI board over I2C and returns sensor data
in the DFRobot SCI string format.

### Hardware
- Connect the ESP board I2C SDA/SCL pins to the SCI board host I2C port.
- On DFRobot K10, the board-managed I2C bus is usually `port=1`, `SDA=47`,
  `SCL=48`.
- The SCI default 7-bit I2C address is `0x21`; common addresses are `0x21`,
  `0x22`, and `0x23`.
- Use `100000` Hz I2C clock unless the module has been verified at another
  speed.

### How to call
- Import it with `local sci = require("sci")`.
- Open the module with
  `local dev = sci.new(port, sda_gpio, scl_gpio [, addr [, freq_hz]])`.
- Close the handle with `dev:close()` when done.

### Common reads
- `dev:get_version()` returns `{ raw = 0x0105, text = "V1.0.5" }`.
- `dev:get_information([port_mask [, timestamp]])` returns readings such as
  `"SEN0334: Temp_Air:28.65 C,Humi_Air:30.12 %RH"`.
- `dev:get_sku([port_mask])` returns connected sensor SKUs.
- `dev:get_keys([port_mask])`, `dev:get_values([port_mask])`, and
  `dev:get_units([port_mask])` return comma-separated names, values, and units.
- `dev:get_value(key [, port_mask [, sku]])` reads values for one data name.
- `dev:get_unit(key [, port_mask [, sku]])` reads units for one data name.
- `dev:get_timestamp()` returns the SCI data refresh timestamp string.

Port masks:
- `sci.PORT1` for the A/D port
- `sci.PORT2` for I2C/UART port 2
- `sci.PORT3` for I2C/UART port 3
- `sci.ALL` for all ports

### Configuration
- `dev:set_port(1, sku)`, `dev:set_port(2, sku)`, and `dev:set_port(3, sku)`
  configure ports. Use `"NULL"` to clear a port. Use `"Analog"` for raw analog
  voltage on port 1.
- `dev:get_port(1)`, `dev:get_port(2)`, and `dev:get_port(3)` return
  `{ mode = 0|1, mode_text = "...", sku = "..." }`.
- `dev:set_refresh_rate(rate)` accepts `sci.REFRESH_MS`, `sci.REFRESH_1S`,
  `sci.REFRESH_3S`, `sci.REFRESH_5S`, `sci.REFRESH_10S`,
  `sci.REFRESH_30S`, `sci.REFRESH_1MIN`, `sci.REFRESH_5MIN`, or
  `sci.REFRESH_10MIN`.
- `dev:get_refresh_rate()` returns `{ rate = enum_value, ms = milliseconds }`.
- `dev:enable_record()` / `dev:disable_record()` control SCI CSV recording.
- `dev:oled_on()` / `dev:oled_off()` control the SCI onboard display.
- `dev:get_supported_skus(kind)` where `kind` is `"analog"`, `"digital"`,
  `"i2c"`, or `"uart"` returns the supported SKU list.

Methods that configure the SCI return the DFRobot SCI error code. `0` means
success.

### Example
```lua
local sci = require("sci")

local dev = sci.new(1, 47, 48, 0x21, 100000)
dev:set_refresh_rate(sci.REFRESH_1S)

local version = dev:get_version()
print("SCI firmware: " .. version.text)
print("SKUs: " .. dev:get_sku(sci.ALL))
print("Readings: " .. dev:get_information(sci.ALL, true))

dev:close()
```

If the SCI board is not found, run `builtin/sci_probe.lua`. It tries the K10
I2C bus plus common external I2C pin pairs and SCI addresses `0x21`, `0x22`,
and `0x23`, then prints the first working version/SKU/information response.

<!-- doc: lua_module_storage/README.md -->
<a id="lua-module-storage-readme"></a>

## Lua Storage

### How to call
Lua name: `storage`.
- Call `storage.get_root_dir()` to get the storage root directory
- Call `storage.join_path(...)` to join path segments with one `/`
- Call `storage.exists(path)` to check whether a path exists
- Call `storage.stat(path)` to get path metadata, or `nil, err` if it does not exist
- Call `storage.mkdir(path)` to create a directory
- Call `storage.write_file(path, content)` to write a file
- Call `storage.read_file(path)` to read a file
- Call `storage.listdir(path)` to list directory entries
- Call `storage.remove(path)` to remove a file or empty directory
- Call `storage.rename(old_path, new_path)` to rename or move a path
- Call `storage.get_free_space()` to get `{ total, free, used }` bytes for the storage root

### Path joining
- Prefer `storage.join_path(...)` whenever building a path from `storage.get_root_dir()` and child names.
- Pass each path component as a separate string argument, for example `storage.join_path(root, "logs", "today.txt")`.
- `join_path` removes duplicate separators between components, so `storage.join_path(storage.get_root_dir(), "/demo/", "test.txt")` returns `<storage_root>/demo/test.txt`.
- Empty string components are ignored, so optional subdirectories can be passed directly when they may be empty.
- The first component decides whether the result is absolute. Use `storage.get_root_dir()` as the first component for filesystem paths in this demo.
- Do not put multiple logical components in one string when they can be separate arguments; `storage.join_path(root, "demo", filename)` is easier to audit than `storage.join_path(root, "demo/" .. filename)`.
- `join_path` only joins strings. It does not create directories, validate that a path exists, or prevent `..` path traversal.

### Example
```lua
local storage = require("storage")

local root = storage.get_root_dir()
local dir = storage.join_path(root, "demo")
local file = storage.join_path(dir, "test.txt")
local log_file = storage.join_path(root, "logs", "today.txt")

storage.mkdir(dir)
storage.write_file(file, "hello")
local text = storage.read_file(file)

if storage.exists(file) then
    local info = storage.stat(file)
    local entries = storage.listdir(dir)
    local space = storage.get_free_space()
end
```

<!-- doc: lua_module_system/README.md -->
<a id="lua-module-system-readme"></a>

## Lua System

### How to call
Lua name: `system`.
- This module does not require manual initialization after `require`

### API

| Call | Inputs and defaults | Return | Error or condition |
|---|---|---|---|
| `system.time()` | None | Unix timestamp in seconds (`number`) | Raises an error when the clock is unset |
| `system.date(format)` | Optional string; default `"%Y-%m-%d %H:%M:%S"` | Local `strftime` text (`string`) | Raises an error for a long format or empty result |
| `system.millis()` | None | Device uptime in milliseconds (`number`) | — |
| `system.uptime()` | None | Device uptime in seconds (`integer`) | — |
| `system.ip()` | None | Wi-Fi STA IPv4 address (`string`) | Returns `nil` when disconnected or unassigned |

#### `system.info()`
- Inputs: none
- Output: `table`
- Returns a table with these possible fields:
  - `uptime_s`: `integer`, uptime in seconds
  - `time`: `number`, current Unix timestamp in seconds
  - `date`: `string`, formatted local time as `%Y-%m-%d %H:%M:%S`
  - `sram_free`: `integer`, free internal SRAM bytes
  - `sram_total`: `integer`, total internal SRAM bytes
  - `sram_largest`: `integer`, largest free internal SRAM block in bytes
  - `psram_free`: `integer`, free PSRAM bytes, present only when PSRAM exists
  - `psram_total`: `integer`, total PSRAM bytes, present only when PSRAM exists
  - `wifi_rssi`: `integer`, connected AP RSSI, present only when Wi-Fi STA is connected
  - `wifi_ssid`: `string`, connected AP SSID, present only when available

#### `system.heap`
- Type: `table`
- Provides heap and task stack introspection helpers
- `system.heap.caps`: heap capability flags such as `DEFAULT`, `INTERNAL`, `SPIRAM`, `DMA`, `BIT8`, and `BIT32`
- `system.heap.get_info(caps)`: returns heap statistics for the selected capability flags
- `system.heap.get_task_watermarks()`: returns stack high-water marks for tasks
- `system.heap.get_current_task()`: returns stack high-water mark information for the current task

`system.heap.get_info(caps)` returns a table with these fields:
- `caps`: `integer`, capability flags used for the query
- `total_size`: `integer`, total heap size for the capability flags
- `free_size`: `integer`, free bytes
- `allocated_size`: `integer`, allocated bytes
- `minimum_free_size`: `integer`, minimum free bytes observed
- `largest_free_block`: `integer`, largest free block in bytes
- `allocated_blocks`: `integer`, allocated block count
- `free_blocks`: `integer`, free block count
- `total_blocks`: `integer`, total block count

### Example
```lua
local system = require("system")

print(system.time())
print(system.date("%Y-%m-%d %H:%M:%S"))
print(system.millis())
print(system.uptime())
print(system.ip())

local info = system.info()
print(info.sram_free)

local heap_info = system.heap.get_info(system.heap.caps.DEFAULT)
print(heap_info.free_size, heap_info.largest_free_block)

local task = system.heap.get_current_task()
print(task.name, task.stack_high_water_mark_bytes)
```

<!-- doc: lua_module_system/lib/arg_schema.md -->
<a id="lua-module-system-lib-arg-schema"></a>

## arg_schema

`arg_schema` normalizes the global `args` table into predictable Lua values before a script uses hardware APIs or long-running logic.

Load it with:

```lua
local arg_schema = require("arg_schema")
```

This library is a normalization helper, not a strict validator. It does not return validation errors. Bad or missing input is converted to configured defaults.

### Typical Pattern

Define the schema once near the top of the script, parse `args` once, then use the returned context table everywhere.

```lua
local arg_schema = require("arg_schema")

local ctx = arg_schema.parse(args, {
    io = arg_schema.int({ default = 38, min = 0 }),
    enabled = arg_schema.bool({ default = true }),
    color = arg_schema.object({
        fields = {
            r = arg_schema.int({ default = 255, min = 0, max = 255 }),
            g = arg_schema.int({ default = 255, min = 0, max = 255 }),
            b = arg_schema.int({ default = 255, min = 0, max = 255 }),
        },
    }),
})
```

After parsing, read `ctx.io`, `ctx.enabled`, and `ctx.color` instead of reading `args` directly.

### `arg_schema.int(options)`

Use this for GPIOs, brightness, coordinates, counts, durations, indexes, and other numeric parameters.

Options:
- `default`: value used when the input is not a number.
- `min`: optional lower bound.
- `max`: optional upper bound.
- `floor`: numbers are floored by default. Set `floor = false` only when the target API accepts decimals.

Behavior:
- Non-number input returns `default`.
- Number input is floored unless `floor = false`.
- The result is clamped to `min` and `max` when those bounds are provided.

### `arg_schema.bool(options)`

Use this for switches and flags.

Options:
- `default`: value used when the input is not a boolean.

Behavior:
- Boolean input is preserved.
- Non-boolean input returns `default`.

### `arg_schema.object(options)`

Use this for nested groups such as colors, dimensions, or grouped hardware settings.

Options:
- `fields`: nested schema table. Each field is normalized with its own spec.
- `default`: table of fallback values copied into missing normalized fields.

Behavior:
- Table input is used as the source object.
- Non-table input is treated as an empty object.
- Only fields declared in `fields` are normalized.
- Missing normalized fields can be filled from `default`.

### `arg_schema.parse(raw_args, schema)`

Normalize `raw_args` with a schema table and return a new table.

Behavior:
- If `raw_args` is not a table, it is treated as `{}`.
- The returned table contains one normalized value for each schema key.
- The original `args` table is not mutated.

Example:

```lua
local ctx = arg_schema.parse(args, {
    duration_ms = arg_schema.int({ default = 30000, min = 1 }),
    enabled = arg_schema.bool({ default = true }),
})
```

### Practical Rules

- Always set explicit defaults for values passed to hardware APIs.
- Clamp GPIOs, colors, sizes, counters, and indexes before passing them into modules.
- Use `floor = false` only for APIs that explicitly accept decimals.
- Keep the schema close to the top of the file so script inputs are easy to inspect.
- Do not use this library when invalid input must be rejected with a user-facing error; write explicit validation for that case.

<!-- doc: lua_module_thread/README.md -->
<a id="lua-module-thread-readme"></a>

## Thread Lua module

`thread` provides Lua job management and named FreeRTOS-backed synchronization
objects shared by independent Lua async jobs.

### API

#### `thread`

- `thread.run(path, args, opts)` runs an absolute `.lua` path
  synchronously and returns `true, output` or `nil, err`.
- `thread.start(path, args, opts)` starts an async Lua job and returns
  `true, output` or `nil, err`.
- `thread.list(status)` lists async jobs. `status` may be `all`,
  `queued`, `running`, `done`, `failed`, `timeout`, `stopped`, or nil.
- `thread.get(job_id_or_name)` returns job status, summary, and logs.
- `thread.stop(job_id_or_name, wait_ms)` requests cooperative stop.

`args` must be a table or nil. It is encoded as a JSON object and becomes the
child script's global `args` table. `opts.timeout_ms` controls runtime timeout;
async timeout `0` means run until cancelled. Async `opts` also accepts `name`,
`exclusive`, and `replace`.

#### `thread.sync`

- `thread.sync.queue_create(name, opts)` creates a queue. `opts.depth` defaults
  to `8` and is limited to `1..32`; `opts.item_size` defaults to `256` and is
  limited to `1..4096`.
- `thread.sync.queue_send(name, value, timeout_ms)` sends a Lua string as raw
  bytes. The string may contain `\0` bytes and must be no larger than the
  queue's `item_size`.
- `thread.sync.queue_recv(name, timeout_ms)` returns the received raw byte
  string. It returns `nil, "timeout"` on timeout and `nil, "stopped"` when the
  Lua job is stopped.
- `thread.sync.queue_delete(name)` deletes an idle empty queue. Queues with
  waiters or pending messages return `nil, "busy"`.
- `thread.sync.sem_create(name, opts)` creates a counting semaphore.
  `opts.max` is `1..255` and `opts.initial` is `0..max`.
- `thread.sync.sem_give(name)` gives a semaphore.
- `thread.sync.sem_take(name, timeout_ms)` returns `true` on success,
  `false, "timeout"` on timeout, and `false, "stopped"` when the Lua job is
  stopped.
- `thread.sync.sem_delete(name)` deletes an idle semaphore.
- `thread.sync.lock_create(name)` creates a mutex lock.
- `thread.sync.lock(name, timeout_ms)` returns `true` on success,
  `false, "timeout"` on timeout, and `false, "stopped"` when the Lua job is
  stopped.
- `thread.sync.unlock(name)` unlocks a mutex. Only the Lua job task that
  acquired it can unlock it.
- `thread.sync.lock_delete(name)` deletes an idle unlocked mutex.

Timeouts default to `0`, which means non-blocking. Permanent blocking is not
provided in the first version.

### Example

```lua
local thread = require("thread")

local ok, output = thread.run("/system/skills/builtin_lua_modules/scripts/builtin/test/thread_child_a.lua", {
    mode = "sync",
}, {
    timeout_ms = 5000,
})
assert(ok, output)
print(output)

thread.sync.queue_create("ui_cmd", { depth = 8, item_size = 2048 })
thread.sync.queue_send("ui_cmd", "set_text\0hello", 1000)
local msg, err = thread.sync.queue_recv("ui_cmd", 500)
thread.sync.queue_delete("ui_cmd")
```

<!-- doc: lua_module_vision/README.md -->
<a id="lua-module-vision-readme"></a>

## lua_module_vision

Lua vision modules backed by `image.frame` buffers.

### Modules

- `motion_detect`: compares two `image.frame` objects and returns the number of changed sample points. Enabled by default with `LUA_MODULE_VISION_MOTION_DETECT`.
- `espdet`: runs ESP-DL ESPDet object detection from Lua with a user-provided `.espdl` model file. Enable with `LUA_MODULE_VISION_ESPDET`.

All functions read the frame only during the call. Release frames with `frame:release()` after the vision call returns.
Frame conversion is handled by the shared `image` module, so Lua scripts pass the frame object directly instead of selecting RGB/YUV/GRAY conversion paths.

### Examples

```lua
local camera = require("camera")
local display = require("display")
local image = require("image")
local motion = require("motion_detect")

camera.open("/dev/video0")

local f1 = camera.get_frame()
local first = motion.detect(f1, { stride = 4, pixel_threshold = 0.04, moving_threshold = 0.03 })
f1:release()

local f2 = camera.get_frame()
local m = motion.detect(f2, { stride = 4, pixel_threshold = 0.04, moving_threshold = 0.03 })
print("moving ratio", m.moving_ratio, "moving points", m.moving_points, "moved", m.moved)
f2:release()

camera.close()
```

The same captured raw frame can be displayed and analyzed before it is released:

```lua
local frame = camera.get_frame(3000)
local rgb565 <close> = image.convert(frame, image.RGB565)
display.draw_image(0, 0, rgb565, {
    mode = "fit",
    width = display.width,
    height = display.height,
})
local result = motion.detect(frame, { stride = 8, pixel_threshold = 0.04, moving_threshold = 0.03 })
frame:release()
```

ESPDet with a JPEG file:

```lua
local espdet = require("espdet")
local image = require("image")
local storage = require("storage")

local root = storage.get_root_dir()
local model_path = storage.join_path(root, "test", "espdet_pico_224_224_cat.espdl")
local image_path = storage.join_path(root, "test", "cat.jpg")

espdet.load(model_path, { score_threshold = 0.6 })

local source <close> = image.load_file(image_path)
local result = espdet.detect(source, { score_threshold = 0.6 })

print("detection count=" .. tostring(result.count))
espdet.unload()
```

### Notes

- Supported source frame formats for motion: `RGB3`, `BGR3`, `GREY`, `Y800`, `RGBP`, `RGBR`, `YUYV`, `UYVY`, `JPEG`, and `MJPG`.
- Display preview should convert the camera frame through `image.convert(frame, image.RGB565)` and pass the RGB565 frame view to `display.draw_image()`. If the same source frame is also used for motion detection, `motion.detect(frame, opts)` can request GRAY8 and reuse the cached RGB565 path internally.
- `pixel_threshold` is a per-sample gray-value ratio threshold in `[0, 1]`; `0.04` is about a 10-level gray difference.
- `moving_threshold` is a moving sample ratio threshold in `[0, 1]`; `0.03` means more than 3% of sampled points must change.
- Detection results include `moving_points`, `sample_points`, and `moving_ratio = moving_points / sample_points`.
- `motion.detect(frame, opts)` compares `frame` with an internal copy of the previous frame and then updates that copy.
- `motion.detect(frame1, frame2, opts)` compares two explicit frames.
- `motion.reset()` clears the internal previous-frame copy.
- Import ESPDet with `local espdet = require("espdet")`.
- `espdet.detect(frame, opts)` accepts an `image.frame` and internally requests RGB565LE through the shared `image` module.
- Load a model once with `espdet.load(path[, opts])`, or pass `opts.model_path` on each `detect()` call.
- Raw byte input is interpreted as RGB565LE: `espdet.detect(data, width, height[, opts])`.
- Detection results include `count`; each detection includes `category`, `score`, `box`, `left`, `top`, `right`, `bottom`, `x`, `y`, `width`, and `height`.

### Console Test

```text
lua --run --path <DATA_ROOT>/scripts/builtin/test/espdet_image.lua --args-json "{\"image_path\":\"<DATA_ROOT>/test/cat.jpg\",\"model_path\":\"<DATA_ROOT>/test/espdet_pico_224_224_cat.espdl\",\"score_threshold\":0.6}" --timeout-ms 60000
```
