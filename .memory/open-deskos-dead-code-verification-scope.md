---
name: "open-deskos-dead-code-verification-scope.md"
description: "核对死代码时：integrations/personal-agent/tsconfig.json 的类型检查只 include src/**/*.mjs（noUnusedLocals/noUnusedParameters 生效于 src），tests/** 下的未用 import 不会被它报出；runtime/shell/tests/layout-harness.mjs 不是 *.test.js，由 tests/smoke.mjs spawn，直接 node 运行会打印 LAYOUT HARNESS PASS。"
type: project
---
`integrations/personal-agent/tsconfig.json` 打开 `allowJs`、`checkJs`、`noEmit`、`noUnusedLocals`、`noUnusedParameters`（`strict: false`、`skipLibCheck: true`、`module: nodenext`、`target: es2023`、`types: ["node"]`），而 `include` 只有 `["src/**/*.mjs"]`：该类型检查覆盖 `src` 下的 `.mjs`，`integrations/personal-agent/tests/` 下的文件不在其中。

`runtime/shell/tests/layout-harness.mjs` 不是 `*.test.js`：`runtime/shell/tests/smoke.mjs` 用 `spawnSync(process.execPath, ['tests/layout-harness.mjs'], { cwd: RUNTIME_ROOT, stdio: 'inherit' })` 启动它；直接 `node tests/layout-harness.mjs` 会打印 `LAYOUT HARNESS PASS (8 sizes)` 并以 0 退出。

Why：这两点决定一次删除是否真被验证覆盖——`tsc -p tsconfig.json` 不会报 `integrations/personal-agent/tests/` 里的未用绑定，`layout-harness.mjs` 也不匹配 `tests/*.test.js` 这个按测试文件名的 glob。How to apply：改 `tests/` 下的 import 时直接跑受影响的测试文件；改 `runtime/shell/tests/layout-harness.mjs` 时单独跑 `node tests/layout-harness.mjs`，或跑同样会 spawn 它的 smoke。