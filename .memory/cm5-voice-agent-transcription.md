---
name: cm5-voice-agent-transcription
description: CM5 语音 Agent 使用系统默认录音设备和 OpenAI-compatible 云端转写，与 Pi Sessions 监控分离
type: project
---

## Why

用户要求 S3 Remote 的 MIC 点击触发 CM5 常驻 Pi Agent，真实执行创建 Widget/App 和继续现有 Pi session 等指令，而不是复用只读监控 app/widget。用户选择 OpenAI-compatible 云端转写，避免先部署 CM5 本地语音模型。

## How to apply

从 CM5 Linux 默认音频输入采集，不绑定 Remote 麦克风或固定声卡编号。转写凭据由设备配置读取；未配置或默认麦克风缺失时如实报错，不伪造转写或执行结果，不阻塞桌面。该决策不是已实现或已通过硬件验收的声明。

## Related

[[cerberus-os-top-spec]]
