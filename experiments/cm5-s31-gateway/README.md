# CM5–ESP32-S31 集成决策

> 本文针对 Orange Pi CM5 Base（RK3588S）与 ESP32-S31 的验证架构。它不替代 `OPEN-DESKOS.md` 或 `SPEC-MVP.md`，而是定义 CM5 迁移/验证路线。

## 1. 手册核对结论

`OrangePi_CM5_Base_RK3588S_用户手册_v1.3.pdf` 明确了以下硬件事实：

- CM5 核心板是 RK3588S：4×A76 + 4×A55、最高 2.4GHz、Mali-G610、6 TOPS NPU。
- 核心板有 2/4/8/16GB LPDDR4/4X 和 32/64/128/256GB eMMC 选项。
- CM5 Base 通过 3×100-pin DF40C 连接器引出 PCIe/SATA、USB、MIPI CSI/DSI、SDIO/RGMII、I2S、UART、SPI、I2C、CAN、GPIO 等接口。
- Base 底板提供 USB 3.1、USB 2.0、HDMI 2.1、4 路 MIPI CSI、千兆网口、2 路 2.5G 网口、TF 卡、12-pin 扩展口和 5V/4–5A 供电。
- 手册没有把 CM5 核心板描述为自带 Wi-Fi；无线网络通过底板/USB 外设或其他协处理器提供。
- 对外 USB-C 供电口只接受固定 5V，不支持 USB-PD；烧录/ADB 使用另一种 USB 数据拓扑，不能把“USB 能烧录”误认为“USB 网络设备”。
- RK3588S 的 NPU、Linux、eMMC、USB Host、网络和多媒体能力是 CM5 方案相对于 MCU 方案的核心价值。

## 2. S31 验证板核对结论

Espressif 官方 ESP32-S31 页面和 Function CoreBoard-1 文档显示：

- ESP32-S31 是双核 32-bit RISC-V，最高 320MHz，60 GPIO，512KB 片上 SRAM，并支持 DDR PSRAM。
- 集成 2.4GHz Wi‑Fi 6、Bluetooth 5.4（LE + BR/EDR）、IEEE 802.15.4，以及千兆 Ethernet MAC。
- 芯片有 USB 2.0 HS OTG，但 Function CoreBoard-1 将该 OTG 口接成 **USB-A Host**，最多给外设 500mA。
- 板上 USB-C Serial/JTAG 口是 USB Full-Speed 调试/烧录/通信口；另一个 USB-C 是 USB-to-UART 桥。
- 板上还集成 RJ45 千兆 Ethernet、麦克风、ES8311、NS4150B 和扬声器接口。
- 因此该开发板适合验证 S31 的无线、蓝牙、网络和外围能力，但不能直接视为一个现成的“USB Wi‑Fi dongle”。

## 3. 推荐系统拓扑

### 验证阶段

```text
CM5 / RK3588S Linux
  ├─ USB Wi‑Fi dongle       ← 立即验证 CM5 直接上网
  └─ UART 921600             ← S31 控制/状态/ESP-NOW 桥接验证
       │
ESP32-S31 Function CoreBoard-1
  ├─ Wi‑Fi 6 STA             ← S31 自己联网
  ├─ Bluetooth HID           ← 与 Mac 配对验证
  └─ ESP-NOW                 ← 连接桌面外设
```

### 产品阶段候选拓扑

```text
CM5 Linux ── UART/SPI ── ESP32-S31 ── Wi‑Fi 6 ── Internet
                         └─ ESP-NOW ── 外设
                         └─ Bluetooth HID ── Mac（可选）
```

CM5 仍是主脑：运行 Linux 服务、NPU 推理、媒体/文件服务、协议编排和应用；S31 只负责无线链路、蓝牙 HID 和 ESP-NOW。

## 4. “CM5 通过 S31 上网”的边界

这条链路**架构上可行，但不是买板即插即用**。必须在 S31 固件和 CM5 Linux 端定义一种 host protocol：

- UART：首选原型链路，适合控制、状态、ESP-NOW 和低/中吞吐网络代理。
- SPI：后续用于更高吞吐；需要额外 DMA、流控和 Linux spidev/内核驱动设计。
- USB OTG Device：理论上可做自定义 USB 网络类，但 Function CoreBoard-1 的 USB-A 已经是 Host，不能直接使用该路径。
- Ethernet：Function CoreBoard-1 的 RJ45 可作为 S31 网络验证入口，但它不是 CM5 与 S31 之间的无线协处理链路。
- esp-hosted：不能因为 C6/P4 已有方案就默认 S31 现成兼容；必须先确认当前 ESP-IDF、esp-hosted slave、Linux host 是否正式支持 S31。未确认前，不把它列为主路线。

