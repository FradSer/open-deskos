---
name: "open-deskos-openui-contract-mapping"
description: "OpenUI 当前接入：模型拥有组合、宿主拥有事实与权限；proactive 链路主动不用 Jev 分类器、只问一个 usefulness 问题；卡片数值机械绑定到已引用读数；渲染器区分各原语"
type: project
---

用户判定旧实现「和不使用 OpenUI 一样」：渲染结果仍是 `advice + 平铺 chips + 按钮` 的固定形态。诊断确认三层压制：`HOST_RULES` 禁止散文/限制 Readings 至 3、唯一示例就是 Advice+chips；Jev 的 grounded/unsupported 问题把每个可见卡片字符串当事实断言，组合越丰富越难过 0.8；渲染器把 Badge/Chip/Reading/Metric 全压成 `makeChip`、Stack/Readings 压成同一 class，16 个原语只剩约 8 种 DOM 形状。

**当前设计（模型拥有结构，宿主拥有事实与权限）**：
- `src/openui-contract.mjs`：`OPENUI_EXAMPLES` 提供三份明显不同的通用组合；`HOST_RULES` 要求「Different topics deserve different compositions」「Compose the card freely」，不再禁止报告式 Heading/Text 或把卡片限成扁平 chip 列表；`Readings` 放宽到 1-8。
- `src/proactive-qualification.mjs`（新）：`createProactiveJudge` 主动关闭 Jev 分类器，用 resident 普通零工具模型只问**一个** usefulness 问题；不构造 Jev client、不发 grounded/unsupported 问题、不把卡片文本或 `uiText` 放进判定 state。intent routing 的 Jev 客户端保持不变。判定 receipt 仍是 `{model, probability, groundingProbability, threshold, trigger, judgedAt}`，`model` 为 `provider/model`，旧 checkpoint 仍可加载。
- `src/agent.mjs` 暴露 `judgeOrdinary`；`src/main.mjs` 的 watch judge 与 `agent.mjs` 生成会话内 `proactive_judge` 都改走 `createProactiveJudge`；`scripts/test-agent-path-live.mjs` 同步。
- `src/proactive-generation.mjs` 的 `validateCardText`：拒绝整句复述 advice 的散文、重复 Reading/Metric 对、以及 Reading/Metric **value** 里没有已引用观测支撑的数字（whole-token compare）；散文里的数字是呈现语言，不作事实断言。
- `src/proactive-jev.mjs` 不再是 proactive 链路的判定入口（保留给其他引用/兼容）。
- 渲染器 `runtime/shell/src/renderer/core/openui-dom.js` + `personal-agent-status.css`：Badge 独立为 span、Metric 加 `data-emphasis`、Stack/Readings/Row 用声明式 `openui-*` class（保留 `personal-agent-preview-chips` 兼容几何）、Heading 加引导线；仍守单一 17px、一个卡片表面、无同心框、textContent、语义 `--odk-*`。

Why: 之前「修冗余」把系统收敛到 advice 唯一句子反而固化了固定表单；关闭 Jev 分类器本身不够，必须同时改判定问题、放开生成规则、让渲染器区分原语。How to apply: 改建议 UI 时同时核对 OPENUI_EXAMPLES、HOST_RULES、proactive-qualification 的问题措辞、宿主数值绑定、以及三个冻结的 Electron gate（openui-dom / agent-type-scale / agent-radius）。
