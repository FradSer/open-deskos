# OpenDeskOS

桌面 OS 设备（ESP32-P4 + ESP32-C6），从 open-deskos 仓库迁出。

## 仓库结构

- **`firmware/open-deskos/`** — 设备固件（esp-claw fork）。顶层权威是 `@docs/open-deskos/OPEN-DESKOS.md`。
- **`app/apple/`** — macOS SwiftUI 客户端（plugin-hosted sidecars）。
- **`docs/`** — 产品规格、计划、回顾、参考资料。`docs/README.md` 是索引。
- **`co6300.pdf`** — AMOLED 面板数据手册。

## 开发命令

Host 测试（无需 ESP-IDF）：
```sh
cmake -S firmware/open-deskos/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```

设备构建（需 IDF 6.0.1+）：
```sh
eim run "idf.py build" v6.0.1
```

Native SDL 模拟器：
```sh
cd firmware/open-deskos/sim/native_sdl
cmake -S . -B build && cmake --build build -j
./build/open-deskos_sim
```

## 关键约束

- P4 MIPI-DSI 面板必须用 IDF 6.0.1+（5.5.1 有 DPI DMA underrun 黑屏）。
- 硬件参考是 csvke BSP（Guition JC4880P443C），不要把其他 P4 carrier 的 pin map 套过来。
- UI 遵循 AIODI 设计系统（`DESIGN.md`），Figma 是视觉权威。
- Host 测试绿 ≠ `idf.py build` 绿；两类构建独立验证。

## 子树 Agent

固件子树有自己的 agent 指南：`firmware/open-deskos/AGENTS.md`。
