---
name: text-only-no-screenshots
description: "当前会话模型可能只接收文本；图像验证需用可观测输出或确认模型多模态能力"
type: feedback
---

部分会话模型不能接收 `Read` 返回的 BMP/PNG；这属于模型能力边界，不是项目截图文件本身的故障。

**Why:** 把截图直接交给不支持视觉输入的模型只会得到请求错误，不能作为 UI 正确性的验证。

**How to apply:** 先确认当前模型是否支持图片；不支持时用退出码、stdout、文件大小、Lua 断言、布局 harness 和 simulator 测试验证 UI。不要把截图内容写入代码或凭据。
