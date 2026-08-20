---
name: pitfall-slice-plan-reflection-gaps
category: pitfall
summary: 切片计划的两类反思 FAIL(2026-07-10 one-prompt-app 计划)——逐场景处置缺失、-impl 需 -test 配对、共享头文件落公共上游;含 plan-v2 检查表缺陷清单
source: docs/plans/2026-07-10-open-deskos-one-prompt-app-plan Phase 4 反思(PLAN-COV-01、TEST-01 首轮 FAIL,修复后复检 PASS)
created: 2026-07-10
updated: 2026-08-08
---

## Fact

1. **切片计划必须逐场景处置,不能按章节粗粒度处置。** 设计有 47 个 BDD 场景而计划只做一个切片时,BDD Coverage 表按章节写"部分/押后"会静默漏掉个别场景(本例:侧载 .cerb-pack、Runtime XML Screen 两条既没进任务也没进处置表)。每个未覆盖场景都要有带命名去处的处置行(NT-x 范围外 / 押后 HG-x / 被总纲反转)。
2. **组合根任务命名 `-impl` 就必须有 `-test` 配对(TEST-01 豁免集只有 setup|config|spike)。** 出路不是豁免,而是把组合根里可宿主机测试的调度逻辑(本例:串口命令面 `odk_console`)抽成纯组件做 RED,把 HIL 判据记录单作为 RED 工件一并落盘;接线层保持 wiring-only。
3. **共享头文件要落在公共上游任务,否则并行批次编译炸。** `odk_err.h` 最初由 003-test 创建而 004/007-test 并行消费——移到 002(基座任务)后并行声明才成立。检查表缺"Consumes 工件必须有 depends-on 祖先"一项(DEP-02 只查引用可解析)。

## Why

Phase 4 反思首轮 PLAN-COV-01、TEST-01 均 FAIL,修复后复检 PASS。三类教训的共同根因是检查表按章节/豁免粗粒度处置,导致个别场景、测试配对、共享头文件依赖被静默漏过。

## How to apply

下次 retrospective 修 plan-v2 检查表:

- PLAN-COV-01 的 `grep -E "^Scenario:"` 对缩进 gherkin 永远 0 命中(空过);需 `^[[:space:]]*Scenario:` + `grep -F` 标题匹配。
- DEP-02 的 grep 会扫到跨计划 prose 引用(06-13 task-013/025)误报;应限定在 Execution Plan YAML 块。
- 候选新条目:DEP-03(Consumes→depends-on 祖先)、GRAPH-01(依赖图与 YAML 逐边一致)、`type: integration` 的 TEST-01 处置规则。

## Related

- `docs/plans/2026-07-10-open-deskos-one-prompt-app-plan/`(触发本次反思的计划)
- `docs/retros/retro-2026-07-11-host-vs-target-managed-patch.md`(复用本记忆的教训)
