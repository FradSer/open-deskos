---
name: "open-deskos-remote-bridge-runtime-unavailable-failures.md"
description: "integrations/remote-bridge 兄弟套件运行报 25 tests / 23 pass / 2 fail：两个 unified runtime control 测试失败于 `Plugin command failed: runtime-unavailable`；在 HEAD 的干净 worktree 中重跑得到相同 exit 1、相同计数与相同两个失败标题。"
type: project
---
Observed：在 `integrations/remote-bridge` 下运行兄弟测试套件时报 `ℹ tests 25`、`ℹ pass 23`、`ℹ fail 2`，失败标题为 `single bridge serves unified runtime control without stopping independent resources` 与 `transport host serves unified runtime control without stopping independent resources`。

失败信息包含 `Error: Command failed: <node> .../runtime/shell/scripts/odk-plugin-cli.js disable odk.remote.transport.fixture --runtime` 与 `Plugin command failed: runtime-unavailable`。

Conditions：在 HEAD 的干净 detached worktree 中重跑同一批套件，仍得到 `exit: 1`、`tests 25` / `pass 23` / `fail 2` 以及同样两个失败标题，说明这两个失败不依赖当时工作树中未提交的测试改动。

Why：这两个失败在本仓库当前 HEAD 即可复现，改动测试文件时不应把它们当作本轮改动引入的回归；How to apply：判定归属前先在没有改动的工作树上重跑同一批套件。Revisit：若之后出现 `odk.remote.transport.fixture` runtime 路径或这些套件的新源码/运行证据，或出现这两个测试通过的一次运行，再复核本条。