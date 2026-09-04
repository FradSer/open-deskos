---
name: cerberus-icon-rendering
description: "设备端图标用 FontAwesome 字体而非 SVG: LVGL SVG→ThorVG 软件渲染在 P4 输出空白; fa-icons.ttf 子集 + aiodi.icon_label + max_files/DATA_ROOT 修复"
type: project
---

设备端首页/状态栏图标走 **FontAwesome 6 字体栅格化**(`fonts/fa-icons.ttf` 子集), **不用 SVG**。SVG 在 P4 上解析/尺寸正确但渲染空白。

**根因链(SVG 失败):**
1. LVGL 的 SVG decoder(`lv_svg_decoder.c`)解析正确: viewport width/height 决定尺寸, `<svg width=115 viewBox="0 0 24 24">` → bounds 115x115 ✓(svg-dbg 日志确认)。
2. 但渲染走 `svg_draw` → `lv_draw_vector` → `LV_DRAW_TASK_TYPE_VECTOR` → `lv_draw_sw_vector`(ThorVG 软件路径, 需 `LV_USE_VECTOR_GRAPHIC && LV_USE_THORVG`)。**软件 vector 渲染在 P4 输出空白**(sim 9.6 ThorVG 同样空白, 两版本一致失败; LVGL issue #9892 也是 9.5 SVG 渲染问题)。
3. 曾用 `<g transform="scale(s)">` 手动放大(无 viewBox)——9.5 parser 忽略 group transform, 24 单位 path 渲染在画布角落不可见。改 viewBox 后解析对了但仍渲染空白 → **放弃 SVG**。

**FontAwesome 方案:**
- `firmware/open-deskos/application/edge_agent/fatfs_image/storage/fonts/fa-icons.ttf` — hb-subset 提取 13 个字形(U+F0E0 envelope, F133 calendar, F013 gear, F254 hourglass, F0F3 bell, F0E7 bolt, F522 dice, F043 droplet, F005 star, F06C leaf, F0C1 link, F060 arrow-left, F0D9 caret-left)。**必须用 hb-subset 生成**(fontTools 在 macOS 输出损坏 TTF, 见 cjk-font-subset-hb-subset)。
- `aiodi.lua`: `M.icon_font_path`、`FA_GLYPHS` 映射表、`M.icon_font(size)`(走 font_at 缓存)、`M.icon_label(parent, {name, size, color, x, y})`(label + utf8.char(glyph))。
- `launcher.lua`: 首页 3 tile、状态栏闪电、peek 图标全用 `aiodi.icon_label`(不再 svg_icon)。`svg_icon` 保留(兼容)但 launcher 不调用。
- 图标尺寸: 首页 `icon_px = math.floor(g.cell * 0.5)`(50%, 用户调过 88%→60%→50%)。

**配套修复(SVG 时代遗留):**
1. **max_files**: `app_fs.c` 两个 FATFS mount_config 的 `max_files` 8→32(system)/64(storage)。storage 分区 fd 耗尽导致 `io.open` 写 SVG 失败(icon fallback 小文字)——"icon 没变大"的真凶之一。
2. **DATA_ROOT**: `cerb_voice_ui.c` 暴露 `DATA_ROOT` 全局 + 预创建 `<data_root>/icons`。`aiodi.ensure_svg_file` 用 `DATA_ROOT` 绝对路径写(C stdio 相对路径基于 cwd=/ 写错树, LVGL D: 读 storage 分区)。sim 无 DATA_ROOT 走相对路径。
3. **LVGL FS**: 设备端 `LUA_MODULE_LVGL_FS_LETTER='D'` → `D:icons/xxx.svg` = `data_root/icons/xxx.svg`。sim 用 pulse-esp 副本 lvgl 9.6(非设备 9.5), sim 的 SVG 渲染同样失败但设备端是权威。

**状态栏连接图标:**
- `cerb_voice_ui.c`: `usb_connected()` Lua 绑定 → `usb_serial_jtag_is_connected()`(USB 主机 SOF 检测)。
- `launcher.lua`: 状态栏单闪电图标(`bolt`), 白=Mac 连接, 灰=未连接; `paint_home` 每秒刷新颜色。红色 mic 点已删。

**时间同步(NVS 持久化):**
- `cerb_console` `cmd_settime`: settimeofday + NVS 保存(`cerb_clock/epoch`); console CMakeLists 加 `nvs_flash` REQUIRES。
- `main.c` `restore_clock_from_nvs()`: boot 时(init_timezone 后)恢复 epoch → 断电重启后时钟/Year 立即正确, 不依赖 Mac ≤60s 同步。
- `launcher.lua` Year: `paint_home` 每秒重算 `year_progress`, 变化时更新 meter + `hud.year_stale` → 空闲刷新 page-1 快照。

**Why:** SVG→ThorVG 软件渲染在 P4 空白是固件级限制(非代码 bug); 字体栅格化路径已验证可靠(时钟/日期字体正常)。icon 显示失败被误判为尺寸问题, 实际是 SVG 渲染空白 + FD 耗尽 fallback。

**How to apply:** 新图标: 1) 加 FA 字形到 fa-icons.ttf(hb-subset) 2) `FA_GLYPHS` 加映射 3) `aiodi.icon_label` 用。勿改回 svg_icon。改 icon 尺寸在 launcher `icon_px`。改字体/路径注意 system.bin(fatfs_image/storage) 需重刷。

**Related:** [[lvgl-svg-multipath-bug]] [[cjk-font-subset-hb-subset]] [[cerberus-native-sdl-sim]] [[aiodi-ui-design-standard]] [[cerberus-real-subscription-data-p4]]
