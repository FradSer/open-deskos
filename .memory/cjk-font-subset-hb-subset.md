---
name: cjk-font-subset-hb-subset
description: "hb-subset(HarfBuzz)是生成有效 CJK TTF 子集的唯一可靠工具; fontTools 在 macOS 上输出损坏字体"
type: reference
---

hb-subset (HarfBuzz, brew install harfbuzz) 是生成有效 CJK TTF 子集的唯一可靠工具。fontTools 在 macOS 上输出损坏字体(无法被 `lvgl.font_load` 识别)。

**验证命令:**
```sh
hb-subset NotoSansSC-Regular.ttf --unicodes="U+4E00-9FFF,U+3000-303F,U+FF00-FFEF" --output-file=subset.ttf
```
配 `lvgl.font_load + cache_size=0` 使用。

**Why:** 2026-07-14 尝试用 fontTools 生成 CJK 子集, 输出的 TTF 在 LVGL 中加载失败(返回 nil)。hb-subset 产出的子集在 sim 和真机上均工作正常。

**How to apply:** 产 CJK 子集始终用 `hb-subset`, 不用 fontTools。`lvgl.font_load` 加载后设置 `cache_size=0` 确保每次使用直接读取缓存。
