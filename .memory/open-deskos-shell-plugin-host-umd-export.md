---
name: "open-deskos-shell-plugin-host-umd-export.md"
description: "runtime/shell/src/plugin-host.js 的 IIFE 结尾按环境二选一导出：有 module.exports 时导出 { createPluginHost, validatePluginManifest }，否则挂到 root.odkPluginHost；renderer-development.test.js 的 browserFixture 通过 root.odkPluginHost 把 host 传进 vm。"
type: project
---
`runtime/shell/src/plugin-host.js` 的 IIFE 结尾按运行环境二选一导出（第 407–409 行）：
```js
  if (typeof module === 'object' && module.exports) module.exports = { createPluginHost, validatePluginManifest }
  else root.odkPluginHost = { createPluginHost, validatePluginManifest }
})(typeof window !== 'undefined' ? window : globalThis)
```

`runtime/shell/tests/renderer-development.test.js` 的 `browserFixture` 先 `require('../src/plugin-host')`，再把 host 放进 vm 的根对象 `const root = { odkPluginHost: { createPluginHost }, odkRendererPluginBridge: { list: async () => entries } }`，所以该 fixture 的浏览器分支从 `root.odkPluginHost` 取 host 值。

Why：`plugin-host` 是 UMD 模块，Node 侧走 `module.exports`、浏览器侧走 `root.odkPluginHost`，两条导出路径互斥。How to apply：调整 `browserFixture` 里的 `require('../src/plugin-host')` 时保留 `root.odkPluginHost` 这条注入路径，否则 vm 里拿不到 host。