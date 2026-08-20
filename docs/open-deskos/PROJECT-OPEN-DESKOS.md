# Open DeskOS — 桌面伴侣操作系统(产品定位已迁移至 OPEN-DESKOS.md)

> **2026-07-07 起产品定位与路线图由 [OPEN-DESKOS.md](OPEN-DESKOS.md) 取代**:本文原写的"以 HID 模拟为核心的富功能输入设备"已升级为桌面 OS 设备(928×262 横置触摸条 + macOS 常驻端)。原"第一~五期"路线图重排进 Open DeskOS 的 M0~M5 里程碑与 §13"v1 之后"。
> **本文继续作为权威的**:芯片角色(P4/C6 分工)、硬约束、风险表、BOM/工程量概览、文档索引。这些被 Open DeskOS §2 沿用,不再重述。阅读任何子系统规格前先读 Open DeskOS §2 处置表。
> 基于 ESP32-P4 + ESP32-C6;Open DeskOS 固件尚未开工。

## 执行摘要

**本项目不是一台追求打字手感与超高采样率的"真实键盘",而是一台以 HID 形态接入电脑、功能丰富的智能输入设备。** 它把屏幕 UI、语音输入(语音→云端 ASR/LLM→文字)、宏/自动化、生态控制等"软输入"统一转成标准 HID 事件喂给电脑。

- **MVP(第一期)= 纯有线,仅 ESP32-P4 + ESP32-C6。** P4 经 USB-HS 枚举为复合 HID(键盘/消费控制/鼠标/厂商通道)+ 驱动 3.19" AMOLED 触摸屏 + 编排语音;C6 经 esp-hosted 做 Wi-Fi 网卡跑云端 ASR/LLM,**并作 ESP-NOW 节点与桌面外设交换数据**;电脑端配一个**自研轻量客户端**(经厂商 HID 通道收文本,负责中文/Unicode 注入)。
- **整机以 P4 为唯一主控**:矩阵、屏、麦克风、音频、C6 全挂 P4 下。
- **无线键盘链路 = 可选未来扩展**(非主线,可能不做)。若做，优先评估 **ESP32-S31** 的 Bluetooth HID + ESP-NOW 组合；若需要严格的射频隔离和确定性，再加 Nordic nRF54L15 + nRF52840 dongle。CM5 主脑迁移另见 [CM5-S31-INTEGRATION.md](CM5-S31-INTEGRATION.md)。
- **有线音频 = UAC**(USB Audio Class),不含 AirPlay。AirPlay 仅随无线扩展。
- **总体评估:有条件可行 (YES with caveats)。** MVP 工程量约 11–16 人月(含主机客户端与 ESP-NOW);有线主线只剩 C6 单射频,RF 基本无忧。

## 这是什么,不是什么

- **不是**:追求亚毫秒延迟、8000Hz 采样的电竞键盘(Wooting/Razer 用更简单架构做得更好)。
- **是**:以 HID 形态接入电脑的富功能输入设备——有屏、能语音输入、能跑宏、能做桌面生态枢纽,所有功能最终以标准 HID 事件注入电脑,免驱通用。

## 核心设计原则

1. **HID 优先**:任何功能的"输入"最终归一化为 HID 报告,电脑端零驱动。
2. **软输入为主,硬键为辅**:屏幕、语音、宏是差异化;物理键矩阵是标准件,可后置。
3. **够用即可的延迟**:1000Hz 基准,不为采样率堆砌专用射频。
4. **射频隔离优先**(无线扩展时):HID 链路用 Nordic 专用射频,与 C6 Wi-Fi 物理隔离。

## MVP 目标

| 目标 | 验收基准 |
|---|---|
| 有线 HID(P4 USB) | 插任意电脑免驱枚举为复合 HID,可注入按键与文本(ASCII) |
| C6 联网(esp-hosted) | P4 借 C6 做 Wi-Fi 网卡,能稳定访问云端 ASR/LLM 服务 |
| ESP-NOW 数据交换 | C6 与至少一个桌面外设节点稳定双向收发状态报文,屏上可见 |
| 屏 UI 与触摸(P4 + LVGL) | 3.19" AMOLED 显示连接/语音/外设状态,帧率 ≥ 30fps;触摸可操作 UI |
| 软输入注入 | 屏幕 UI/宏触发的按键序列可稳定上屏 |
| 语音输入 | 语音键 → 云端 ASR/LLM → 文本经 HID 上屏(英文纯 HID;中文经厂商通道 + 自研客户端),屏上显示状态 |
| 主机客户端 | 自研客户端经厂商 HID 通道收 UTF-8 文本并稳定注入中文/Unicode |

