---
name: open-deskos-pixel-zpix
description: "CM5 Pixel 主题的中英文与数字统一使用本地 Zpix v3.2.0；个人教育免费，商业需单独许可"
type: project
---

**Why:** 仅支持 Latin 的像素字体会让中文回退到非像素 CJK 字体。Zpix 同时覆盖英文、简繁中文与数字，但不是通用开源字体许可。

**How to apply:** Pixel 在 `runtime/linux/src/renderer/themes/pixel.css` 中加载官方未改动 `fonts/zpix.woff2`，统一 Regular/400 并禁用 synthetic weight/style。其他主题继续使用 Noto Sans SC/Montserrat。勿转换、裁剪或重新生成 Zpix；来源和商业授权限制见 `fonts/ZPIX-NOTICE.md`。`tests/pixel-font.cjs` 用 Chromium 实际字体报告验证中英文 custom Zpix glyph，不以 CSS family 字符串代替字形证据。修改字号后运行密度、状态栏与完整 E2E 校验。

**Related:** [[open-deskos-linux-electron-shell]]
