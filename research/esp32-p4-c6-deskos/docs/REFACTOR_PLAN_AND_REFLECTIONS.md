# Open DeskOS 插件化重构执行计划与深度技术反思 (Refactor Plan & Technical Reflections)

> **目标**：将 Open DeskOS 从 97KB 单体 Launcher 重构为高内聚、低耦合、多尺寸 Widget 插件化系统  
> **制定日期**：2026-08-16  
> **指导思想**：Clean Architecture、BDD/TDD 验证、零表分配热路径、渐进式重构

---

## 1. 深度技术反思与权衡分析 (Deep Reflections & Trade-offs)

### 1.1 现状诊断 (Monolithic Pain Points)
当前 `research/esp32-p4-c6-deskos/firmware/components/lua_modules/lua_module_lvgl/lib/launcher.lua` 达到了 97KB（约 2500 行），它同时承担了以下 7 种互不相关的职责：
1. **多页面滑动与快照缓存管理**（Pager + Snapshot + Scroll Hooks）
2. **Dashboard 流式叙述文本生成与布局**（Dashboard Page Builder）
3. **主屏 3×4 静态网格绘制**（Hardcoded Home Grid Builder）
4. **Agent Quota 监控屏绘制**（Agent Quota Page Builder）
5. **应用中心与商店界面整合**（App Center Integrator，相关实现已从仓库移除）
6. **Hero 转场动画与生命周期调度**（Hero Animation Engine）
7. **Pomodoro 等特例业务逻辑内联**（Inline App Logic & State Sync）

**核心缺陷**：
- **无法扩展新组件**：新增一个带多种大小的 Widget 必须侵入式修改 `launcher.lua` 内多个函数。
- **无法自定义桌面**：用户或 AI 无法通过配置文件定义自己的桌面排布。
- **App 与 Widget 脱节**：Widget 没有统一的规格定义，也缺乏“多尺寸适配”的概念。
- **Dashboard 封闭**：Dashboard 的数据项写死，其他应用（如外部待办、习惯打卡）无法向 Dashboard 注入指标。

---

### 1.2 架构权衡与技术考量 (Architectural Considerations)

#### A. 内存与 GC 压力 (RAM & Garbage Collection)
- **风险**：拆分成多个小文件和模块后，`require` 加载的模块对象增多，如果 Widget `on_tick` 中频繁创建临时 table，会在 ESP32-P4 上引发周期性 GC 停顿（造成帧率抖动）。
- **对策**：
  1. 所有 Plugin 在系统启动时由 `plugin_registry` 单例加载并缓存，不重复执行代码加载。
  2. 桌面可见 Widget 的 `on_tick` 严格限制只在数据发生实际变化时调用 `label:set_text()` 等轻量 API，严禁在 tick 内部分配局部 table。
  3. `state_store` 采用深层结构复用，避免产生瞬态事件对象。

#### B. 快照分页器兼容性 (Snapshot Pager Integrity)
- **事实**：Open DeskOS 在 ESP32-P4 上通过 pre-rendered RGB565 快照实现 60 FPS 顺滑滑动（26ms/帧）。
- **挑战**：当 Widget 中的内容实时动态刷新（例如时钟秒数、番茄钟倒计时、用量百分比更新）时，快照可能会过期。
- **对策**：
  1. 维持当前成熟的“静止时实时渲染 + 拖拽开始前截取/更新快照 + 滑动中仅 blit 快照”机制。
  2. 当 Widget 内部状态有重大变更时，通过 `ctx.invalidate_snapshot()` 标记脏页面，在下一次空闲周期或滑动前低开销重刷快照。

#### C. Hero 转场动画的几何解耦 (Decoupled Hero Transitions)
- **挑战**：原本的 Hero 动画紧密依赖 `launcher.lua` 内写死的格子坐标计算。解耦后，不同大小（1x1, 2x1, 2x2, 3x2）的 Widget 任意放置在网格中，Hero 如何准确获取源矩形？
- **对策**：
  1. `widget_engine` 在挂载 Widget 时，将标准外卡片容器的绝对屏幕坐标 `(x, y, w, h)` 记录在 Widget 上下文中。
  2. 点击事件由 `desktop_composer` 统一捕获，并提取源矩形 `source_rect` 传递给独立的 `hero_navigator` 模块。
  3. `hero_navigator` 纯粹负责几何插值与全屏容器动画，完全独立于 Widget 内部实现。

