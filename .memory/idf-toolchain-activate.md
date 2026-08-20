---
name: idf-toolchain-activate
description: eim run <cmd> v6.0.1 是 IDF 首选入口; P4 MIPI-DSI 必须用 IDF 6.0.1+(5.5.1 DPI DMA underrun 黑屏); build 报 bootloader cache 冲突则 rm -rf build/bootloader*
type: reference
---

**IDF 激活首选命令:**
```sh
eim run "<cmd>" v6.0.1
```
这会自动 source `~/.espressif/tools/activate_idf_v6.0.1.sh` 并执行命令。

**回退:**
```sh
source ~/.espressif/tools/activate_idf_v6.0.1.sh
```

**关键约束:**
- P4 MIPI-DSI/DPI 面板在 IDF 5.5.1 下会出现 DPI DMA underrun → 黑屏。必须用 IDF 6.0.1+ (pulse-esp 已迁移到 v6.0, 其 P4 DSI 配置可供参考)。
- `idf.py build` 报 bootloader cache 冲突 → `rm -rf build/bootloader*`
**How to apply:** 始终用 `eim run "<cmd>" v6.0.1` 激活 IDF。遇 DSI 黑屏先确认 IDF 版本 ≥ 6.0.1；在已配置工具链的环境中可直接执行构建与刷写。

**Related:** [[cerberus-p4-display-lit]] [[cerberus-firmware-host-vs-idf-build]]