# Open DeskOS 事实核查与规格参考

> 本文档从 PROJECT-OPEN-DESKOS.md 拆分而来,用于独立查阅规格声明与审计追溯。

---

## 关键规格参考

- **ESP32-P4**:双核 HP @最高 400MHz(CoreMark 6.92/MHz 在 360MHz 实测)+ LP @40MHz,768KB L2MEM,8KB SPM,16/32MB 片内 PSRAM(OPI/HPI)/最高 64MB 外部虚拟地址,USB 2.0 HS OTG+FS(每微帧 4+4),MIPI-DSI 2-lane×1.5Gbps(DPHY v1.1)/CSI,PPA,H.264 硬件编码(解码为推断)+ JPEG 硬件编解码,SDIO 3.0 Host,**无原生无线**;最低供电 380mA;MIPI D-PHY 2.25–2.75V。
- **ESP32-C6**:HP @160MHz + LP @20MHz,512KB SRAM,Wi-Fi 6(仅 2.4GHz)/BLE 5.3/802.15.4,**单一共享 2.4G 射频**,**无蓝牙经典/A2DP**,**无可做 HID 的原生 USB**(仅 USB-Serial/JTAG);共存默认启用、动态时分。
- **Nordic 专用 HID 链路(可选扩展,非主线)**:nRF54L15(Cortex-M33 @128MHz,1.5MB NVM/256KB RAM,ESB/Gazell 私有最高 4Mbps,**无 USB**,设备端)+ nRF52840(USB-FS,ESB/Gazell,BLE 5,PCA10059,dongle 端,USB-FS → 1000Hz)。ESB:GFSK,星型 1 PRX + 最多 8 PTX,自动重传 + ACK 携带载荷;Gazell 叠加跳频/共存。可两端均用 nRF52840 简化物料。
- **ESP-NOW(已否决做 HID,仅生态用)**:≤20 对等(加密 ≤17/默 7)、单包 ≤250B(v2.0 1470B)、默 1Mbps、MAC 层 ACK、锁 Wi-Fi 信道;通信反馈 1.115ms(arXiv 2507.16594 Table IV,为通信分量)。因共享 C6 单射频、无法与 Wi-Fi 隔离,不用于 HID 链路。
- **ESP32-S31**：双核 RISC-V @320MHz、60 GPIO、512KB SRAM；集成 Wi-Fi 6、Bluetooth 5.4（LE + BR/EDR）、802.15.4、千兆 Ethernet MAC、USB 2.0 HS OTG。S31 是 CM5/RK3588S 迁移路线的无线协处理器候选，CM5↔S31 的 host protocol 仍需实测。
- **ESP32-S3**：不再作为本项目的无线协处理器或 HID 结论；历史 S3 资料仅保留为背景，不作为当前方案。
- **Telink 备选**:TLSR9218(RISC-V @96MHz,1MB 9218A/2MB 9218H,BLE 5.3,genfsk/TPLL 500k/1M/2Mbps);TL3228/TL322x(2026,CES 演示)192MHz、BT 6.0、私有 HDT 6Mbps,面向 8000Hz。

---

## CM5/S31 迁移候选事实

以下结论来自 Orange Pi CM5 Base 用户手册 v1.3 与 Espressif ESP32-S31 官方产品/开发板资料；它们只约束迁移候选，不改 P4+C6 基线。

