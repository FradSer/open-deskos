# CM5 and ESP32-S31 study

This historical study records a proposed radio bridge and the first CM5 test.
Use [PRODUCT.md](../../PRODUCT.md) for product scope and [Shell context](../../runtime/shell/CONTEXT.md) for runtime architecture.
No S31 network bridge is accepted as a product capability.

## Recorded hardware assumptions

The study used `OrangePi_CM5_Base_RK3588S_用户手册_v1.3.pdf` and S31 Function CoreBoard-1 documentation.
These facts are the study inputs.
Check the current hardware documentation before a new design.

| Board | Recorded facts |
| --- | --- |
| CM5 | RK3588S, 4 A76 + 4 A55 cores, up to 2.4GHz, Mali-G610, 6 TOPS NPU |
| CM5 memory | 2/4/8/16GB LPDDR4/4X; 32/64/128/256GB eMMC |
| CM5 Base | Three 100-pin DF40C connectors; PCIe/SATA, USB, MIPI CSI/DSI, SDIO/RGMII, I2S, UART, SPI, I2C, CAN, GPIO |
| Base ports | USB 3.1/2.0, HDMI 2.1, four MIPI CSI inputs, Gigabit Ethernet, two 2.5G ports, TF, 12-pin expansion |
| CM5 power | Fixed 5V, 4–5A. Power USB-C has no USB-PD. Flashing/ADB does not imply USB networking |
| S31 | Dual-core 32-bit RISC-V, up to 320MHz, 60 GPIO, 512KB SRAM, DDR PSRAM support |
| S31 radio | 2.4GHz Wi-Fi 6, Bluetooth 5.4 LE/BR/EDR, IEEE 802.15.4, Gigabit Ethernet MAC |
| S31 board | USB 2.0 HS OTG wired as USB-A Host, up to 500mA; separate full-speed Serial/JTAG and USB-UART connectors |
| S31 board audio/network | RJ45, microphone, ES8311, NS4150B, speaker connector |

The CM5 module has no documented built-in Wi-Fi.
Use a baseboard radio, USB adapter, or separate controller.
The S31 board is not a ready-made USB Wi-Fi adapter.

## Proposed sequence

1. Use a USB Wi-Fi adapter for CM5 networking. This path does not depend on S31.
2. Test S31 firmware, ESP-NOW, and Bluetooth HID through the board's Ethernet connection.
3. Connect CM5 to S31 through UART at 921600. Start with control, status, and ESP-NOW traffic.
4. Add IP transport only if the product requires S31 networking. Measure throughput, recovery, restart, and security.
5. Consider SPI, a new carrier, or USB Device mode only after the host protocol works.

CM5 owns Linux services, inference, media, files, protocols, and applications.
S31 would own radio links and optional HID.
A proposed UART frame uses a length prefix and CRC16.
Types are `CONTROL`, `WIFI_STATUS`, `ESP_NOW_TX`, `ESP_NOW_RX`, and optional `IP_PACKET`.
SPI needs DMA, flow control, and Linux driver work.
The board's USB-A Host wiring cannot directly provide USB Device networking.
Do not assume that P4/C6 esp-hosted support includes S31.
Check the IDF, slave, and Linux host versions first.
ESP-NOW and Bluetooth share the 2.4GHz radio.
Do not promise deterministic keyboard latency.
A dedicated Nordic radio remains an alternative.

## First CM5 test — 2026-08-23

Host: real CM5, aarch64, Debian 12 bookworm, 16GB RAM.
The host had no physical screen.
Xvfb supplied the display.

- Installer completed dependency setup, arm64 Electron 43.4.1 installation, and startup registration through `scripts/start-kiosk.sh`.
- Smoke passed at 568×1232 and 480×854. AIODI tokens, seven layout sizes, and architecture checks passed.
- All 81 interaction/accessibility/geometry/plugin E2E checks passed with exit 0.
- Architecture, OS, Electron, smoke, and shared-library checks passed. Touch, desktop-session, and startup-session checks failed because those devices/sessions were absent.
- Repairs added root `--no-sandbox` handling, a large enough Xvfb screen (`-screen 0 568x1232x24`), visible fixture windows for software-rendered frames, and standalone root `DESIGN.md` support in `check_tokens.mjs`.

This is device execution with a virtual display.
It does not prove physical GPU output, evdev touch, or desktop startup recovery.
After an authorized screen connection, run `runtime/shell/scripts/cm5-acceptance.sh` and retain its evidence.
