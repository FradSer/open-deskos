# Open DeskOS S3 Remote Control

Required architecture peripheral for the active CM5/Linux runtime. It is distinct from the preserved prior P4+C6 DeskOS device OS.

Standalone ESP-IDF firmware for the **Waveshare ESP32-S3 Touch LCD 2.8**. It
uses the board's native USB-OTG port as one composite USB device:

- a boot-protocol HID keyboard, used to send `ArrowLeft` and `ArrowRight`;
- a CDC ACM serial interface that receives newline-delimited authoritative v1 state JSON.

The touch UI is English-only. It renders fixed ASCII page labels (`HOME`,
`APPS`, `USAGE`) from the authoritative page number rather than rendering the
shell's page-name field. This avoids unsupported UTF-8 glyph rendering on the
small display. The two large targets across the lower half of the 240x320
display emit the corresponding arrow key. A horizontal swipe of at least 48
pixels sends one navigation key: left-to-right emits `ArrowLeft`; right-to-left
emits `ArrowRight`.

## State protocol

Before the first valid CDC state frame, the screen only says `Connecting to Open
DeskOS` and `Waiting for CDC state`; it does not claim that a host is connected.
HID remains usable in both directions as soon as the USB keyboard enumerates,
including while the CDC state link is synchronizing. Write exactly one
authoritative v1 JSON record per newline to the CDC device:

```json
{"v":1,"type":"state","page":1,"pages":3,"name":"Home","canPrev":false,"canNext":true,"link":"wired"}
```

The parser requires `v: 1`, `type: "state"`, positive integer `page` and
`pages`, a non-empty string `name`, boolean `canPrev` and `canNext`, and
`link: "wired"` or `link: "wireless"`. It rejects frames when `page > pages`
or the boundary flags contradict the page number. A valid frame displays its
English page label, `page/pages`, and visibly mutes the unavailable left or
right target; only after that frame does firmware suppress HID navigation at
the reported boundary. The implementation uses cJSON to decode each line, caps
a line at 255 bytes, and retains the last valid display state when it receives
invalid or oversized input.

On Linux the CDC device normally appears as `/dev/ttyACM0`. For example:

```sh
printf '%s\n' '{"v":1,"type":"state","page":1,"pages":3,"name":"Home","canPrev":false,"canNext":true,"link":"wired"}' > /dev/ttyACM0
```

## Hardware map

The map was verified against the local Waveshare reference at
`/Users/FradSer/Documents/Home Lab/esp32-keyboard`:

| Peripheral | Pins |
| --- | --- |
| ST7789 SPI display | MOSI GPIO45, SCLK GPIO40, CS GPIO42, DC GPIO41, RST GPIO39 |
| Display backlight | GPIO5, LEDC 20 kHz |
| CST328 touch | I2C1 SDA GPIO1, SCL GPIO3, RST GPIO2, address `0x1A` |
| Panel power latch | key GPIO6, control GPIO7 |
| HID + CDC | ESP32-S3 native USB-OTG |

The native USB-OTG port is not the same endpoint as USB Serial/JTAG. Its USB
product descriptor is exactly `Open DeskOS Remote`, which is the unique product
name Remote Bridge searches under `/dev/serial/by-id/`; do not rename it without
updating Bridge discovery. After flashing OTG firmware, hold **BOOT**, tap
**RESET**, then flash again if the usual serial/JTAG download path is unavailable.

## Build and flash

This project requires ESP-IDF **6.0.1** and its ESP32-S3 tools. It pins the
Espressif `esp_tinyusb` component in `main/idf_component.yml`.

```sh
cd peripherals/esp32-s3-remote

# First configuration downloads the managed TinyUSB component.
eim run 'idf.py set-target esp32s3' v6.0.1
eim run 'idf.py build' v6.0.1

# Replace PORT with the board's download port, e.g. /dev/ttyACM0 on Linux.
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

Stop the monitor with `Ctrl-C`. The firmware's ordinary log console is UART0;
the USB CDC endpoint is reserved for the state protocol.

## BDD scenarios

The behavior contract is in
[`tests/features/remote-control.feature`](tests/features/remote-control.feature).
