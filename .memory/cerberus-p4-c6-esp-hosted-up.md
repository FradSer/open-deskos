---
name: cerberus-p4-c6-esp-hosted-up
description: "Guition P4+C6 运行基线：480x800 显示、GT911 触摸、esp-hosted SDIO 与 Wi-Fi 连接"
type: project
---

Guition JC4880P443C 的固件树包含完整的 P4 显示/触摸初始化、C6 esp-hosted 配置和 C6 ESP-NOW bridge。当前验证基线是 P4 通过 SDIO 连接 C6，由 C6 提供 Wi-Fi；CM5/S31 不复用这条未经验证的 host protocol。

**当前代码锚点：**
- `research/esp32-p4-c6-deskos/firmware/application/edge_agent/boards/guition/jc4880p443c/` 保存板级设备、外设和 sdkconfig 默认值。
- `research/esp32-p4-c6-deskos/firmware/application/edge_agent/managed_components/espressif__esp_hosted/` 保存 esp-hosted 组件及 slave 工程。
- `research/esp32-p4-c6-deskos/firmware/application/c6_espnow_bridge/` 保存 C6 ESP-NOW bridge。
- `research/esp32-p4-c6-deskos/firmware/application/edge_agent/main/cerb_c6_slave_ota.c` 负责设备端 slave 镜像更新路径。

**Why:** 板级默认配置曾与实际板卡能力不一致；把已验证的 P4+C6 路径和未来 CM5/S31 迁移路径分开，避免误把 S31 当成兼容的 esp-hosted slave。

**How to apply:** P4+C6 research 改动先检查 Guition board YAML、sdkconfig、managed component 和 C6 bridge；CM5/S31 实验遵循 `experiments/cm5-s31-gateway/README.md` 的 UART/SPI 验证边界。

**Related:** [[idf-toolchain-activate]] [[cerberus-p4-display-lit]] [[cerberus-firmware-host-vs-idf-build]] [[cerberus-rpi-migration-eval]]