- **Orange Pi CM5 Base**：核心板为 RK3588S，具备 Linux、LPDDR4/4X、eMMC、6 TOPS NPU、GPU/VPU 和丰富的 PCIe/USB/MIPI 接口；底板提供 1×千兆 Ethernet、2×2.5G Ethernet、USB 3.1、USB 2.0、4×MIPI CSI、HDMI 和 12-pin UART/SPI/I2C/CAN/GPIO 扩展。
- **CM5 网络**：该手册没有把板载 Wi‑Fi 列为 CM5 Base 功能；CM5 可直接用 Ethernet 上网，也可通过 Linux 支持的 USB Wi‑Fi 模块或自定义 PCIe/SDIO 模块补无线。手册中的 USB Wi‑Fi 示例不代表所有芯片均免驱。
- **CM5 供电/USB 边界**：Base 的 Type-C 供电口只接受固定 5V，不支持 PD；USB 烧录/ADB、USB Host 和对外设备数据是不同路径，不能把烧录口当作现成网络接口。
- **ESP32-S31**：官方规格为双核 32-bit RISC-V、最高 320MHz、60 GPIO、512KB SRAM；支持 2.4GHz Wi‑Fi 6、Bluetooth 5.4（LE + BR/EDR）、802.15.4、千兆 Ethernet MAC 和 USB 2.0 HS OTG。
- **S31 Function CoreBoard-1**：板载 RJ45 可验证 S31 自身 Ethernet；USB-A 连接 S31 的 HS OTG 且配置为 Host；两个 USB-C 分别用于 Serial/JTAG 和 USB-to-UART。因此它不是可直接插入 CM5、由 Linux 自动识别的 USB Wi‑Fi dongle。
- **S31 与 CM5 的关系**：S31 可以作为 CM5 的无线协处理器，但 UART/SPI/USB host protocol 需要自定义和实测；在确认前，不得假设现有 P4+C6 esp-hosted slave 或 Linux host 驱动可直接移植到 S31。
- **ESP-NOW 边界**：ESP-NOW 对端需要 ESP32 系列等兼容实现，RK3588S/Linux 不能直接作为 ESP-NOW peer。CM5 若要参与，需经 UART/SPI/USB 接一个 S31/C6 网关，或直接使用标准 IP 网络。
- **S31 Bluetooth HID + ESP-NOW**：两者可以作为验证方向并存，但 Wi‑Fi/ESP-NOW 与 Bluetooth 仍需按共享 2.4GHz 射频的共存场景实测；低频控制/状态交换可以先做，高吞吐网络或确定性无线 HID 不应未经测试承诺。

**迁移决策**：CM5 直接上网与 S31 无线协处理是两条独立需求。第一版用 CM5 Ethernet 或 USB Wi‑Fi 验证 Linux 网络，用 UART 连接 S31；只有确有必要时，才开发 S31→CM5 的 IP/网络 host protocol。

---

## 术语表

| 术语 | 含义 |
|---|---|
| HID | Human Interface Device,USB 免驱人机接口设备类 |
| HID report | 设备发给主机的输入报告(键盘位图/Usage ID 等) |
| Usage ID | HID 规范中每个键/控件的编号 |
| NKRO | N-Key Rollover,全键无冲(位图式报告) |
| ASR | Automatic Speech Recognition,语音识别 |
| VAD | Voice Activity Detection,语音端点检测 |
| ESP-NOW | Espressif 基于 Wi-Fi MAC 的免连接 2.4G 协议 |
| ESB/Gazell | Nordic 私有 2.4G 协议(GFSK)/其上的跳频层 |
| esp-hosted | P4 借 C6 做 Wi-Fi 协处理器的方案 |
| UAC | USB Audio Class,USB 音频设备类 |
| ESP-SR | Espressif 语音识别框架(WakeNet 唤醒 + MultiNet 命令词) |
| PTA | Packet Traffic Arbitration,多射频共存仲裁 |

---

## 重要 Caveats