第一版 host protocol 可采用长度前缀 + CRC16 的 UART 帧，分为 `CONTROL`、`WIFI_STATUS`、`ESP_NOW_TX`、`ESP_NOW_RX` 和可选 `IP_PACKET`。若目标只是让 CM5 访问网络，优先使用 USB Wi‑Fi dongle，不要先自研 IP-over-UART。

## 5. 蓝牙 HID 与 ESP-NOW

ESP32-S31 官方规格包含 Bluetooth 5.4（LE + BR/EDR）和 ESP-NOW 所需的 Wi‑Fi 射频能力，因此可以分别验证：

- S31 → Mac：Bluetooth HID（键盘/消费控制/鼠标，具体 HID profile 需在 IDF/协议栈上验证）。
- S31 → 外设：ESP-NOW 状态和控制报文。
- 两者可在芯片上共存，但 Wi‑Fi/ESP-NOW 与 Bluetooth 共享 2.4GHz 射频，属于时分共存，不是物理隔离。

所以 S31 适合做 CM5 的“无线边缘控制器”，但不应把 S31 的 Bluetooth HID + ESP-NOW 组合承诺为受严格时延保证的无线键盘链路。若未来需要确定性 HID，仍保留 Nordic 专用射频方案作为备选。

## 6. 推荐验证顺序

1. 购买 ESP32-S31 Function CoreBoard-1；先用板载 RJ45 验证 S31 固件、ESP-NOW 和 Bluetooth HID，排除 Wi‑Fi 配网变量。
2. CM5 先用 USB Wi‑Fi dongle 验证 Linux 网络、云服务、NPU/应用链路；这条路径不依赖 S31。
3. 用 UART 把 CM5 与 S31 连接，先实现控制/状态/ESP-NOW bridge，不传 IP 数据。
4. 若确实需要“CM5 的网络由 S31 提供”，再做 UART/SPI host protocol，并测吞吐、断线恢复、重启和网络安全。
5. 只有在 host protocol 成立后，才评估自制 CM5 carrier 上的 S31 模组、USB OTG Device 或 SPI 连接。

## 7. 对原设计的修订

- 原“CM5 + C6，经 UART 做 ESP-NOW bridge”可以升级为“CM5 + S31，经 UART/SPI 做无线协处理器”。
- 原“用 S3 替代 C6”不再是准确表述；在 CM5 迁移路线中应改为“评估 S31 替代 C6”。
- P4+C6 的 esp-hosted 路线仍保留为 Open DeskOS/P4 既有实现，不自动迁移到 CM5+S31。
- `ESP-NOW` 是 S31 的无线外设协议；`CM5 上网` 是另一条独立需求，除非实现 host protocol，否则不要把两者混写成“插上 USB 就能共享 Wi‑Fi”。

**结论：**可以买 S31 开发板做验证，但第一目标应是验证 S31 无线/蓝牙/ESP-NOW，以及 CM5 通过 UART 控制它；CM5 直接上网仍应先用 USB Wi‑Fi dongle。S31 作为 CM5 的 Wi‑Fi 协处理器是第二阶段工程，不是开发板的即插即用功能。

## 8. CM5 应用链路首片与首次上机记录（2026-08-23）

`runtime/linux/`（Electron 外壳）已在真机 CM5（aarch64，Debian 12 bookworm，16GB RAM）完成无屏首次上机。设备无物理面板，显示层用 Xvfb 模拟。

**验证通过：**

- `scripts/cm5-install.sh` 全流程：apt 依赖、npm 装 arm64 Electron v43.4.1、自启项注册（Exec 指向 `scripts/start-kiosk.sh`）。
- smoke 两种分辨率（568×1232、480×854）、AIODI token 对齐、布局 7 尺寸、架构契约（骨架纯净/核心无专名）全绿。
- e2e 81 项交互/可访问性/几何/插件契约全绿（exit 0）。
- 验收脚本：arch/os-release/electron/smoke-run/shared-libs 全过；失败项均为无屏实况（无触摸设备、无桌面会话、无自启会话）。

**真机发现并已修复：**

1. root 会话下 Chromium 拒绝启动（需 `--no-sandbox`）；`run.sh` 检测 root 自动附加。
2. Xvfb 默认屏幕小于窗口时高度被钳制；无屏测试需 `-screen 0 568x1232x24`。
3. 无 GPU 时隐藏窗口不产帧，CSS 过渡时间线冻结，`getBoundingClientRect` 停在过渡起点；e2e 窗口改为可见。
4. `check_tokens.mjs` 兼容独立部署形态（切片根 DESIGN.md）；部署同步需包含仓库根 DESIGN.md。
5. 安装器版本打印在 root 下需带 `--no-sandbox`。

**待接屏验证：**GPU 合成上屏、真实 evdev 触摸、桌面会话自启恢复。接屏后重跑 `scripts/cm5-acceptance.sh` 留存证据。

**Related:** [[open-deskos-rpi-migration-eval]] [[open-deskos-top-spec]] [[open-deskos-p4-c6-esp-hosted-up]]
