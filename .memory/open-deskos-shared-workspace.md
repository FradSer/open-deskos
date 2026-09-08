---
name: open-deskos-shared-workspace
description: ODESK_WORKSPACE 属于整个 Open DeskOS，Voice 只是使用入口，不拥有独立 workspace 配置
type: project
---

## Why

用户明确纠正 workspace 的归属：共享可写工作区服务于整个 Open DeskOS，不只是语音。按输入入口命名会使后续 app 和自动化各自建立重复配置。

## How to apply

使用 ODESK_WORKSPACE，删除 ODESK_VOICE_WORKSPACE 的生产读取与文档示例，不保留兼容回退。Voice 专属录音、转写配置仍使用 ODESK_VOICE_*。共享工作区与 active release、Agent 会话存储分离；不要为了改名而引入未使用的配置抽象。

## Related

[[cm5-voice-agent-transcription]]
