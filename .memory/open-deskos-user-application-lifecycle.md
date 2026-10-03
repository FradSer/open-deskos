---
description: 已安装的本地包落在 stateDir（不在 ODESK_WORKSPACE）；统一插件模型下"独立的 User Application 概念"已被 ADR-0009 退役，只有"未受信任的本地包 vs 内建可信插件"这条区分仍然成立
type: project
---

**权威在仓库文档，不在本文件** ✓：`runtime/linux/docs/adr/0009-service-plugin-contract.md` ✓ 与 `runtime/linux/docs/USER_APPLICATIONS.md` ✓。本文件只留最容易记错的一处事实与几条操作约定 ✓。

**最容易记错的一条：已安装的包不在 `ODESK_WORKSPACE` 下** ✓。`user-app-store.js` 里 `revisionDir()` 返回**相对路径** `apps/<id>/revisions/<revision>` ✓，而它是被 `readBoundedFile(stateDir, …)` **按 stateDir 解析**的 ✓ ✓，目录清单也写在 `stateDir` 下 ✓。所以位置是 `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos/user-apps/` ✓（`stateDir` 必须是绝对路径且 `createUserAppStore` 会以 `0700` 建它 ✓ ✓）。**`ODESK_WORKSPACE/apps` 不是安装位置** —— 那道检查只是 agent 草稿工作区的准入门槛 ✓。本条曾被本文件长期写反，已按代码更正 ✓ ✓。

**"独立"这个词有两层意思，别混** ✓：`USER_APPLICATIONS.md` 仍然成立的是「**未受信任的本地包** 区别于 **内建可信 Shell 插件**」✓ ✓；而 ADR-0009 明文 **retired 的是"独立的 User Application 概念/层"** ✓ —— 新 manifest 与新文档里不得再出现该概念 ✓ ✓，既有包按统一的 Widget/App 模型读取 ✓。所以：说"本地包与内建插件信任级别不同"是对的 ✓，说"用户应用是独立于 Shell 插件的一层"是退役说法 ✓。

**操作约定（跨会话容易忘的部分）** ✓：草稿是 `manifest.json` + 自包含 `index.html` ✓，`kind` 为 `widget` 或 `app` ✓；常驻工具 `user_apps_list` / `user_app_install` / `user_app_rollback` / `user_app_remove` 走私有 `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock` 的 JSONL 协议 ✓ ✓，**install 30 秒截止、其余 10 秒** ✓，响应上限 512 KiB ✓，**变更类操作不自动重试** ✓ ✓。创建文件不等于安装 ✓ —— 必须经 Shell 拥有的生命周期服务验证后才成为已安装版本 ✓，验证失败**不改动已安装版本** ✓ ✓。

**Why:** 本文件先前把安装位置写成 `ODESK_WORKSPACE/apps/<id>`，与代码相反；而"独立概念"又是 ADR-0009 明确退役的说法。记忆比代码更容易被当成事实，所以这两处必须以代码与 ADR 为准回填。

**How to apply:** 查包在哪先看 `stateDir` ✓；描述模型用「统一 Widget/App + 可选的 Service Plugin」✓，不要引入"独立用户应用层" ✓ ✓；超时或传输失败导致结果未知时**报告不确定、请 operator 确认后再重试** ✓，不要自行重复变更 ✓。
