---
description: "本地用户应用是 ODESK_WORKSPACE/apps/<id> 下经系统验证的自包含包，独立于 Shell 插件"
type: project
---

Open DeskOS 支持区别于内建 Shell 插件的本地用户应用生命周期。

- 用户包是一份草稿：`ODESK_WORKSPACE/apps/<id>/manifest.json` + 自包含 `index.html`，`kind` 为 `widget` 或 `app`。
- 创建可安装应用要走用户应用生命周期而非编辑 Shell 插件：写好草稿后经系统生命周期校验器 `user_app_install` 验证后才发布到已安装目录；用户应用指令优先于旧的内置 widget 工程 skill。
- 本切片中应用被限制在严格的 `allow-scripts` 沙箱：无 parent/preload 访问、无网络、无 Node API、无持久 app-data API。
- 常驻工具 `user_apps_list`/`user_app_install`/`user_app_rollback`/`user_app_remove` 通过私有 `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock` JSONL 协议；install 30s 截止、其余 10s，响应上限 512KiB，变更操作不自动重试。

**Why:** 用户包是不透明、自包含、经验证的产物，不是市场、原生扩展、后台服务或网络权限平台。

**How to apply:** 不注入生成脚本进 Shell，不执行任意安装脚本；超时/传输失败导致结果未知时，报告不确定性并请运维确认后再尝试变更。
