---
name: open-deskos-firmware-application-identity
description: "Open DeskOS 主固件应用已从上游 edge_agent 重命名为 application/open_deskos，并移除独立 mcp_server_point 样例"
type: project
---

Open DeskOS 的生产固件工程路径是 `firmware/open-deskos/application/open_deskos`，ESP-IDF project identity 是 `open_deskos`。上游 `edge_agent` 名称不再出现在当前代码、构建和文档路径中。独立的 `application/mcp_server_point` 上游样例也已移除；固件应用目录只保留 `open_deskos` 和 `c6_espnow_bridge`。

当前生产 board registry 只包含 `boards/guition/jc4880p443c`，board ID 为 `jc4880p443c`。

**Why:** 该仓库已经是 Open DeskOS 产品固件，而不是可支持多开发板的 ESP-Claw 示例仓库；保留上游应用名和样例会让构建、文档和维护边界继续漂移。

**How to apply:**
- 固件构建从 `firmware/open-deskos/application/open_deskos` 执行。
- 修改构建路径、host contract、CI 或工具脚本时使用 `application/open_deskos`。
- 不要恢复 `edge_agent` 应用路径或 `mcp_server_point` 独立固件样例。
- 新增硬件支持前必须先更新产品范围和 BDD 场景；当前唯一支持硬件是 Guition JC4880P443C。

**Related:** [[cerberus-os-top-spec]] [[cerberus-p4-c6-esp-hosted-up]] [[cerberus-native-sdl-sim]]
