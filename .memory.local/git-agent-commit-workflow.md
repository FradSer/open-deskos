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
