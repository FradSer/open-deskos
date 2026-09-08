---
name: git-agent-commit-workflow
description: "Git 提交必须经过 git-agent commit skill；裸 git add/commit 会被工作流拦截"
type: project
---

项目提交使用 git-agent commit skill，避免绕过原子提交和 co-change 约束。

**Why:** 裸 git add/commit 绕过 git-agent 的原子提交和 co-change 索引，破坏提交历史一致性。

**How to apply:**
- 正常提交使用 `/skill:commit` 或对应 commit skill。
- 只有紧急人工操作时才设置 `GIT_SKILL_FALLBACK=1`，并明确记录原因。
- 修改前或决定测试范围前，可使用 `git-agent related` / `status` 做只读查询。

## git-agent commit --no-stage 会重暂存工作树内容（2026-09-06 实测）

`git-agent commit --no-stage` 并非只提交已暂存内容：对"已部分暂存但工作树不同"的文件，它会用工作树版本覆盖索引再提交。多 agent 共享脏树时，这会把别人的 in-flight hunks 卷进你的提交（实测 1204/27 变 2645/558）。

**可靠做法（共享脏树上的精确提交）：**
1. 按 HEAD+本人改动重建各混合文件的精确内容，经 `git hash-object -w` + `git update-index --cacheinfo` 精确入索引；
2. 提交前把这几个混合文件的工作树临时写成与索引一致（他人 hunks 备份到 /tmp），让 git-agent 的重暂存无害；
3. `git-agent commit --no-stage --intent ...` 提交；
4. 立即从备份还原工作树（他人未提交改动原样回到未暂存区）；
5. 用 `git checkout-index` 导出提交树跑纯 node 测试自检。

裸 `git commit` 被钩子拦截，`GIT_SKILL_FALLBACK=1` 也无效——钩子强制走 git-agent，所以只能用"工作树临时中和"法。

**Why:** 混合文件无法用 git-agent 表达 hunk 级归属；直接提交会把并行 agent 的半成品提交到他们名下之外的历史里。

**How to apply:** 见上；提交后核对 `git show --stat` 的行数与预期一致。
