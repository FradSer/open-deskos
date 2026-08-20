# Guition JC4880P443 — LVGL 60 FPS 优化过程与踩坑

> **板卡**：Guition JC4880P443C（ESP32-P4 + C6），ST7701S 480×800 MIPI-DSI，GT911 触摸  
> **固件**：`firmware/open-deskos/application/open_deskos`（Voice UI / Lua LVGL）
> **IDF**：`~/.espressif/v6.0.1/esp-idf`  
> **日期**：2026-07-12  
> **硬件对照**：[GUITION-JC4880P443.md](GUITION-JC4880P443.md)（引脚 / DPI 时钟 / 缓冲策略）

本文记录从屏上约 **25 FPS** 推到交互约 **80 FPS** 的完整路径、每一步的实测结果，以及沿途遇到的编译、运行时与 UI 闪烁问题。目标不是“再抄一套 esp_lvgl_port”，而是把 **Open DeskOS 上已落地的配置与代码决策** 写清楚，方便以后回退或移植。

---

## 1. 目标与结果

| 阶段 | 屏上 FPS（PERF_MONITOR） | 说明 |
|------|--------------------------|------|
| 起点 | ~25 | `CONFIG_LV_DEF_REFR_PERIOD=33`（默认 ~30Hz 上限）+ partial SRAM 条带 |
| REFR→16 / 双缓冲 / DMA2D | ~30–40 | 仍受刷新周期与渲染路径限制 |
| 全局 PERF + 局部修 truncation | 峰值 ~56 | 宣传“+30%”未直接兑现到 60 |
| Direct + PPA + L2/ISR + 钉核 | 交互 ~80 | 高于面板 60Hz 标称（sysmon 统计含多余 invalidate） |
| 关 grow / 压平 pressed | 同上 | 修 Refresh 按钮闪烁，不换渲染模式 |

**验收命令**（USB 控制台）：

```text
cerb ui demo
```

期望日志：

```text
LVGL adapter TRIPLE_PARTIAL: 480x800 RGB565, buffer_height=80, PPA on
voice UI demo running (@2x + ICONS + touch)
```

左上角 sysmon 显示 FPS / CPU%。`PERF_MONITOR` 在优化全程保持开启，便于对照。

---

## 2. 硬件与软件基线

### 2.1 面板时序（不可随意改）

已在 bring-up 验证的配对（见 GUITION §2.2）：

| 项 | 值 |
|----|-----|
| 分辨率 | 480×800 RGB565 |
| DPI 时钟 | 34 MHz → 面板刷新约 **60 Hz** |
| DSI | 2-lane × 500 Mbps |
| 帧缓冲 | `num_fbs=3`（`esp_lvgl_adapter` TRIPLE_PARTIAL） |
| 拷贝 | `esp_lcd_dpi_panel_enable_dma2d()` |

刷新率粗算：

```text
refresh ≈ dpi_hz / (h_total × v_total) ≈ 60 Hz
```

因此软件目标是 **跟上 60Hz 扫描**，而不是“无限抬高 FPS”。sysmon 在交互时报 80 属于统计口径（多次 invalidate / 短周期 `lv_timer_handler`），面板物理上限仍约 60Hz。

### 2.2 关键代码位置

| 路径 | 职责 |
|------|------|
| `boards/open-deskos/open_deskos_p4_headless/sdkconfig.defaults.board` | 板级 LVGL / cache / PERF 默认 |
| `main/odk_display_bringup.c` | ST7701、DPI、DMA2D、三 FB（adapter） |
| `components/lua_modules/lua_module_lvgl/src/lua_lvgl_runtime.c` | 默认 `esp_lvgl_adapter` TRIPLE_PARTIAL；legacy Direct/Partial |
| `components/lua_modules/lua_module_lvgl/src/lua_lvgl_style.c` | pressed 态压平（防闪烁） |
| `components/lua_modules/lua_module_lvgl/src/lua_lvgl_core_widgets.c` | button 创建时关掉 grow/recolor |
| `main/odk_voice_ui.c` | demo：`task_period_ms=3`、`tick_ms=2` |
| `tools/patch_mcp_c_sdk_perf.py` | managed `mcp-c-sdk` 的 PERF 修丁（可重复应用） |

---

## 3. 优化时间线（按落地顺序）

### 3.1 根因：刷新周期被卡住

**现象**：面板已是 ~60Hz，LVGL 却长期停在 ~25–30 FPS。