## 芯片角色

| 芯片 | 角色 |
|---|---|
| **ESP32-P4** | 算力 + 小屏 + 有线 USB-HID + 语音/UI 编排中枢。双核 RISC-V @400MHz,USB 2.0 HS OTG,MIPI-DSI,I2S,SDIO。 |
| **ESP32-C6** | Wi-Fi 6 / BLE 5.3 / 802.15.4 协处理器。经 esp-hosted 为 P4 提供网络;负责云端 ASR/LLM 通道与 ESP-NOW 外设数据交换。 |
| **ESP32-S31（候选）** | CM5/RK3588S 迁移路线的 Wi-Fi 6、Bluetooth 5.4、802.15.4、ESP-NOW 协处理器；与 CM5 的 UART/SPI/USB host protocol 尚需验证。 |

> CM5/RK3588S 迁移时，ESP32-S31 不直接替换本表中的 P4 主控；它只替代无线协处理器角色。CM5 核心板没有板载 Wi‑Fi，CM5 直接上网仍需 USB Wi‑Fi、底板网络接口或已验证的 S31 host protocol。

## 硬约束

- **中文/Unicode 无法用纯 HID 扫描码打出** — 英文/ASCII 纯 HID 即插即用;中文上屏需电脑端轻量客户端(Unicode 注入),该客户端已纳入 MVP 范围(自研)。
- **自由听写无法在本机芯片上离线完成** — ESP32 级无 NPU;本地(ESP-SR)只能做唤醒词/固定命令;自由听写须走**云端**或**主机侧**。

## 路线图

1. **第一期(MVP)= 纯有线,仅 P4 + C6。** 复合 HID + 触摸屏 UI + 语音→云端 ASR/LLM→文本上屏(英文纯 HID;中文经自研客户端)+ ESP-NOW 外设数据交换。**基准**:免驱枚举、ASCII 注入稳定、中文经客户端上屏、屏 ≥ 30fps、ESP-NOW 双向收发稳定。
2. **第二期:体验完善。** 本地 ESP-SR 唤醒/命令词、宏引擎、屏上转写确认增强、BLE 配网、客户端功能扩展(配置/固件升级)。
3. **第三期:生态扩展。** 更多 ESP-NOW 外设(含快充充电站);可选 Matter。
4. **第四期:有线音频 = UAC。** 复合 USB 加 UAC 声卡端点(加接口须升 bcdDevice 或换 PID,避免 Windows 复合设备驱动缓存问题)。**基准**:电脑识别为声卡、播放稳定。
4. **可选扩展(未来):无线版 + AirPlay。** ESP32-S31 Bluetooth HID + ESP-NOW 组合优先验证；若需严格射频隔离，再采用 Nordic 专用射频。详见 [DESIGN-EXTENSIONS.md](./DESIGN-EXTENSIONS.md)。

## BOM 与工程量概览

| 项 | 估算 |
|---|---|
| 键盘本体 BOM(主线有线,量产) | 约 $22–44 |
| MVP 工程量(含客户端与 ESP-NOW) | 约 11–16 人月 |
| 全程工程量(含扩展) | 约 27–40 人月 |

> 详见 [SPEC-MVP.md](./SPEC-MVP.md) §十八(工程量明细)和 §十一(功率预算/BOM)。

## 风险评估(概要)

