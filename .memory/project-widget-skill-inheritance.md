---
description: 上游 interface 参考一律平铺在 open-deskos-widget/references 下（operator 明令禁止顶层 jakubkrehel-skills 目录），interface-review 是创建后的独立流程而非实现步骤——由一条测试钉死
type: project
---

**这里只留一条代码本身读不出来的决定** ✓：operator **明令禁止**在 `.agents/skills/open-deskos-widget/` 下建顶层 `jakubkrehel-skills/` 目录 ✓，所有上游 interface 纪律必须**平铺**为 `references/` 下的同级 `.md` ✓ ✓；并且**要求 interface-review 是创建之后的独立流程**（单独的第 7 节 ✓），**不是实现工作流的一步** ✓ ✓。两者的理由分别是"不要在上游之上再造一层目录"与"评审不重开实现、也不阻塞部署"✓ —— 这两点从代码里推不出来，只能记住 ✓。

**权威与自查** ✓：结构由 `.agents/skills/open-deskos-widget/SKILL.md` 的第 6 节（两阶段阅读协议 ✓）与第 7 节（创建后 interface review ✓）定义 ✓，`DESIGN.md` 与该 skill 本身优先于任何继承来的通用建议 ✓ ✓。**不需要在记忆里复述这两节的内容** ✓ —— 那是文件里的权威文本，复制过来只会变成缓存并迟早过期 ✓ ✓（本文件先前复述了 51 个文件、约 270 KB 的清单与协议全文 ✓，正是要避免的形态 ✓）。

**一条命令自查** ✓：

```bash
cd runtime/linux && node --test tests/open-deskos-widget-skill.test.js
```

该测试钉死了：阅读协议的句子 ✓、不存在 `jakubkrehel-skills` 目录 ✓、存在 `## 7. Post-creation interface review` ✓、**不存在把 review 当作工作流步骤的 `**Review and verify**`** ✓，以及全部 entry/supporting 链接可解析 ✓ ✓。

**Why:** 记忆该存"为什么这样决定"和"去哪查"，不该存对方文件里已有的正文；前者丢了就永久丢失，后者随时能重读 ✓ ✓。

**How to apply:** 要改参考结构先跑上面那条测试 ✓；**不要把 SKILL.md 的协议文本搬进记忆** ✓，加引用即可 ✓ ✓。
