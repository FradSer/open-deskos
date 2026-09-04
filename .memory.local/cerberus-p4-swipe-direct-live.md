---
name: cerberus-p4-swipe-direct-live
description: "P4 480x800 主页滑动性能：TRIPLE_FULL、PPA、snapshot pager 与独立触摸采样将瓶颈降至约 26-29ms/帧"
type: project
---

P4 主页滑动的主要瓶颈是软件绘制整帧和快照合成，而不是 LVGL 不支持拖动。未经快照的实时 FULL 滚动约 250–434ms；复杂 launcher 快照分页约 26.2–29.5ms/帧，纯色 Direct 可达约 16ms/帧。

**已落地：**
- 使用 `esp_lv_adapter` TRIPLE_FULL，三张 DPI framebuffer 直接绘制到非可见 buffer；不使用已知会引入 settle 卡顿的 DOUBLE_FULL/TRIPLE_PARTIAL 路径。
- 开启 PPA fill/image blend。
- GT911 由独立 task 以 4ms 节拍采样，LVGL callback 只消费 PRESS/MOVE/RELEASE 缓存事件。
- pager 预渲染 RGB565 snapshot，拖动时只 blit snapshot，再执行 snap/momentum。

**下一步：**
- A/B `on_frame_buf_complete`/`on_vsync` 与当前 frame callback。
- 用 `momentum=false`、`snap_anim=0` 建立纯拖动基线。
- 只有 trace 证明收益足够时才评估多 draw unit 或其他高风险并行化。

**Why:** 全帧 CPU 填充率是当前帧率上限；快照和 framebuffer 生命周期能减少重复绘制，但不能把 CPU 路径误判成 GPU 加速。

**How to apply:** 新的滑动优化先测量纯色、无快照、快照三种基线，再改 adapter/frame lifecycle；不要回退到已经验证会产生 settle 卡顿的 buffer 模式。

**Related:** [[cerberus-native-sdl-sim]] [[lvgl-lua-binding-part0-ceiling]] [[open-deskos-top-spec]]
