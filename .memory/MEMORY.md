## UI Architecture & Design System
- [Modular Plugin & Widget Architecture](cerberus-modular-plugin-architecture.md) — Open DeskOS 插件化与多尺寸 Widget 架构体系：Plugin Registry、Widget Engine、Hero Navigator、Declarative Composer 与 AI-Ready 规范
- [AIODI UI design standard](aiodi-ui-design-standard.md) — 设备端 LVGL/Lua OS shell 使用 AIODI 暗色卡片设计系统；token、builder 和生成 linter 必须保持同步
- [FontAwesome 图标栅格化](cerberus-icon-rendering.md) — 设备端图标使用 FontAwesome 6 字体栅格化而非 SVG，解决 LVGL ThorVG 渲染空白问题
- [Text Metrics & Narrative Layout](cerberus-text-metrics-harness.md) — Lua font measure API 与 adaptive Dashboard 左对齐叙述流式布局验证规则
- [ESP32-P4 3D Avatar & Peek Engine](cerberus-p4-3d-avatar-rendering.md) — ESP32-P4 LVGL/Lua 3D Avatar 与 Peek 卡片双态规范、S 曲线动画与身体呼吸平移/注视解耦 60 FPS 优化
- [Avatar Lab 数学移植](cerberus-avatar-lab-math-port.md) — avatar_widget.lua 严格移植 bible-strong-avatar-lab 的 geometry/surfaces/ambientMotion 数学，热路径辅助函数零表分配
- [Avatar Peek-only interaction](cerberus-avatar-peek-only.md) — avatar 仅通过底部 peek 消费，持久卡片点击处理器必须一次注册且不可残留 flex 状态

## Hardware & Board Bring-up
- [P4 launcher boot render path](project_p4-launcher-boot-render-path.md) — P4 MIPI-DSI launcher 使用默认 esp_lv_adapter TRIPLE_FULL；显式 partial 可能挂起启动并黑屏
- [ST7701S DSI Display Bring-up](cerberus-p4-display-lit.md) — Guition JC4880P443C 板级权威与 ST7701S 480x800 点屏路径
- [P4 Dev Board Pin Map](p4-module-schematic-pins.md) — ESP32-P4 开发板原理图 GPIO 引脚权威映射表与 FFC 接口位定义
- [P4+C6 esp-hosted 运行基线](cerberus-p4-c6-esp-hosted-up.md) — Guition P4+C6 运行基线：480x800 显示、GT911 触摸、esp-hosted SDIO 与 Wi-Fi 连接
- [CM5/S31 迁移评估](cerberus-rpi-migration-eval.md) — Orange Pi CM5/RK3588S + ESP32-S31 独立迁移候选架构与分步验证边界

## Firmware Build & Host Testing
- [Host vs IDF 构建差异](cerberus-firmware-host-vs-idf-build.md) — Open DeskOS 固件 host CTest 绿不代表 idf.py build 绿；注意 REQUIRES、snprintf 截断与注释闭合陷阱
- [IDF 工具链激活](idf-toolchain-activate.md) — P4 MIPI-DSI 构建使用 eim + IDF 6.0.1+
- [SDL2 Native Simulator](cerberus-native-sdl-sim.md) — SDL2 480x800 Native 模拟器架构：跑真 C 绑定/Lua UI，无需 ESP-IDF/emsdk

## LVGL Engine & Rendering Constraints
- [LVGL Part 0 样式限制](lvgl-lua-binding-part0-ceiling.md) — set_style 只写 LVGL part 0，指示器/填充层样式需通过特定标志或层叠容器替代
- [LVGL SVG 多路径限制](lvgl-svg-multipath-bug.md) — LVGL/ThorVG 构建只渲染多 path SVG 的最后一个 path，多色图标需用叠加容器
- [CJK 字体子集工具](cjk-font-subset-hb-subset.md) — hb-subset (HarfBuzz) 是生成有效 CJK TTF 子集的唯一可靠工具
- [P4 Swipe & Frame Performance](cerberus-p4-swipe-direct-live.md) — P4 480x800 主页滑动性能：TRIPLE_FULL、PPA、snapshot pager 与独立触摸采样

## Data & Application Integrations
- [Open DeskOS Top Spec](open-deskos-top-spec.md) — OPEN-DESKOS.md 是产品权威；P4+C6 主线、Guition 480x800 优先板与 CM5/S31 独立迁移候选
- [Subscription Data Architecture](cerberus-real-subscription-data-p4.md) — P4 OpenCode Go 订阅数据架构：cerb_sub、console sub、Mac SubBridge 与屏幕数据绑定
- [PocketJS 评估结论](pocketjs-esp32-p4-eval.md) — PocketJS 评估结论：不替换现役 P4 LVGL+Lua，缺乏 LVGL 后端与真机证据

## Workflow & Harness Preferences
- [git-agent 提交工作流](git-agent-commit-workflow.md) — Git 提交必须经过 git-agent commit skill；裸 git add/commit 会被拦截
- [Text-only Model Constraint](text-only-no-screenshots.md) — 文本模型视效验证需依赖可观测输出、日志与 Lua layout harness