#### D. Dashboard 流式叙述插件化 (Pluggable Dashboard Flow)
- **挑战**：原 `dashboard_layout.lua` 的自然语言左对齐流式排版非常优秀，但其数据源（events, tasks, habit, focus）是硬编码的。
- **对策**：
  1. 保留 `dashboard_layout.lua` 的核心流式排版器与度量算法。
  2. 引入 `dashboard_engine.lua`，它在排版前向已注册的插件收集数据提供者（Providers），动态组装出待排版的语义 groups。
  3. 点击流式文本中的特定词组（如 `99 focus`），可以直接触发打开对应的 `pomodoro` App。

---

## 2. 重构执行步骤与里程碑 (Step-by-Step Milestones)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Milestone Progression                           │
│                                                                        │
│  [Phase 1: Core Subsystems]                                            │
│    ├── 1.1 plugin_registry.lua (Plugin Catalog & Lifecycle)            │
│    ├── 1.2 widget_engine.lua   (Grid Sizing & Mounting)                │
│    ├── 1.3 hero_navigator.lua  (Decoupled Transition Engine)           │
│    ├── 1.4 pager.lua           (Multi-page Snapshot Pager)             │
│    ├── 1.5 dashboard_engine.lua(Pluggable Narrative Collector)         │
│    └── 1.6 desktop_composer.lua(Declarative Spec Parser)               │
│                                                                        │
│  [Phase 2: Builtin Plugins Migration]                                  │
│    ├── 2.1 plugins/clock/ (1x1, 2x1, 2x2 + App)                        │
│    ├── 2.2 plugins/calendar/ (1x1, 2x2 + App + Dash Provider)          │
│    ├── 2.3 plugins/pomodoro/ (1x1, 2x2 + App + Peek + Dash Provider)   │
│    ├── 2.4 plugins/quota/ (2x1, 3x2 + App + Peek)                      │
│    ├── 2.5 plugins/year/ (1x1, 2x1, 1x2 + App)                         │
│    ├── 2.6 plugins/almanac/ (1x1, 3x2 + App)                           │
│    ├── 2.7 plugins/settings/ (1x1 + App)                               │
│    ├── 2.8 plugins/chat/ (1x1, 2x1 + App)                              │
│    └── 2.9 Simple utility plugins (dice, breath, hydrate, mantra)      │
│                                                                        │
│  [Phase 3: Desktop Config & Launcher Assembly]                         │
│    ├── 3.1 config/desktop_layout.lua (Default Composable Spec)         │
│    └── 3.2 launcher.lua (~300 lines Composition Root)                  │
│                                                                        │
│  [Phase 4: Simulator & Host Verification]                              │
│    ├── 4.1 Native SDL2 Simulator Multi-size Rendering Verification     │
│    ├── 4.2 Hero Transition & Back Navigation Verification              │
│    └── 4.3 Snapshot Swipe & Performance Profile Check                  │
│                                                                        │
│  [Phase 5: ESP32-P4 Target Build & Hardware Verification]              │
│    ├── 5.1 FATFS system.bin Regeneration & idf.py Build                │
│    ├── 5.2 Flash to ESP32-P4 Hardware via esptool                     │
│    └── 5.3 Serial Monitor & Touch Interaction Verification             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 验收与质量门槛 (Acceptance Criteria)

1. **结构清晰度**：`launcher.lua` 代码量降低至 400 行以内，各核心子系统代码完全模块化放置在 `core/` 下。
2. **多尺寸 Widget 完整支持**：系统能同时并正确渲染 `1x1`、`2x1`、`1x2`、`2x2`、`3x1`、`3x2` 各尺寸 Widget。
3. **点击展开 (Hero Animation)**：点击任意 Widget，无缝平滑放大进入对应全屏 App；点击返回按钮平滑缩回原 Widget。
4. **Dashboard 插件数据流**：Dashboard 动态收集各插件提供的数据，保持完美的自然语言排版与点击交互。
5. **双环境一致性**：Native SDL 模拟器与 ESP32-P4 真机硬件 100% 行为一致，零报错、零白屏、零卡顿。
