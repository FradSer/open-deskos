# Open DeskOS ![](https://img.shields.io/badge/status-active_development-orange)

[![硬件](https://img.shields.io/badge/hardware-ESP32--P4%20%2B%20ESP32--C6-blue)](docs/open-deskos/OPEN-DESKOS.md) [![固件](https://img.shields.io/badge/firmware-ESP--IDF-green)](firmware/open-deskos/)

[English](README.md) | **简体中文**

Open DeskOS 是一套桌面伴侣操作系统，运行在 ESP32-P4 显示设备和 ESP32-C6 网络协处理器上，并配套 Apple 平台客户端。

## 仓库内容

### 固件

ESP32-P4 固件提供 LVGL/Lua 桌面外壳、Widget、应用、语音 UI 和 USB 集成；ESP32-C6 通过 hosted 链路处理 Wi-Fi 与 ESP-NOW 连接。

当前产品方向和硬件边界见 [docs/open-deskos/OPEN-DESKOS.md](docs/open-deskos/OPEN-DESKOS.md)。当前主要显示目标是 Guition JC4880P443C 480x800；CM5/S31 是独立的迁移候选方案。

### Native SDL 模拟器

`firmware/open-deskos/sim/native_sdl/` 可以在桌面环境运行固件的 Lua/LVGL UI，不需要 ESP-IDF 或 Emscripten。它用于检查 launcher、Widget、布局和生成式 UI；它使用 IO/PARTIAL 渲染路径，不能验证 P4 的 MIPI-DSI adapter 路径。

```bash
cd firmware/open-deskos/sim/native_sdl
cmake -S . -B build
cmake --build build -j
cp ../../components/lua_modules/lua_module_lvgl/lib/{launcher,aiodi}.lua lib/
./build/cerberus_sim
```

### Apple 客户端

`app/apple/` 包含 SwiftUI 客户端和仅 macOS 使用的 `OpenDeskOSCLI` target。CLI 负责 Wispr Flow 健康检查，并把 OpenCode Go 订阅快照桥接到设备。

```bash
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
```

### 产品与实现文档

- [产品规格](docs/open-deskos/OPEN-DESKOS.md)
- [固件 README](firmware/open-deskos/README.md)
- [Apple 客户端说明](app/README.md)
- [BDD 场景](firmware/open-deskos/tests/features/)

## 编译和烧录固件

P4 显示路径要求 ESP-IDF 6.0.1 或更高版本。使用 [`eim`](https://github.com/espressif/idf-im-ui) 安装工具链，并通过指定版本运行每条 ESP-IDF 命令：

```bash
# 一次性安装 ESP-IDF 和 ESP32-P4 工具。
eim install -i v6.0.1 -t esp32p4

cd firmware/open-deskos/application/edge_agent

# 为 Guition JC4880P443C 生成 board-manager 配置。
eim run "idf.py bmgr -c ./boards -b guition_jc4880" v6.0.1

# 编译应用以及 system/storage 镜像。
eim run "idf.py build" v6.0.1

# 将 PORT 替换为设备的 USB Serial/JTAG 端口，然后烧录并打开监视器。
eim run "idf.py -p PORT flash monitor" v6.0.1
```

在 macOS 上，端口通常是 `/dev/cu.usbmodem*`；在 Linux 上通常是 `/dev/ttyACM0`。如果设备没有自动进入下载模式，按住 BOOT 的同时重置开发板，然后重新运行烧录命令。使用 `Ctrl-C` 退出监视器。

上面的 board ID 对应 `firmware/open-deskos/application/edge_agent/boards/guition/jc4880p443c/board_info.yaml`。其他 board ID 可在 `firmware/open-deskos/application/edge_agent/boards/` 下查看。具体板级配置、分区布局和烧录流程也维护在该目录中。

## 测试

Host 测试和 BDD 相关 harness 位于 `firmware/open-deskos/tests/`。Native simulator 与 host 构建覆盖不同路径，因此模拟器通过不代表 ESP-IDF 构建也能通过。

## 参与开发

产品决策写入 `docs/open-deskos/OPEN-DESKOS.md`。固件修改请遵循 `firmware/open-deskos/AGENTS.md` 中的本地规则；新增行为前，先在 `firmware/open-deskos/tests/features/` 添加或更新场景。

## 许可证

当前仓库根目录没有包含 license 文件。
