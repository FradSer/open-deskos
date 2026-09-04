---
name: cerberus-real-subscription-data-p4
description: "P4 OpenCode Go 订阅数据架构：cerb_sub、console sub、Mac SubBridge 与屏幕数据绑定"
type: project
---

P4 首页 OpenCode Go 磁贴使用 Mac 侧抓取的真实订阅快照，而不是设备端时间伪造或未注册 KV 默认值。

**架构：**
- 传输复用 esp_console REPL：`cerb sub status|push|get`，不增加 TinyUSB/厂商通道。
- Mac 侧从 Keychain cookie 获取凭据，调用 `opencode.ai/_server` 的 subscription/billing RPC，解析 rolling、weekly、monthly usage。
- 设备端 `components/cerb_sub/` 负责字符串快照存储和 NVS 端口；`cerb_console` 提供 `sub` 子命令；`cerb_voice_ui` 暴露 `sub_get`/`sub_request_fresh`；launcher 首页第二页绑定快照；Mac 侧实现 `SubBridge.swift`。
- 打开页面时请求刷新；数据模型不是设备端定时伪造。

**可靠性规则：**
- 任何 managed component 版本约束必须锁定并纳入构建输入，避免设备固件与组件漂移。
- CDC 串口桥接与串口监控不能并行占用同一设备；选择不会因 DTR 自动复位设备的串口节点。
- 主机端二进制必须与 Swift 源码同步重建后再验证 live fetch。

**Why:** 首页的订阅显示必须反映真实账户数据；设备端没有凭据和稳定的账户 API，因此 Mac 负责抓取，P4 只保存并展示快照。

**How to apply:** 修改订阅模型时同时检查 `components/cerb_sub/`、`tests/features/subscription-data.feature`、`app/apple/CerberusCLI/SubBridge.swift` 和 launcher 绑定；先跑 host/BDD 测试，再验证串口 push、设备存储和页面渲染。

**Related:** [[cerberus-native-sdl-sim]] [[cerberus-p4-c6-esp-hosted-up]] [[aiodi-ui-design-standard]]