**原因**：`CONFIG_LV_DEF_REFR_PERIOD` 默认 **33 ms** → LVGL 理论上限约 30 FPS。

**处理**：

```text
CONFIG_LV_DEF_REFR_PERIOD=16   # 先到 ~60 上限
# 后续再压到 12，配合 task_period_ms=3
CONFIG_LV_DEF_REFR_PERIOD=12
```

**教训**：先查软件刷新周期，再怀疑 DMA / PSRAM。

---

### 3.2 Partial 路径：双条带 + DMA2D + 内部 SRAM

早期路径：`LV_DISPLAY_RENDER_MODE_PARTIAL`，`buffer_lines` 约 40–48。

| 尝试 | 结果 |
|------|------|
| 单条带 PSRAM | 慢；flush 等 DMA |
| 双条带（buf1+buf2） | 渲染与 DMA2D 拷贝可重叠 |
| 优先 `MALLOC_CAP_INTERNAL \| DMA`，64B 对齐 | 明显好于 PSRAM canvas |
| 过大条带（如 120 行） | 第二块常溢出到 PSRAM，收益回吐 |
| **折中 48 行 ×2 SRAM** | 稳定且快 |

flush：`esp_lcd_panel_draw_bitmap(area, …)`，并用 `on_color_trans_done` 信号量做同步（避免叠帧）。

与 GUITION §2.9 一致：**不要往正在扫描的 FB 里边画边显示**（当时用离屏条带规避）。

---

### 3.3 编译器 PERF（`-O2`）与 truncation Werror

**意图**：全局 `CONFIG_COMPILER_OPTIMIZATION_PERF=y`，官方经验约 +30% 渲染。

**踩坑**：IDF 开 PERF 后，`-Werror=format-truncation` / 相关截断警告会把构建打断。**禁止**用大面积 `-Wno-error` 糊过去。

**正确做法**（改调用点）：

1. 自有代码：`odk_gen` / `odk_installer` / `odk_app_manager` / `odk_app_runtime` / `lua_module_storage` 等，把危险的 `strncpy` / 过紧的 `snprintf` 改安全。
2. Managed 组件 `espressif__mcp-c-sdk`：`strncpy` → `snprintf`。  
   `managed_components/` **被 gitignore**，手改会丢 → 用：

   - `application/open_deskos/tools/patch_mcp_c_sdk_perf.py`
   - `CMakeLists.txt` 在 `project()` 前 `execute_process` 幂等重放

**实测**：PERF 后峰值约 **56 FPS**，未单独把帧率推到 60；仍需换渲染路径。

---

### 3.4 Direct 模式 + DPI 双 FB（最大跳跃）

**做法**（`lua_lvgl_runtime.c`）：

1. `esp_lcd_dpi_panel_get_frame_buffer(panel, 2, &fb0, &fb1)`
2. `lv_display_set_buffers(..., LV_DISPLAY_RENDER_MODE_DIRECT)`
3. 颜色格式 RGB565；**不要** `heap_caps_free` 面板 FB（`draw_buf_owned=false`）
4. flush：仅在 `lv_display_flush_is_last` 时  
   `draw_bitmap(0, 0, w, h, px_map)` 触发 FB 切换；等 `color_trans_done` 再 `flush_ready`

失败则回退 Partial SRAM 双缓冲。

**与 esp_lvgl_port 的差异**：其 `avoid_tearing` 路径更偏 **FULL + VSYNC**；本仓库当前用 **DIRECT + 双 FB**，交互帧率更高，但对主题 grow / 脏区扩大更敏感（见 §4.4）。

**日志锚点**：`LVGL DIRECT: DPI FBs 480x800 RGB565 (768000 B x2)`。

---

### 3.5 PPA、Cache、ISR、任务钉核

| 配置 / 代码 | 作用 | 备注 |
|-------------|------|------|
| `CONFIG_LV_USE_PPA=y` | 硬件填充/混合 | 约可砍 fill/image 绘制时间 |
| `CONFIG_LV_PPA_BURST_LENGTH=64` | 限制 burst | 128 可能与 DMA2D 抢带宽导致 underrun；默认锁 64 |
| L2：**128KB** + **64B** line | 腾内部 RAM + 对齐 PPA | 原 256KB/128B 吃掉过多 SRAM |
| `CONFIG_LCD_DSI_ISR_CACHE_SAFE=y` | DSI ISR 与 cache 安全 | Direct flush 路径需要 |
| LVGL task `xTaskCreatePinnedToCore(..., 1)` | 与 Wi‑Fi/协议核分离 | core 1 |
| `tick_ms=2`，`task_period_ms=3` | 更密的 `lv_timer_handler` | demo / prompt 已同步 |