- HID 扫描码受电脑当前键盘布局解释:英文/ASCII 通,**中文/Unicode 需电脑端客户端注入**(自研客户端已纳入 MVP,经厂商 HID 通道,见 SPEC-MVP.md §3.6)。
- **自由听写本机离线不可行**(无 NPU);本地仅 ESP-SR 命令词,自由听写靠云端/主机。
- 商用"1ms"(Lightspeed/HyperSpeed)仅指链路轮询,整机端到端约 5–10ms,勿当端到端;本项目不以采样率为目标。
- ESP-NOW 1.115ms 为通信反馈分量(arXiv 2507.16594),非端到端 RTT(该实验整体 RTT 3662ms);80µs 广播抖动为 Arduino 论坛社区实测,出处性质不同。
- **esp-hosted 入站 TCP 大流量卡顿**(GitHub #184/EHM-206,约 88–105KB 后停滞):P4+C6 主线仍按“未确认修复”处理并实施复测；CM5/S31 迁移不默认使用 esp-hosted，改做独立 host protocol 验证。
- 天线隔离 45/50dB 引述对应 +20dBm Wi-Fi 工况(Silicon Labs AN1017,现重定向至 docs.silabs.com);设备内典型仅 15–20 dB(UG103-17),故必须依赖 PTA。
- P4 整板功耗官方未公布确定值;网传 devkit 60mA+/33mA 未经证实(芯片级深睡为 µA 级)。
- 规格以 2026 公开数据手册为准;nRF54L15 数据手册仍为预发布版本;P4 主频 360/400MHz 以拿到硅版本为准。

---

## 事实核查与修订记录

本文经四路独立核查(Espressif / Nordic·Telink·延迟 / 音频·esp-hosted·RF / 外围器件·算术)对照一手数据手册与原始来源逐条复核。**2026-06-08 二次核查**针对重组后的完整文档再次启动四路 agent(P4/C6+Nordic/音频/外围器件),核查 59 项声明。

**已核实属实**:A2DP 仅初代 ESP32 支持、C6 BLE-only、pschatzmann wiki 引文逐字、Silicon Labs AN1017 的 45/50dB 引文逐字、esp-hosted #184(88–105KB)、Nordic `pkt_len_tx_w_ack_2mbps_us(5,30)=305µs`、arXiv 2507.16594 与 1.115ms/48ms、ESP-NOW 20/17/7 与 250B/1Mbps、TL3228 6Mbps/8K(CES 2026)、nRF54L15/52840 规格、带宽算式、音频编解码器与显示器件规格、MIPI 对小屏为过度配置、**C6 无可做 HID 的原生 USB(仅 USB-Serial/JTAG)**。

**二次核查(2026-06-08)新增确认**:P4 全 12 项规格(USB-HS 4+4、380mA 供电、SPM、MIPI D-PHY 2.25–2.75V、SDIO 3.0、无原生无线 等)均与 v1.3 datasheet 一致;C6 全 6 项(512KB SRAM、共享单射频、无经典蓝牙/USB HID、共存默认启用+动态时分)均与 datasheet/Kconfig 源码一致;Nordic 全 6 项(nRF54L15 无 USB、nRF52840 USB-FS → 1000Hz、ESB 星型 1+8、Gazell AFH、双端可用 nRF52840)均与 Nordic 官方一致;RF 共存引文(UG103-17 15–20dB、AN1017/UG103-17 45/50dB)逐字核实;ESP-NOW 全参数(20 对等/17 加密/250B+1470B/1Mbps/MAC ACK/锁信道)与 esp-idf v6.0.1 文档一致;TMUX1574 规格(TI datasheet Rev.C:Ron 2Ω typ/4.5Ω max、TSSOP/SOT-23/UQFN 封装、EN 通路 µs 级)全部核实;霍尔 ADC 时序(P4 ADC 100Ksps → 10µs → 80 键 800µs ≫ 125µs)核实;板上器件(TS3USB221A、ES8311、NS4150、LMA3729T421-OA1、SY7200、55+9 GPIO)经 CNX Software 报道核实;音频编解码器(PCM5102A 112dB/384kHz、ES8388 ESP-ADF 支持、MAX98357A 3.2W@4Ω filterless)经 TI/ADI datasheet 核实;**UAC + HID 复合设备在 P4 TinyUSB 框架下可行**(ESP-IDF USB Device Stack 文档 + usb_device_uac component)。

**已修订的错误/夸大**:

| 项 | 原值(错) | 修订为(对) |
|---|---|---|
| P4 USB-HS 每微帧事务 | 8 非周期 + 16 周期 | 4 非周期 + 4 周期,16 host channel |
| P4 最低供电电流 | 0.5A / 500mA | 380mA(官方) |
| P4 片内 PSRAM 带宽 | 40–60 MB/s | ~185 MB/s(HEX,200MHz);40–60 为旧 Quad-SPI |
| P4 "TCM" | 8KB TCM | 8KB SPM(Scratchpad) |
| P4 PPA 块尺寸 | 最大 32×32 | 官方无此上限 |
| P4 H.264 | 编解码 | 硬件编码 + 软件解码 |
| P4 MIPI D-PHY 供电 | 固定 2.5V | 2.25–2.75V(典型 2.5V) |
| C6 共存开关 | 需手动启用,非默认 | 默认启用(Kconfig default y) |
| C6 共存优先级 | 固定 Wi-Fi>BLE>802.15.4 | 动态时分,802.15.4 空闲 RX 最低 |
| 天线隔离 | 10–15 dB | 15–20 dB(UG103-17 典型) |
| TMUX1574 导通电阻 | 3.5Ω | ~2Ω(max 4.5Ω) |
| TMUX1574 封装 | QFN-16 3×3mm | TSSOP-16 / SOT-23-THIN-16 / UQFN-16(无该 QFN) |
| 霍尔 ADC 单次采样 | ~4µs(250Ksps) | ~10µs(P4 ADC 上限约 100Ksps);80 键 = 800µs |
| A2DP `#error` 文本 | (上一轮误判为"编造") | 实际源码确认就是 `"ESP32C3, ESP32S2, ESP32S3... do not support A2DP"`(GitHub commit f275b82f);上一轮"纠错"反而纠错,本轮已恢复原引文 |
| CO6300 描述 | "CO6300 为面板/模组名" | CO6300 **也是 Chipone 的 OLED 驱动 IC**(有独立 datasheet,标题 "OLED Smart Watch Display Driver IC"),与 ICNA3312 为同厂相关/兼容型号;部分面板商将两者并列为替代料 |
| SW3518S 厂商英文名 | "Southchip" | 应为 **iSmartWare**(珠海智融科技);Southchip(南芯)是另一家独立充电芯片厂商 |
| AirPlay 2 CPU 门槛 | ≥ Pi Zero 2 W | ≥ 树莓派 2 / Zero 2 W(shairport-sync 当前 AIRPLAY2.md master;旧 development 分支写 Pi Model B) |
| TLSR9218 高容量型号 | 9218B | 9218H(官方命名) |
| TLSR9218 BLE 版本 | 5.2 | 5.3(现行 9218A) |

**已加澄清(方向对但需限定)**:ESP-NOW 1.115ms 为通信延迟分量而非端到端 RTT;esp-hosted #184 引文为转述;Nordic 空口 108µs 算式字段拆解不严谨(2Mbps 前导为 2 字节),改为量级估算;TLSR9218 硬件键扫矩阵规格未能从公开源证实;P4 devkit 功耗数字未经官方证实。

**二次核查(2026-06-08)新增澄清**:
- **esp-hosted 卡顿 issue 编号**:卡顿现象发生在 `espressif/esp-hosted-mcu` 仓库的 Issue #184(标记 EHM-206),而非旧仓库 `espressif/esp-hosted` 的 #184(那是个无关的 kernel 4.14 构建问题);核心现象(P4+C6 SDIO 在 ~100KB 入站 TCP 后停滞)属实,但"88–105KB"与"SDIO 反压未处理"为 issue 报告方描述,Espressif 尚未在可见线程中完全确认。
- **AirPlay 开源实现命名**:squeezelite-esp32 与 airplay-esp32 已核实;`shairport-esp32` 作为独立 GitHub 项目名未找到(可能是对 airplay-esp32 所引用的 shairport-sync 参考的泛称),使用时建议直接指向 airplay-esp32。
- **AirPlay 2 CPU 门槛表述**:shairport-sync 当前 AIRPLAY2.md (master) 推荐 "Raspberry Pi 2 or Raspberry Pi Zero 2 W, or better"(commit 97fefb43);旧 development 分支写的是 "Pi B or better"。本文档已更新为 master 的更高要求。
- **P4 PSRAM ~185 MB/s 带宽**:为社区 memcpy 实测,官方 datasheet 未列此数字,文档已标为"优化后实测(社区)"。
- **P4 H.264 解码**:datasheet 只明示 "H264 encoder" 硬件,未提解码;"解码为软件"为推断,措辞已加"implied"。
- **Yuying AM319M262928ZS 型号**:3.19" 262×928 MIPI AMOLED 为多家通用件,但"Yuying"品牌下该具体型号未在公开渠道直接搜到(同规格面板多以 RM690C0 为驱动 IC);仍以用户实际拿到面板为准。

---

## 三次修订(2026-06-12):文档自洽性修复 + 需求对齐 + esp-hosted 架构核查

本轮针对文档内部矛盾与新明确的产品诉求(屏幕交互 / ESP-NOW 外设数据交换 / 自研主机客户端)做了一次整体修订,并对 esp-hosted-mcu 做了专项核查。

**已修订的文档内部矛盾**:

| 项 | 原状(矛盾) | 修订为 |
|---|---|---|
| MVP 描述符含 UAC | 路线图把 UAC 放第四期,但 SPEC §一框图/§3.1 描述符树/§3.2 端点/§3.3 带宽均按含 UAC 设计 | MVP 描述符为纯 HID 复合设备(4 接口);UAC 留第四期,加接口时升 bcdDevice/换 PID(Windows 复合设备驱动缓存) |
| 厂商通道双方案混用 | §3.1 写 Vendor class (0xFF) + Bulk 512B,§3.4 写 vendor HID report (0xFF00, Report ID 0x03) | 统一为 **vendor HID 接口 + 64B 中断端点**:免驱(hidapi),避免 WinUSB/libusb 安装;新增 §3.6 帧协议 |
| 键盘 boot protocol | SubClass=Boot(0x01) 但 Protocol=0 | Protocol=1(Keyboard),保证 BIOS/UEFI 可用 |
| Report ID 残留 | 各功能独立接口却带 Report ID 0x01/0x02/0x03(单接口多报告设计的残留) | 每接口单一报告类型,不使用 Report ID |
| 鼠标支持不完整 | §2.3 提了一句"可选",描述符树/端点/报告大纲均缺失 | 补全 If 2 鼠标接口(boot mouse,5B 报告,触摸驱动) |
| 音频环形缓冲算术 | 区域标 ~256KB,括号内自算 = 320KB | 统一为 ~320KB |
| LVGL 双缓冲数值 | 一处 ≈970KB、一处 ≈950KB | 统一为 ≈950KB(262×928×2B×2 = 972,544 B) |
| 任务核分配 | 网络/TLS/ASR 上传与 1ms HID 任务同挤 Core 1 | Core 1 = 强实时(HID/矩阵/USB/采集);Core 0 = 网络/TLS/ESP-NOW 桥接/UI;`task_cloud_llm` 栈升至 24KB(P4 侧 mbedTLS) |

**esp-hosted-mcu 专项核查(2026-06-12,来源:Espressif developer blog 2025-09 esp-wifi-remote、esp-hosted-mcu README/docs、ESP Component Registry)**:

- **TCP/IP 与 TLS 归属修正(原文错误)**:原文写 C6"负责 TCP/IP 栈、TLS"——**错**。esp-hosted-mcu 架构下 **lwIP 与 mbedTLS 运行在 host(P4)侧**,esp-hosted 在 host/slave 间传 802.3 帧,slave(C6)只跑 802.11 驱动、无 IP 栈(Espressif 博客原文:"The TCP/IP stack runs only on the host side")。文档已全面更正。
- **ESP-NOW 不透传(已核实)**:截至 v2.12.9(2026-06-08),esp_wifi_remote / esp-hosted-mcu 的 111 项 RPC 清单中**无任何 ESP-NOW 条目**,无相关示例与 feature request。官方扩展机制为 **CustomRPC**(v2.8.1 起,RPC ID 388 / 事件 789,protobuf),但无 ESP-NOW 现成示例。SPEC §六 据此把"C6 驻留 ESP-NOW + CustomRPC 桥接"定为既定方案。
- **Issue #184(EHM-206)现状更新**:已于 **2026-05-19 由报告者本人关闭**,无关联 PR/修复版本记录,v2.12.x CHANGELOG 无对应条目(v2.12.8 的 SDIO PSRAM 缓冲选项或可缓解)。结论:**"已关闭、未确认修复"**,实施初期须在 ≥2.12.9 上复测入站大流量。
- **版本基线**:esp-hosted-mcu 当前稳定 2.12.9(经 ESP Component Registry 分发,GitHub 无 Releases;另有 3.0.0-rc1);要求 ESP-IDF ≥5.3(当前稳定 5.5.3 / 6.0.1)。

**需求对齐(非纠错,范围变更)**:ESP-NOW 外设数据交换、触摸屏交互、自研主机客户端(中文/Unicode 注入)自二/三期提前至 MVP;配网首选方案改为 USB 厂商通道下发凭据(有线设备最自然);语音管线表述从"云 ASR"扩展为"云端 ASR/LLM";物理键矩阵明确为可后置、不在 MVP 验收内;MVP 工程量 8–11 → 11–16 人月,全程 27–37 → 27–40 人月。

---

## 四次核查(2026-06-12,设计验证轮):三路独立检索对总体架构的验证与修订

针对"整体设计是否正确"启动三路独立检索(esp-hosted/ESP-NOW 共存、USB 复合 HID/客户端注入、语音→云端管线),结论:**架构主干逐层验证通过,四处修订已落入 SPEC**。

**验证通过(新增确认)**:

- **P4+C6 SDIO esp-hosted = Espressif 官方参考架构**(ESP32-P4-Function-EV-Board 即此结构);独立实测(r4d10n/esp32p4-c6-wifi-test)SDIO 40MHz + HT20 下 TCP 收 ~36 / 发 ~40 Mbps,瓶颈为 C6 单核 160MHz。
- **ESP-NOW + STA 共存官方支持**:ESP-IDF C6 共存表 ESP-NOW RX 标"S"(稳定)/TX 标"Y";硬约束 = 锁 AP 信道、peer `channel=0` 自动跟随、回调在 Wi-Fi 任务上下文不得阻塞——与 SPEC §六 设计一致。
- **Peer Data Transfer API 实名核实**:esp-hosted-mcu 现行机制名为 `custom_data`/Peer Data Transfer,API 为 `esp_hosted_send_custom_data` / `esp_hosted_register_custom_callback`,单包实测上限 ~8166B;slave 固件为可扩展 ESP-IDF 工程,`slave/main/example_peer_data_transfer.c`(约 200 行)即模板——比三次修订时的假设("无现成示例,需自写胶水层")**更乐观**。
- **TinyUSB 多 HID 复合**:`CFG_TUD_HID` 多实例自 v0.9.0、P4 HS 设备模式自 v0.18.0;P4 HS = EP0 外 15 端点、最多 8 并发 IN,本设计占 5。部分 legacy BIOS 只枚举第一个 HID 接口 → 键盘必须 If 0;boot 协议固定报告无 Report ID,与"不使用 Report ID"决策互证;固件须实现 `tud_hid_set_protocol_cb`。
- **vendor HID 通道 = 业界标准**:QMK Raw HID(0xFF60)/Logitech(0xFF00)同款;Windows 各 collection 独立枚举、免权限;Linux 需 udev `uaccess` 规则。
- **语音→云端先例密集**:ElatoAI(OpenAI 官方 Cookbook,ESP32-S3 + Realtime,Opus 12kbps/WSS)、小智 ESP32(70+ 板型含 P4,Opus+WSS)、Willow(端到端 300–700ms @本地服务器)、ESPHome/HA 语音助手;流式 WSS 为 2026 MCU ASR 标准。
- **esp_audio_codec ≥v2.4.0 Opus 编码器明确支持 P4**(S3 实测 ~25% 单核 @48kHz;P4 有 PIE 128-bit SIMD)。
- **ESP-SR v2.x 官方支持 P4**(WakeNet9/MultiNet7/AFE 全列 P4);MultiNet 仅命令词(≤300 条),不能自由听写——二期本地命令词计划成立。
- **C5 无优势**:C5 双频但**单射频**,"5GHz STA + 2.4GHz ESP-NOW 同时跑"物理不可能;esp-hosted 对 C5 支持(#115 NimBLE 超时)不如 C6 成熟。C6 选型维持。

**修正(本轮口头结论纠错)**:初步检索曾结论"macOS 打开 vendor HID 接口不触发 Input Monitoring"——**更正**:TCC 对 `IOHIDManager` 打开**任何** HID 设备生效,不分 usage page;另有 hidapi #266(复合设备 vendor 接口在部分 macOS 版本枚举失败)。客户端按"Input Monitoring(读设备)+ Accessibility(注入)双授权"设计,SPEC §3.6 已更新。

**状态矛盾记录**:#184 两轮核查结论不一(GitHub API 显示 2026-05-19 已关闭无修复 vs 检索称仍开放)——一律按"未确认修复"处理;新增确认开放缺陷 #167(SDIO 状态不可恢复崩溃,多硬件复现)、#180、#144。

**据此落入 SPEC 的四项设计修订**:① 音频上传默认 Opus(12–24kbps)+ WSS 流式,裸 PCM+整段 POST 降为回退(§五);② 默认管线 = 流式 ASR,LLM 后处理按需,不默认实时多模态(§五);③ ESP-NOW 载荷增加 UART 旁路回退以与 SDIO 缺陷故障隔离,心跳复位 C6 升级为必做(§6.1/§十五);④ 客户端分平台注入细节与双权限/枚举缺陷应对(§3.6,新增 macOS 风险行 §十七)。

---

> 返回 [PROJECT-OPEN-DESKOS.md](PROJECT-OPEN-DESKOS.md) | [SPEC-MVP.md](SPEC-MVP.md) | [DESIGN-EXTENSIONS.md](DESIGN-EXTENSIONS.md)
