---
description: 远程诊断这两台设备的四个反直觉陷阱：远端 pgrep -f 匹配自己的 ssh 命令行、Get-ChildItem -Include 不带尾部 \ * 返回空、单遍引用分析判不出死代码须剪枝到不动点、工具无法表达的改动要上报不要绕过
type: project
---

本次在这两台设备上排障时**实际造成过错误结论或无谓返工**的四个陷阱 ✓ ✓。都不是设备特有的知识，是"远程改别人的机器"这件事本身的坑 ✓。两台设备的接法分别归 `open-deskos-cm5-ssh-access.md` ✓ 与 `open-deskos-windows-handheld-access.md` ✓，本文件只留方法与陷阱 ✓。

**远端 `pgrep -f` 会匹配到你自己** ✓。`ssh cm5 'pgrep -f "migrate-models"'` 里那个模式串就在**你这条命令自己的命令行里** ✓，于是守卫永远为真 ✓ ✓。本次因此两次误判"有东西在跑"而拒绝清理 ✓。做法：过滤掉 `bash -c` / `sshd:` / 自身 pid ✓，或先在无模式串的会话里取一次进程快照再比对 ✓ ✓。

**`Get-ChildItem -File -Include` 不带尾部 `\*` 返回空** ✓。`Get-ChildItem C:\Users\frads -File -Include *.ps1` 在**没有 `-Recurse` 且路径没有 `\*`** 时**什么都不返回** ✓ —— 它不报错，只是静默为空 ✓ ✓。本次据此一度以为 234 个脚本已删干净 ✓，实际一个没删 ✓。正确形式是 `Get-ChildItem "C:\Users\frads\*" -File -Include *.ps1` ✓ 或加 `-Recurse` ✓。**删除类操作后的计数一定要用正确写法复核** ✓。

**判"谁还活着"要剪枝到不动点，不能单遍** ✓。只被另一个死脚本引用的脚本**本身也是死的** ✓ —— 单遍引用分析会把它错留成 KEEP ✓。正确做法是反复剔除"没有任何存活者引用它"的项直到收敛 ✓ ✓（本次 3 轮收敛：232 个候选里 231 死 ✓，唯一存活的是活任务直接调用的那个 ✓）。同时把**活任务实际执行的命令行**当成引用源一起算进去 ✓ ✓。

**工具表达不了的改动要上报，不要绕过** ✓。`git rm --cached` 一个 gitlink（16000 模式的 worktree 条目 ✓）之后 `git diff --cached` 明明显示 `D` ✓，`git-agent commit --no-stage` 却报 `no staged changes` ✓ —— 工具看不见这类变更 ✓。而 `AGENTS.md` 明令禁止裸 `git commit` ✓，所以正确做法是**把索引 reset 回干净并把限制说清楚** ✓ ✓，而不是为了"做完"去破例 ✓。

**设备上的"遗留物"要先分清是不是别人的** ✓。判定顺序 ✓：先看**活任务在跑什么**（`Get-ScheduledTask` 的 Actions ✓）→ 再看**有没有进程正在执行它**（含僵死的 ✓）→ 再看**是否属于另一个 agent 的工作域** ✓ → 才轮到自己造的 ✓。本次据此保住了两样东西 ✓：一个被误判成"验证残留"、实际是掌机**唯一**承载模型通路的隧道任务 ✓ ✓，以及另一个 agent 正在改的 `integrations/voice-agent/` 打包件 ✓ ✓。反过来，**守卫正确挡住的三次也值得信** ✓（自匹配、真实僵死进程、gitlink 表达不了 ✓ ✓）—— 守卫两次误报时，先查守卫本身 ✓，别急着放宽它 ✓。

**删除前留可逆记录** ✓。计划任务用 `Export-ScheduledTask` 存 XML ✓ + 一行 `Register-ScheduledTask -Xml` 就能还原 ✓ ✓，比"备份整个目录"轻 ✓；但注意 PowerShell 导出的 XML **声明是 UTF-16 而字节是 UTF-8** ✓，要顺手统一编码声明 ✓，否则还原时会解析失败 ✓ ✓。