**配置怪象**：configure 时曾出现 `LV_USE_PPA in sdkconfig is y but … n according to Kconfig`；最终 `sdkconfig.h` 仍为 `CONFIG_LV_USE_PPA 1`。以 **编译产物头文件** 为准，不要只信瞬时 Kconfig 提示。

**IRAM 快路径**：本树 LVGL 开 IRAM 会撞 `-Werror=attributes`，刻意关闭。

---

### 3.6 交互 ~80 FPS 后：Refresh 按钮闪烁

**现象**：交互流畅（~80 FPS），但点底部 **Refresh** 时按钮本身闪一下。

**根因（主题，不是 flush 写错）**：

默认主题对 `lv_button`：

- `LV_THEME_DEFAULT_GROW`：pressed 时 `transform_width` 变大 → 脏区扩大  
- pressed recolor：黑色 @ 35% 透明度  
- 80ms transition → 多帧重绘  

在 **DIRECT + 双 DPI FB** 上，扩大的脏区重绘非常显眼，表现为“闪烁”。

**修复**（保留 Direct，不关 PERF_MONITOR）：

1. `# CONFIG_LV_THEME_DEFAULT_GROW is not set`
2. `lv_button_create` 后：`transform_*=0`、`recolor_opa=TRANSP`（pressed）
3. 应用自定义 `bg_color` 时同步写到 `LV_STATE_PRESSED`，并关掉 recolor

---

## 4. 问题清单（按类别）

### 4.1 编译 / 依赖

| 问题 | 处理 |
|------|------|
| PERF 触发 truncation Werror | 修调用点；mcp-c-sdk 用 patch 脚本 |
| managed 补丁被 `idf.py update-dependencies` 冲掉 | CMake configure 重放 `patch_mcp_c_sdk_perf.py` |
| PPA Kconfig 提示与 sdkconfig 不一致 | 查 `build/config/sdkconfig.h` |
| LVGL IRAM 属性错误 | 不启用 IRAM 快路径 |

### 4.2 运行时 / 启动

| 问题 | 处理 |
|------|------|
| `app_claw_start` 失败 → LVGL `data root` 未配置 → `lvgl.init` 失败 | `lua_lvgl_register_fs_locked`：无 data root 时跳过 S: 驱动（内置字库仍可用） |
| 过早 `cerb ui demo`（存储/claw 未就绪） | 等 `console: cerb ui` 后再跑；或依赖上述跳过逻辑 |
| REPL 在 claw 早期失败时不可用 | `main.c` 在 claw 失败时仍 `app_claw_cli_start` |

### 4.3 渲染 / 显示

| 问题 | 处理 |
|------|------|
| ~25 FPS 天花板 | `LV_DEF_REFR_PERIOD` 33→12 |
| Partial 进 PSRAM 变慢 | 48 行、尽量双 SRAM |
| Direct 拿不到 FB | 回退 Partial；确认 `num_fbs=2` |
| PPA burst 过大 underrun | burst=64 |
| 画进正在扫描的 FB（历史教训） | GUITION §2.9；Direct 依赖双 FB 切换 + last-flush |

### 4.4 UI 交互

| 问题 | 处理 |
|------|------|
| Refresh 按钮闪烁 | 关 grow + 压平 pressed 样式 |
| emoji / 缺字形变“口” | 只用 `ICONS` / `LV_SYMBOL_*`，禁 emoji |
| 字过小 | DPI 260、默认 Montserrat 28、`UI_SCALE=2` |

---

## 5. 当前推荐配置摘要

板级默认（节选，完整见 `sdkconfig.defaults.board`）：

```text
CONFIG_LV_DEF_REFR_PERIOD=12
CONFIG_LV_USE_PPA=y
CONFIG_LV_PPA_BURST_LENGTH=64
CONFIG_LV_DRAW_BUF_ALIGN=64
CONFIG_CACHE_L2_CACHE_128KB=y
CONFIG_CACHE_L2_CACHE_LINE_64B=y
CONFIG_LCD_DSI_ISR_CACHE_SAFE=y
CONFIG_COMPILER_OPTIMIZATION_PERF=y
CONFIG_LV_USE_SYSMON=y
CONFIG_LV_USE_PERF_MONITOR=y
CONFIG_LV_PERF_MONITOR_ALIGN_TOP_LEFT=y
# CONFIG_LV_THEME_DEFAULT_GROW is not set
```

