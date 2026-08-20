# Open DeskOS 固件

本目录包含 **Guition JC4880P443C** 的 Open DeskOS 生产固件：

- ESP32-P4 主处理器
- ESP32-C6 Wi-Fi 与 ESP-NOW 协处理器
- ST7701S MIPI-DSI 显示屏，480×800 竖屏
- GT911 电容触摸

生产固件工程位于 [`application/open_deskos/`](application/open_deskos/)。唯一的
board-manager 定义位于
[`application/open_deskos/boards/guition/jc4880p443c/`](application/open_deskos/boards/guition/jc4880p443c/)。
其他开发板和上游独立示例工程不属于当前固件树。

## 编译与烧录

使用 ESP-IDF 6.0.1 或更高版本。P4 MIPI-DSI 显示路径不支持上游项目使用的旧版
IDF。

```bash
cd firmware/open-deskos/application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1
```

board-manager 步骤会在 `components/gen_bmgr_codes/` 生成板级组件。删除 build
目录或修改板级定义后，需要重新执行该步骤。

需要时，C6 网络镜像单独构建并嵌入：

```bash
cd firmware/open-deskos
tools/build_c6_espnow_slave.sh
```

## Native 模拟器

SDL2 模拟器无需 ESP-IDF 或 Emscripten，即可在桌面运行相同的 Lua/LVGL UI 源码。
macOS 支持交互窗口，也支持 CI 使用的脚本化无界面运行。详见
[`sim/native_sdl/README.md`](sim/native_sdl/README.md)。

```bash
cd firmware/open-deskos/sim/native_sdl
./run.sh
```

## 验证

Host 测试不需要 ESP-IDF：

```bash
cd firmware/open-deskos
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

Native 模拟器使用 SDL2 IO/PARTIAL 渲染路径。模拟器通过不代表生产 P4 MIPI-DSI
adapter 路径通过；烧录真机前必须执行 `idf.py build` 验证固件。
