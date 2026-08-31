---
name: cerberus-rpi-migration-eval
description: "Orange Pi CM5/RK3588S + ESP32-S31 迁移候选：CM5 主脑与独立联网，S31 负责 Wi-Fi 6、Bluetooth HID 和 ESP-NOW"
type: project
---

当前迁移候选是 **Orange Pi CM5/RK3588S + ESP32-S31**，不是此前记录的“通用 RPi + C6 + S3”组合。

- CM5/RK3588S 负责 Linux、NPU、应用、文件/媒体、主机服务和高层 UI。
- ESP32-S31 负责 Wi-Fi 6、Bluetooth 5.4、ESP-NOW，以及可选的低功耗实时控制。
- CM5 Base 手册列出 1×千兆 Ethernet、2×2.5G Ethernet、USB 3.1、USB 2.0 和 12-pin UART/SPI/I2C/CAN/GPIO；没有把板载 Wi-Fi 列为功能。CM5 直接上网优先走 Ethernet，最终无网口时再加入 Linux 支持的 USB Wi-Fi、PCIe 或 SDIO 模块。
- S31 Function CoreBoard-1 的 USB-A 是 S31 的 USB Host；USB-C 是 Serial/JTAG 或 USB-to-UART，不是现成的 USB Wi-Fi dongle。不能默认“USB 插到 CM5 就共享 S31 Wi-Fi”。
- CM5↔S31 的第一版链路采用 3.3V UART（推荐长度前缀 + CRC16）；SPI 作为高吞吐候选。S31 的 IP-over-UART、USB CDC-ECM/RNDIS 或 esp-hosted 兼容性均需单独验证，不作为已知能力。
- S31 的 Bluetooth HID 与 ESP-NOW 可以并存验证，但 Wi-Fi/ESP-NOW 与 Bluetooth 共享 2.4GHz 射频；先限制为低频状态/控制报文，不把它当作确定性低延迟无线 HID。严格 RF 隔离仍保留 Nordic 方案。
- ESP-NOW 对端必须是兼容 ESP32 系列设备，RK3588S/Linux 不能直接作为 ESP-NOW peer。CM5 如需参与，使用 UART/SPI/USB 接 S31/C6 网关，或直接使用标准 IP 网络。

**验证顺序：**
1. CM5 用 Ethernet 或 USB Wi-Fi 验证 Linux 直接上网、云服务、NPU 和应用链路。
2. S31 用官方 Function CoreBoard-1 验证 Wi-Fi 6、Bluetooth HID、ESP-NOW 和无线共存。
3. 用 CM5 12-pin 扩展 UART 接 S31，验证控制、状态和 ESP-NOW bridge。
4. 只有在需要 S31 代替 CM5 网络外设时，才实现并测量 IP host protocol。

**Why:** CM5 的计算、Linux 和 NPU 能力不能由 S31 替代；CM5 的联网与 S31 的无线外设职责也不应通过未经验证的网络桥接强耦合。把两者拆开可先得到可工作的端到端原型，再决定是否值得做定制载板。

**How to apply:**
- 新文档引用 [experiments/cm5-s31-gateway/README.md](../experiments/cm5-s31-gateway/README.md)。
- 不再把 S3 写成当前迁移方案，也不把 C6 esp-hosted 直接套到 S31。
- P4+C6 的既有事实仍只适用于 P4 基线；CM5/S31 是独立迁移分支。

**Related:** [[cerberus-p4-swipe-direct-live]] [[cerberus-p4-c6-esp-hosted-up]] [[cerberus-native-sdl-sim]]