运行时（demo）：

```lua
lvgl.init(PANEL, nil, WIDTH, HEIGHT, PANEL_IF,
  { buffer_lines=48, tick_ms=2, task_period_ms=3 })
```

成功走 Direct 时 `buffer_lines` 会被忽略（全屏 FB）；失败时仍作 Partial 条带高度。

---

## 6. 验证步骤

1. 编译刷写：

   ```bash
   cd firmware/open-deskos/application/open_deskos
   idf.py -p /dev/cu.usbmodem2101 build flash
   ```

2. 串口等待 REPL / `console: cerb ui`。
3. `cerb ui demo`。
4. 确认 `LVGL DIRECT: …`；无 Guru / underrun。
5. 看左上角 FPS；点 Refresh：**按钮不应再闪**，title 应变为 `taps N`。

关 monitor 的对比测量：可临时关 `CONFIG_LV_USE_PERF_MONITOR`（本次优化过程中**刻意保持开启**以便对照）。

---

## 7. 未做 / 可后续

| 项 | 原因 |
|----|------|
| 切手搓 `RENDER_MODE_DIRECT` | 滚动大脏区会闪且卡 ~25 FPS |
| 默认 `FULL` + DPI FB | 不闪，但交互整屏重绘 → ~20 FPS；已改回默认 **PARTIAL**（`fb_swap=true` 可再开 FULL） |
| 迁 `esp_lvgl_adapter` DOUBLE_DIRECT / TRIPLE_PARTIAL | 改动面大，仍可尝试（见 §7.1） |
| 关 PERF_MONITOR 做“纯净”FPS | 用户要求验证期保留 |
| 双 SW draw unit | 需 `LV_USE_OS`；与当前 PPA 单单元策略冲突 |
| LVGL IRAM | 属性 Werror |

若再次出现 **按钮区域闪但主题已关 grow**：优先查 Direct 是否画进当前扫描 FB，或评估 FULL + `on_refresh_done` / `on_frame_buf_complete`。

### 7.1 架构级下一步（可尝试）：迁到 `esp_lvgl_adapter`

当前路径是 **自研 Direct flush**（`lua_lvgl_runtime.c` 直接拿 DPI FB）。Espressif Techpedia / [esp_lvgl_adapter](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html) 现在主推统一 tearing 模式，对本板（MIPI DSI、小脏区 Voice UI）最相关的是：

| 模式 | 映射 | 适用 |
|------|------|------|
| `ESP_LV_ADAPTER_TEAR_AVOID_MODE_DOUBLE_DIRECT` | LVGL DIRECT，2 FB | 小区域 / widget 增量（最接近现状） |
| `ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_PARTIAL` | LVGL PARTIAL，3 FB + 1 条带（偏内部 SRAM） | 高分平滑 UI；90°/270° 旋转场景 |

**状态**：尚未迁；**改动面大**（display bring-up、Lua LVGL runtime flush/锁、与 `display_arbiter` / emote 仲裁、触摸 indev 注册都要接到 adapter）。**可以尝试**，优先顺序建议：

1. Spike：`DOUBLE_DIRECT` 替换自研 Direct，保留现有 panel handle / 480×800 / 无旋转。
2. 对照 FPS、underrun、按钮闪烁是否仍需关 grow。
3. 若以后要横置 / 旋转，再评 `TRIPLE_PARTIAL`（注意 P4 + PPA + 旋转有官方 freeze patch）。

官方组件：`espressif/esp_lvgl_adapter`（Component Registry）。不要与旧的 `esp_lvgl_port` 混用同一条显示注册路径。

---

## 8. 一句话结论

**先放开 `REFR_PERIOD`，再把 flush 接到 DPI 双 FB 的 Direct 路径，用 PPA + PERF + 钉核把绘制跟上 60Hz；主题 grow/recolor 会在 Direct 下伪装成“闪烁”，必须单独关掉。** managed 组件的 PERF 修丁必须可重复应用，不能只改 `managed_components/` 一次。架构级下一跳是 **`esp_lvgl_adapter` 的 `DOUBLE_DIRECT` / `TRIPLE_PARTIAL`**（可尝试，改动面大）。
