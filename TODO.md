# TODO.md

仓库级执行态待办清单。权威规格与优先级以 `@docs/open-deskos/OPEN-DESKOS.md`(顶层总纲)为准;
本文件只跟踪进行中的工作,完成后打勾并留日期(YYYY-MM-DD)。

## BLE Keyboard Bridge 继承计划(进行中,2026-08-06 立项)

**目标**:让 Open DeskOS 设备把物理 USB 键盘桥接成 BLE HID 键盘 —— 键盘插入设备
(P4 USB-OTG 作 USB Host),按键经现有 BLE HID 通道(C6 射频)转发到任意主机
(手机 / 平板 / 另一台电脑),支持多槽位配对切换与重启保持。

**上游参考**:https://github.com/KoStard/ESP32S3-USB-Keyboard-To-BLE
- 形态:PlatformIO + Arduino(C++),`src/` = `main.cpp` + `USBManager` / `BLEManager` /
  `Bridge` / `Config` / `NVSUtils`,共 2 commits。
- 注意:仓库无 LICENSE 文件 —— 只借鉴设计思路与 UX,不复刻代码;引入时按
  `firmware/open-deskos/UPSTREAM.md` 的模式记录 provenance。
- 可借鉴:① 3 槽位配对 + `Scroll Lock + 1/2/3` 秒切;② 槽位 NVS 持久化
  (NVSUtils);③ VBUS 供电坑 —— 多数开发板不把 5V 路由到 USB-C VBUS,键盘需
  外部供电(powered hub 是官方推荐做法)。
- 不复用:Arduino USBHost/TinyUSB 栈与 BLE 实现。Open DeskOS 侧换 ESP-IDF
  `esp_usb_host` + 现有 `esp_hidd`(BLE HID 外设已由
  `components/lua_modules/lua_module_ble_hid/` 落地,键盘/鼠标/媒体报告齐全)。

**硬件现实**(Guition JC4880P443C,按 csvke BSP):
- P4 有两个 USB-OTG(HS 与 FS,FS 含 USB-Serial-JTAG),IDF 6.0.1 均支持 host 模式
  (可指定用哪个外设;`espressif/usb` v1.3.0 起支持双 host)。
- 注意:板载 USB-C 当前是 USB-Serial-JTAG 控制台
  (`boards/open-deskos/open-deskos_p4_headless/sdkconfig.defaults.board`),host 模式下
  控制台与"USB 设备模式连 Mac"都不可用 —— 需确认 USB-C 实际接的是哪个 OTG、
  VBUS 5V 是否上拉(上游头号坑)。
- 注意:与 Open DeskOS 现有形态 "USB-HS 复合 HID + 厂商通道"(设备模式连 Mac,
  SPEC-MVP §二~三)互斥 —— 桥接场景下 Mac 连接改走 BLE HID。

**任务分解**:
- [ ] 硬件确认(IDF 主机 / 实物):USB-C 接哪个 USB-OTG、VBUS 5V 供电路径、
      host 模式后控制台去向(UART0 GPIO37/38 未引出,考虑 Wi-Fi 远程控制台)。
- [ ] 验证 IDF 6.0.1 下 P4 `esp_usb_host` host 模式 + HID host class driver
      (`esp_hid_host` 或 `usb_host_hid`)可用。
- [ ] 新组件 `firmware/open-deskos/components/odk_usb_hid_bridge/`
      (ESP-IDF C 风格 OO):键盘枚举、HID 报告解析、按键去抖。
- [ ] 接入现有 BLE HID 报告通道:C 级直接 `esp_hidd_dev_input_set()`,不经 Lua。
- [ ] 槽位切换(`Scroll Lock + 1/2/3`)+ NVS 持久化。
- [ ] BDD 先行:`tests/features/usb_ble_bridge.feature` 先落场景;
      `tests/host/` 可测部分(报告解析、槽位状态机)。
- [ ] `UPSTREAM.md` 追加 provenance 记录。
- [ ] 实测:键盘枚举 → 主机收到 BLE 按键注入。

## 已知未竟事项(来自规格,非本计划)

- [ ] HG-1:P4 AMOLED(928×262)面板 NEVER LIT —— 仓库最高优先级单项,
      当前阻塞在 cmd_ack 验证(Open DeskOS §4)。
- [ ] BLE 配网(原 PROJECT-OPEN-DESKOS 顺延列表,Open DeskOS)。
- [ ] 包签名 Ed25519:解冻条件 = 出现第三方目录(NFR-9)。
- [ ] LUMINA-P4:`firmware/` 的 TAS5825M PPC3 DSP cfg 导出 + post-I2S 接线
      (见 `firmware/README.md`)。
