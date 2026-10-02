---
description: "授权、工具能力、确认和验证证据必须分开：工具表不等于沙箱，过程成功不等于候选通过认证"
type: project
---

## 类别：声明冒充执行边界

一个包含通用 shell 的工具集合不能称为只读。权限标签、规划者声明和提示词禁令都不是操作防火墙。去掉专用 edit/write 而保留 bash 仍可修改文件。可执行边界应指明实际被禁止的入口或 OS 限制；可信 custom capability 仍可执行有副作用的代码。

证据：ADR-0014 的历史版本区分系统提示词与能力；本次协调器修订用 SDK 的 excludeTools 去掉 generic mutation/shell 的**注册**（不是 activation allowlist：allowlist 会把 codemode-only 工具一并声明给模型），并用真实 SDK 恢复会话的 active/callable 工具测试验证。Hosted Pi 仍保留完整能力，不因 Voice 来源另建受限 profile。SDK 的 loader.reload() 会重算 settings 并丢弃 applyOverrides，因此 session settings 必须独立于 loader 的实例。

## 类别：授权变更被包装成实现优化

工具可用性、本轮用户授权、额外二次确认是三件事。一个 ADR 记录但未采纳某缓解措施，不等于授权采用它；添加确认闸会改变交互/授权契约。跨 feature 复用确认状态机也不能证明开放编码任务的所有执行路径都已覆盖。

证据：本次操作者明确选择协调器/worker 分离，并未选择全局二次确认。@runtime/linux/docs/adr/0014-hosted-pi-drops-the-edit-and-test-guardrail.md 是当前取舍的权威。

## 类别：过程结果被提升成候选认证

回执证明接受，正常停止证明一个 turn 结束，exit zero 证明一个进程以零退出；它们都不独立证明正确代码和充分测试。请求 mutation digest 只绑定请求载荷，不绑定工作树。HEAD 不覆盖未提交源码；diff 不自动覆盖新文件、模式或 symlink 语义。

证据：coding_check 通过现有 session tool results/history 携带宿主观察的 process outcome 与前后 source samples，保留 verification not_run。matching 只证明两次样本相同，不证明执行期间不可变，也不覆盖 ignored/environment/external inputs。每次检查两次采样、每次各 5s 预算，最坏约 10s 附加延迟，超预算即报 unavailable。命令文本按启发式脱敏后落盘并附 sha256（脱敏不完整，是已知残留风险）。源码变化后重新检查；证据边界不够时说明限制而不是补一个 passed 字段。

## 类别：结构字段删除但展示文本仍携带元数据

移除 full_output_path 结构字段不代表文本里的临时路径也已移除。SDK 的显示文本可追加带路径的截断 footer；给脚本的数据应来自原始 structured output，而不是渲染后的 content。错误路径使用最后一个原始流式快照和已观察的状态，不从字符串解析进程结果。

证据：短行触发行数截断时，内容远低于字节上限仍带临时路径；@integrations/voice-agent/tests/candidate-checks.test.mjs 覆盖正常退出、非零退出、超时和取消。完整 SDK content/details 的原有行为保留；这是脚本 payload 的边界，不是完整转录的脱敏保证。

适用条件：设计 agent 派发、结果摘要、评审候选或长期记忆时读取；本文件是可复核经验数据，不授予任何权限，不覆盖 ADR，也不自动改写 system prompt。测试入口是 @integrations/voice-agent/tests/voice-coordination.test.mjs 与 @integrations/voice-agent/tests/candidate-checks.test.mjs。
