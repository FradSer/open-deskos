# Guition 480×800 LVGL 9 横向分页：卡顿与“不跟手”研究结论

> 研究日期：2026-08-09（以下官方资料均在此日访问）  
> 范围：ESP32-P4、480×800 RGB565 MIPI-DSI、GT911、LVGL 9、横向 snap 分页。  
> 资料范围：只使用 LVGL 官方文档、Espressif ESP-IDF/BSP 官方文档或源码，以及 Espressif `esp_lvgl_adapter` 官方文档。

## 结论先行

当前“有好转但仍卡、整体不跟手”不应继续只看 LVGL 的 FPS。最可疑的是一条串行链路：GT911 的 I²C 读取发生在 LVGL 的 input read callback 中，读取期间 LVGL handler 不能继续处理滚动、动画或刷新；而当前显式的 `FULL + 2 FB` 又会在拖动时反复渲染整个 480×800 画面。快照 pager 只在滚动事件发生后接管，不能消除首次手势识别和首个滚动帧的延迟。这是结合本地实现与官方语义得到的推断，必须用时间戳验证。

优先级应是：

1. 先测出触摸采样、`LV_EVENT_SCROLL`、LVGL render、flush 和实际显示同步之间的 p50/p95 延迟。
2. 让 LVGL input callback 只取已缓存的触摸数据；若硬件有 GT911 INT，再由独立 task 负责 I²C `read_data`。当前板级代码的 RST/INT 是 NC，因此 INT 路径只能作为有硬件改线后的实验；没有 INT 时仍应先测量同步轮询的 I²C 时长。
3. 将已弃用的 `on_refresh_done` 与 ESP-IDF 推荐的 `on_frame_buf_complete` / `on_vsync` 分开验证，不要把“用户 draw buffer 可回收”误当成“画面已经显示”。
4. 暂时关闭 momentum 和 snap 动画，确认拖动阶段能否逐采样跟随手指，再单独调 release 后的吸附动画。
5. 在同一组页面和同一组手势上比较 `DOUBLE_DIRECT`、`DOUBLE_FULL`、`TRIPLE_FULL`/`TRIPLE_PARTIAL`；不要同时改变渲染模式、触摸周期和分页物理参数。

这里的“跟手”验收应以 `touch sample → scroll position change → display presentation` 的延迟衡量，而不是只以 sysmon FPS 衡量。

## 2026-08-09 实施与基准更新

研究结论已先落地为两个可逆、可测的输入/渲染改动：

- 启动器现在使用 `render="direct"` 和两张 480×800 RGB565 DPI frame buffer；LVGL 只同步脏区，不再强制每个拖动样本整屏重绘。
- GT911 的 I²C 读取由 core 0 的独立采样任务以绝对 4 ms 节拍执行；LVGL callback 只取内存中的语义样本。它每次最多消费一个 `PRESS`/`MOVE`/`RELEASE`，不会通过 `continue_reading` 在一次 handler 中回放整段历史轨迹。
- 连续两次空触点（8 ms）才确认 release；单次 I²C 读取失败仍保留 12 ms 的错误宽限。这两项避免把同一根手指误拆为两笔 page swipe。

在真机的三页纯色 Direct 最小样例中，五次自动分页为 15.8–16.8 ms/帧；复杂启动器快照分页的程序化滚动仍为 26.2–29.5 ms/帧。前者证明显示/VSYNC 基线可达约 60 Hz，后者说明 RGB565 快照图像合成仍是复杂页面的成本。两者都不是手指实测；最终验收仍需按本文的 `touch → scroll → presentation` 时序和真机快速反向短划验证。

## 研究开始时的本地现状快照

以下是本研究读取工作树时的现状，不是对未来实现的约束：

| 链路 | 当前观察 | 相关本地文件 |
|---|---|---|
| 显示 | MIPI/RGB 使用手写 `FULL` 路径，取得 2 个 DPI frame buffer；DPI 时钟配置为 34 MHz | [`lua_lvgl_runtime.c`](../../firmware/open-deskos/components/lua_modules/lua_module_lvgl/src/lua_lvgl_runtime.c)、[`odk_display_bringup.c`](../../firmware/open-deskos/application/edge_agent/main/odk_display_bringup.c) |
| 输入 | `esp_lcd_touch_read_data()` 在 LVGL indev read callback 中同步调用，再取得触摸数据；读取 timer 为 8 ms；scroll throw 为 20、scroll limit 为 4 | [`lua_lvgl_indev.c`](../../firmware/open-deskos/components/lua_modules/lua_module_lvgl/src/lua_lvgl_indev.c) |
| 分页 | 预渲染快照、横向 `snap_x=center`、momentum、`scroll_one`，吸附动画约 160 ms | [`launcher.lua`](../../firmware/open-deskos/components/lua_modules/lua_module_lvgl/lib/launcher.lua) |
| 交互入口 | voice UI 显式要求 full render，tick/task 周期配置比 input read timer 更密 | [`odk_voice_ui.c`](../../firmware/open-deskos/application/edge_agent/main/odk_voice_ui.c) |