| 风险 | 概率 | 缓解 |
|---|---|---|
| 中文无法纯 HID 上屏 | 高(确定) | MVP 即配自研客户端经厂商 HID 通道做 Unicode 注入 |
| 自由听写依赖云 | 高(确定) | 云端 ASR/LLM 为主;本地 ESP-SR 仅命令词 |
| C6 单射频多负载争用(Wi-Fi + ESP-NOW) | 中 | 均为突发/低频;ESP-NOW 锁 C6 当前 Wi-Fi 信道,单射频可扛 |
| esp-hosted SDIO 未决缺陷(#184 入站停滞、#167 状态崩溃) | 中 | Opus 上传减压;分段 / UART 降级;P4+C6 主线仍必须做心跳复位。CM5 迁移不沿用 esp-hosted，改评估 S31 host protocol |
| ESP-NOW 无法经 esp-hosted 透传给 P4 | 高(已核实,v2.12.9 无此能力) | P4+C6 主线：ESP-NOW 逻辑驻留 C6，经 Peer Data Transfer；SDIO 不稳则 UART 旁路。CM5/S31 迁移不沿用该路径，改用 CM5↔S31 host protocol |

## 文档索引

| 文档 | 内容 | 目标读者 |
|---|---|---|
| **[SPEC-MVP.md](./SPEC-MVP.md)** | MVP 实施规格:系统框图、HID 规格、USB 描述符、厂商通道协议、ESP-NOW 子系统、功率预算、固件架构、引脚分配、I2C 映射、配网流程、esp-hosted 回退、启动序列、硬件底座、验收基准 | 实施者 |
| **[DESIGN-EXTENSIONS.md](./DESIGN-EXTENSIONS.md)** | 可选扩展设计:无线 HID 链路(Nordic)、AirPlay 音频、矩阵双主控、RF 共存、生态枢纽、快充充电站 | 未来的自己 |
| **[FACT-CHECK.md](./FACT-CHECK.md)** | 规格核对、术语表、Caveats、多轮事实核查与修订记录 | 审计/回溯 |
| **[CM5-S31-INTEGRATION.md](./CM5-S31-INTEGRATION.md)** | Orange Pi CM5/RK3588S + ESP32-S31 迁移候选：CM5 网络、S31 无线、UART/SPI host protocol、验证顺序 | 迁移评估 |
| **[LUMINA-P4.md](../lumina-p4/LUMINA-P4.md)** | 姊妹产品：便携大功率 HiFi 音箱（ESP32-P4 主控，由 Lumina-CM5/RK3588S 改作）。已锁定决策 + 3S 电源树 + 子系统裁决 | 硬件设计 |
| **[LUMINA-P4-DESIGN-SPEC.md](../lumina-p4/LUMINA-P4-DESIGN-SPEC.md)** | LUMINA-P4 完整硬件设计规格：系统框图、3S 电源树、HiFi 音频（TAS5825M DSP 时序）、显示/存储/USB、引脚分配表、I2C 映射、BOM 增量、早验闸口 | 硬件设计 |
| **[LUMINA-P4-POWER.md](../lumina-p4/LUMINA-P4-POWER.md)** | LM5122 双相升压详算（3S→24V/~100W）：占空比/电流/电感/MOSFET/电容/热 + 须 TI 计算器终算项 | 电源详算 |
| **[LUMINA-P4-PLAN.md](../lumina-p4/LUMINA-P4-PLAN.md)** | 实施计划：第 0 周五项早验闸口（GO/NO-GO）、分阶段工程量（~7–11 人月）、关键路径、风险登记 | 实施 |
| **[kicad/](../../kicad/)** | KiCad 代码生成工程：`components.json`（器件/引脚/网络单一数据源）+ `gen_project.py`（骨架，含 I2C/GPIO 预算校验）+ README（工作流） | 硬件工程 |
| **[firmware/](../../firmware/)** | ESP-IDF 固件骨架：A/B/C 运行模式状态机（`mode_manager`）+ 引脚映射（`lumina_p4_pins.h`）+ 启动序列（`app_main`）；子系统驱动为桩，待 PLAN P2–P5 | 固件 |
| **[LUMINA-P4-REVIEW.md](../lumina-p4/LUMINA-P4-REVIEW.md)** | LUMINA-P4 的四路独立 Agent 反思（去重裁决）：Tier1 阻塞项、固件工程量、漏掉的维度、代理冲突裁决、修订清单——审计/回溯用 | 审计/回溯 |
| **[GUITION-JC4880P443.md](../reference/GUITION-JC4880P443.md)** | 原样导入自姊妹项目 pulse-esp：Guition JC4880P443（ESP32-P4+C6）开发板硬件资料——ST7701 MIPI-DSI 完整时序/初始化序列、GT911 触摸配置、silicon rev/PSRAM/flash Kconfig。**与 LUMINA-P4 无直接关系**（不同屏幕/触摸芯片、不同开发板），仅作资料留存 | 硬件参考 |

---

*关键规格经多轮四路独立核查(详见 [FACT-CHECK.md](./FACT-CHECK.md))。*