本地历史记录 [`guition-lvgl-60fps-path.md`](guition-lvgl-60fps-path.md) 已说明：提高刷新频率、DMA2D、PPA 和双缓冲曾改善数字 FPS，但 Direct/全屏路径也曾出现 tearing、underrun 或主题脏区放大的问题。因此下一步要把“输入延迟、渲染时间、flush 等待、面板呈现”拆开测。

## 关键判断

### 1. FULL 双缓冲解决的是并行，不是全屏渲染成本

LVGL 官方说明：`FULL` render mode 会始终重绘整个屏幕；两个 screen-sized buffer 允许 LVGL 绘制下一帧的同时把另一帧交给 DMA，但不会减少每次拖动的全屏绘制量。[LVGL display porting（官方，访问 2026-08-09）](https://docs.lvgl.io/9.0/porting/display.html)

这与当前横向拖动的访问模式相冲突：手指每移动一点，内容位置都可能变化；如果 live widget tree 仍参与渲染，就可能把一次 480×800 全屏绘制放进每个手势样本之间。快照可以把内容变成图像 blit，但它必须在触摸路径开始前准备好，且其内存搬运仍要计入 render/flush 时间。

LVGL 官方 snapshot API 支持 RGB565，并支持先计算所需大小、再写入调用方提供的 buffer；重复使用时应优先比较这种预分配路径与动态 snapshot 的代价。[LVGL snapshot（官方，访问 2026-08-09）](https://docs.lvgl.io/9.0/others/snapshot.html)

### 2. 同步 I²C 读取很可能让第一段拖动落后于手指

Espressif GT911 驱动的官方实现把 `esp_lcd_touch_read_data()` 定义为定期从控制器读数据并保存到 RAM；`esp_lcd_touch_get_data()` 只从缓存取得坐标。官方通用 touch 驱动还提供 INT GPIO 回调注册，但前提是传入有效的 INT GPIO。[GT911 README（官方，访问 2026-08-09）](https://github.com/espressif/esp-bsp/tree/master/components/lcd_touch/esp_lcd_touch_gt911)、[GT911 source（官方，访问 2026-08-09）](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch_gt911/esp_lcd_touch_gt911.c)、[generic touch source（官方，访问 2026-08-09）](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch/esp_lcd_touch.c)

因此当前把 `read_data()` 放进 LVGL read callback，会把 I²C 总线等待直接暴露给 `lv_timer_handler()`；8 ms 只是读取 timer 的调用间隔，不是从手指到画面变化的延迟保证。LVGL 官方还要求 tick 稳定且独立于 handler 的可变执行时间，handler 内的 timer、输入和事件回调是串行处理的。[LVGL integration overview（官方，访问 2026-08-09）](https://docs.lvgl.io/master/details/integration/overview/connecting_lvgl.html)

这解释了一个常见现象：平均 FPS 上升了，但刚按下或快速改变方向时仍“黏住”一拍。若没有 INT 引脚，不能凭空假设可以改成中断驱动；应测出 I²C read 的实际 wall time，并确认它是否占据了一个以上的 16.67 ms 显示周期。

### 3. 当前 flush 完成信号需要重新核对

ESP-IDF MIPI/RGB 文档明确区分：

- `on_color_trans_done` 表示用户提供的 draw buffer 已复制到 frame buffer，可以回收 draw buffer，但不表示该 frame 已经显示到面板；
- `on_frame_buf_complete` 表示作为 draw buffer 的 frame buffer 已经安全可复用；
- `on_vsync` 可作为垂直同步事件；
- `on_refresh_done` 已弃用。

这些语义来自 [ESP-IDF MIPI DSI LCD（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html)。当前手写 FULL 路径使用了已弃用的 `on_refresh_done` 名称，因此必须做一次 callback A/B，并分别记录 flush wait、frame buffer 复用和真实呈现；否则“等待更多”与“过早复用”都可能表现为卡、闪或偶发 tearing。

### 4. momentum/snap 会把“拖动”和“松手后的动画”混在一起

LVGL 官方的 scrolling 语义是：拖动释放时先计算 momentum endpoint，再找到最近的 snap point，并动画移动到该点；`LV_OBJ_FLAG_SCROLL_ONE` 还要求子对象可 snappable 且启用 snap alignment。[LVGL scrolling（官方，访问 2026-08-09）](https://docs.lvgl.io/9.5/common-widget-features/scrolling.html)

所以当前 `momentum + scroll_one + center snap + 160 ms` 的体验不等于“手指位置一变，页面立即停在手指位置”：前者是拖动期，后者是 release tail。要判断“不跟手”究竟来自输入/渲染，还是只是吸附物理，必须先做 `momentum=false`、`snap_anim=0` 的纯拖动基线。

LVGL indev API 也明确规定 `scroll_limit` 是开始拖动前需要滑过的像素数，`scroll_throw` 是 momentum 的减速参数，数值越大减速越快。[LVGL indev API（官方，访问 2026-08-09）](https://docs.lvgl.io/9.5/API/indev/lv_indev_h.html)

### 5. 配置的 2 ms 不等于每 2 ms 完成一次画面

LVGL timer handler 的下一次 deadline 由实际 timer 状态决定；tick 必须独立、可靠，handler 运行时间可能受 I²C、绘制、flush wait、锁竞争和日志影响。[LVGL integration overview（官方，访问 2026-08-09）](https://docs.lvgl.io/master/details/integration/overview/connecting_lvgl.html)

LVGL 官方 sysmon 能分别统计 FPS、CPU、render time 和 flush time；profiler 能记录 input/render/flush 时间并导出 Perfetto 可查看的 trace。[LVGL system monitor（官方，访问 2026-08-09）](https://lvgl.io/docs/open/debugging/sysmon)、[LVGL profiler（官方，访问 2026-08-09）](https://lvgl.io/docs/open/debugging/profiler)

在本问题上，“把 task period 再降一点”只能在测量证明 handler 没有被更慢的工作阻塞时才有意义。

## 推荐的分层方案

这是执行顺序，不是一次性修改清单：

1. **建立时序基线。** 用 profiler/sysmon 或低开销 ring buffer 同时记录 touch read start/end、indev callback、`LV_EVENT_SCROLL`、`LV_EVENT_REFR_START/READY`、render、flush、`on_frame_buf_complete` 和 `on_vsync`。LVGL profiler 支持自定义测量点，ESP-IDF 的 `esp_timer_get_time()` 提供微秒级时间戳；不要在手势路径大量打印日志。[LVGL profiler（官方，访问 2026-08-09）](https://lvgl.io/docs/open/debugging/profiler)、[ESP Timer（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/esp_timer.html)
2. **隔离输入延迟。** 若能提供 GT911 INT，独立 task 负责 `read_data()`，LVGL read callback 只取缓存的 `get_data()`；若 INT 仍 NC，则保留轮询，但测试 8/12/16 ms，并记录 I²C read p50/p95 和 handler 被占用时间。[GT911 source（官方，访问 2026-08-09）](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch_gt911/esp_lcd_touch_gt911.c)
3. **核对帧生命周期。** 在同一渲染模式下替换已弃用完成回调，分别以 frame-buffer complete 和 VSYNC 标记“可复用”和“已呈现”；检查 flush wait 是否减少、是否出现 tearing。不要把这一步和分页参数一起改。[ESP-IDF MIPI DSI LCD（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html)
4. **做纯拖动基线。** 先关 momentum、elastic 和 snap animation，必要时把 scroll limit 做 0/2/4 的小范围 A/B；确认内容能否跟随连续触摸，再恢复吸附与 release 动画。[LVGL scrolling（官方，访问 2026-08-09）](https://docs.lvgl.io/9.5/common-widget-features/scrolling.html)、[LVGL indev API（官方，访问 2026-08-09）](https://docs.lvgl.io/9.5/API/indev/lv_indev_h.html)
5. **比较官方渲染模式。** 在页面、手势、时序指标完全相同的情况下比较现有 FULL 2 FB 与 adapter 的 `DOUBLE_DIRECT`、`DOUBLE_FULL`、`TRIPLE_FULL`/`TRIPLE_PARTIAL`。adapter 文档把 `DOUBLE_DIRECT` 定位为小区域/widget delta，把 `DOUBLE_FULL`/`TRIPLE_FULL` 定位为大区域，把 `TRIPLE_PARTIAL` 定位为高分辨率流畅 UI；横向整页平移属于大区域，不能先验断言 direct 一定更快。[esp_lvgl_adapter mode selection（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html)
6. **再优化快照。** 只在 idle 期间预渲染；比较无快照、现有动态快照和调用方预分配 RGB565 buffer 的快照。记录首个 swipe 是否产生长帧、PSRAM/内部 DMA heap 余量、image blit render time 和 flush time。[LVGL snapshot（官方，访问 2026-08-09）](https://docs.lvgl.io/9.0/others/snapshot.html)、[ESP-IDF external RAM（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-guides/external-ram.html)
7. **最后调 buffer/cadence。** 只在 adapter partial 路径测试 `buffer_height`；官方说明更大的条带可减少 flush 次数但占用更多 RAM，小条带相反。记录实际 handler duration，而不是把 2 ms task period 当作帧周期。[esp_lvgl_adapter buffer height（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html)、[LVGL display refreshing（官方，访问 2026-08-09）](https://docs.lvgl.io/9.3/details/main-modules/display/refreshing.html)
8. **有数据再做调度/带宽实验。** ESP-IDF 建议对高吞吐/低延迟 task 分配合适优先级、让 task block/yield，并用 runtime stats/SystemView 识别真正的占用；MIPI DSI 文档警告提高 DPI clock 可能在 DMA 带宽不足或超过面板能力时导致 flicker。以当前 34 MHz 为基线，一次只改一个变量。[ESP-IDF performance（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-guides/performance/speed.html)、[ESP-IDF MIPI DSI LCD（官方，访问 2026-08-09）](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html)

## 排名实验矩阵

每个实验至少做左右两个方向各 20 次、冷启动与稳定态各一组；同一页面、同一手势速度、同一日志开关。下面的阈值是本产品的**建议验收门槛**，不是官方保证。

| 排名 | 实验与唯一变量 | 记录指标 | 建议通过条件 |
|---:|---|---|---|
| 1 | **端到端 trace**：只加低开销时间戳，不改行为。[LVGL profiler](https://lvgl.io/docs/open/debugging/profiler)、[LVGL sysmon](https://lvgl.io/docs/open/debugging/sysmon) | `touch→scroll`、`scroll→presentation`、handler/render/flush p50/p95；>16.67 ms 和 >33 ms 长帧比例 | 得到可复现 baseline；先定位 p95 最大的一段 |
| 2 | **输入隔离**：INT task+缓存 `get_data()`（若有 INT）对比当前同步 read；无 INT 时比较 8/12/16 ms 轮询。[GT911 source](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch_gt911/esp_lcd_touch_gt911.c)、[LVGL integration](https://docs.lvgl.io/master/details/integration/overview/connecting_lvgl.html) | I²C read wall time、read callback 占用、连续坐标间隔、首个 scroll 延迟、丢样本/重复样本 | `touch→scroll` p95 ≤16 ms，且不再出现整段手势停顿 |
| 3 | **frame completion A/B**：已弃用 `on_refresh_done` 对比 `on_frame_buf_complete`，另记 `on_vsync`。[ESP-IDF MIPI DSI LCD](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html) | flush wait、FB 复用间隔、VSYNC 间隔、tear/blank/underrun | 无 tearing/blank；无 callback timeout；flush p95 不回退 |
| 4 | **渲染模式 A/B**：FULL 2 FB 对比 adapter `DOUBLE_DIRECT`、`DOUBLE_FULL`、`TRIPLE_FULL`/`TRIPLE_PARTIAL`。[LVGL display](https://docs.lvgl.io/9.0/porting/display.html)、[adapter](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html) | render p95、flush p95、可见呈现帧率、FB/RAM、tear/underrun | 手势期间 >33 ms 长帧为 0；优先选择无 tear 且 p95 最低者 |
| 5 | **分页物理**：`momentum=false`、`elastic=false`、`snap_anim=0` 为基线，再只改变 snap duration；`scroll_limit` 做 0/2/4。[LVGL scrolling](https://docs.lvgl.io/9.5/common-widget-features/scrolling.html)、[LVGL indev](https://docs.lvgl.io/9.5/API/indev/lv_indev_h.html) | 原始 touch x、content x、release 后吸附耗时；拖动阶段位置误差 | 拖动阶段 p95 位置误差 ≤1 个采样周期；release 动画另行决定 |
| 6 | **快照策略**：无快照 vs idle 动态快照 vs 预分配 RGB565 buffer。[LVGL snapshot](https://docs.lvgl.io/9.0/others/snapshot.html) | 首次 swipe 最大帧、snapshot/blit render time、PSRAM/内部 heap、缓存命中/异常 | 快照只在 idle 产生；首个 swipe 不增加 >33 ms 长帧 |
| 7 | **adapter partial 条带**：仅在采用 `TRIPLE_PARTIAL` 时试 `buffer_height=50/80/100/160`。[adapter](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html) | 每帧 flush 次数、render/flush p95、DMA heap、面板 underrun | 在 RAM 不越界、无 underrun 下取得最低 flush p95 |
| 8 | **task/core/logging**：用 runtime stats/SystemView 做一次调度 A/B；关闭手势路径 verbose log。[ESP-IDF performance](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-guides/performance/speed.html)、[ESP Timer](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/esp_timer.html) | LVGL task runtime、锁等待、I²C task runtime、同核抢占、日志耗时 | p95 lock wait 不占据一个显示周期；task 有明确 block/yield |
| 9 | **DPI 带宽**：维持 34 MHz，只在前面实验确认 flush/扫描瓶颈后做单变量时钟 A/B。[ESP-IDF MIPI DSI LCD](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html) | VSYNC 稳定性、DMA underrun、flicker、flush p95、实际呈现帧率 | 只有在无 flicker/underrun 且时序满足面板 datasheet 时才保留 |

## 解释实验结果的决策树

```text
touch→scroll p95 高？
├─ 是：先查同步 GT911 I²C、LVGL 锁等待、handler 长任务；不要先换 pager 动画
└─ 否，但 scroll→presentation p95 高？
   ├─ 是：查 FULL 全屏 render、flush callback/FB 生命周期、PSRAM/DMA 带宽
   └─ 否，但仍感觉松手后拖？
      └─ 查 momentum、scroll_throw、snap duration、scroll_one 的 release tail
```

如果 trace 证明 live widget tree 的全屏重绘是主项，而页面内容在手势中确实静态，应用层可以采用“预栅格化页面 + 手势期间只平移图像 + 松手后提交页面状态”的架构。这是基于本地页面特性和 LVGL snapshot 能力的应用层推断，不是 LVGL 或 adapter 的强制规则；仍需通过第 6 项实验证明图像 blit 没有成为新的瓶颈。

## 建议的最终验收口径

以下是建议的产品门槛，供实验统一口径：

- `touch sample → LV_EVENT_SCROLL` p95 ≤16 ms；理想目标 ≤8 ms。
- `LV_EVENT_SCROLL → presentation marker` p95 ≤16.67 ms；20 次连续 swipe 中不得出现 >33 ms 长帧。
- 无可见 tearing、blank、颜色块、DMA underrun 或 callback timeout。
- 拖动阶段 content x 与 touch x 的延迟不超过一个采样周期；release 后的吸附时间单独记录，不混入拖动指标。
- sysmon FPS、render time、flush time、trace 中的 presentation marker 口径一致；不能用一个“80 FPS”数字代替显示器实际 VSYNC 结果。

## 官方来源索引（访问日期：2026-08-09）

- [LVGL display porting / render modes](https://docs.lvgl.io/9.0/porting/display.html)
- [LVGL scrolling, momentum, elastic, snap](https://docs.lvgl.io/9.5/common-widget-features/scrolling.html)
- [LVGL indev scroll limit/throw API](https://docs.lvgl.io/9.5/API/indev/lv_indev_h.html)
- [LVGL integration, tick, timer handler and locking](https://docs.lvgl.io/master/details/integration/overview/connecting_lvgl.html)
- [LVGL display refreshing](https://docs.lvgl.io/9.3/details/main-modules/display/refreshing.html)
- [LVGL system monitor](https://lvgl.io/docs/open/debugging/sysmon)
- [LVGL profiler and Perfetto trace](https://lvgl.io/docs/open/debugging/profiler)
- [LVGL snapshot API](https://docs.lvgl.io/9.0/others/snapshot.html)
- [LVGL animation](https://docs.lvgl.io/master/main-modules/animation.html)
- [Espressif esp_lvgl_adapter](https://docs.espressif.com/projects/esp-iot-solution/en/latest/display/tools/esp_lvgl_adapter.html)
- [ESP-IDF MIPI DSI LCD, DPI frame buffers and callbacks](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/dsi_lcd.html)
- [ESP-IDF LCD programming model](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/peripherals/lcd/index.html)
- [Espressif GT911 component README](https://github.com/espressif/esp-bsp/tree/master/components/lcd_touch/esp_lcd_touch_gt911)
- [Espressif GT911 driver source](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch_gt911/esp_lcd_touch_gt911.c)
- [Espressif generic touch source](https://raw.githubusercontent.com/espressif/esp-bsp/refs/heads/master/components/lcd_touch/esp_lcd_touch/esp_lcd_touch.c)
- [ESP-IDF performance guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-guides/performance/speed.html)
- [ESP-IDF external RAM guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-guides/external-ram.html)
- [ESP-IDF esp_timer](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/esp_timer.html)
