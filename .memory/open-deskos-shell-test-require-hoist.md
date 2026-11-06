---
name: "open-deskos-shell-test-require-hoist.md"
description: "runtime/shell 测试内重复的 require 组可提升到模块作用域：device-bridge-source.test.js 的 4 份 EventEmitter+createRemoteBridgeClient 两行组，以及 pi-result-events/appearance-plugins/renderer-management 各 2 份 3–4 行 require 组，提升后 test()/assert 计数不变且套件通过；前提是模块作用域无同名声明、被 require 模块加载期不读 env/IO、无其他 js 文件引用这些测试文件。"
type: project
---
在 runtime/shell 的测试清理中，同一测试文件内重复出现的逐行相同 require 组可以提升到模块作用域，前提是不减少任何 `test()` 与 `assert` 调用。`runtime/shell/tests/device-bridge-source.test.js` 第 58/59、81/82、93/94、189/190 行原有 4 份相同的 `const { EventEmitter } = require('node:events')` + `const { createRemoteBridgeClient } = require('../src/remote-bridge-client')` 两行组；把它们移到 `const { createRequire } = require('node:module')` 之后的两条模块级 require 后，脚本报告删除 8 行（206→200），`node --check` 通过，`test(` 与 `assert.` 计数保持 9/36 不变。

改后运行 `node --test tests/device-bridge-source.test.js` 报告 `ℹ tests 11`、`ℹ pass 11`、`ℹ fail 0`。

同一批改动把 `runtime/shell/tests/pi-result-events.test.js` 的 85–88 与 104–107 两段 4 行 require 提到文件头部（diff 显示新增 `+const { readSessionEvents } = require('../src/pi-sessions')`、`+const fs = require('node:fs')`、`+const os = require('node:os')`、`+const path = require('node:path')`），并删除 `appearance-plugins.test.js` 的 252–254/276–278 与 `renderer-management.test.js` 的 24–26/113–115 两段重复 require；整批 diff 为 `3 files changed, 10 insertions(+), 20 deletions(-)`，三个文件的行数从 169→165、551→548、377→374，`test()`/`assert` 计数保持 13/50、28/123、14/79 不变，合并运行三个套件报告 61 tests / 61 pass / 0 fail。

提升前的检查：`device-bridge-source.test.js` 的基线 `node --test tests/device-bridge-source.test.js` 报告 11 tests / 11 pass / 0 fail；`runtime/shell/src/remote-bridge-client.js` 的加载期副作用 grep 只命中第 16 行 `function resolveRemoteBridgeSocketPath(env = process.env, host = resolveShellHost({ env })) {`（process.env 只作函数默认参数），该测试文件里 `^const .*\b(EventEmitter|createRemoteBridgeClient)\b` 的模块作用域声明 grep 无命中，四对 require 行逐字节相同（all identical: True）。

`runtime/shell/src/pi-sessions.js` 的 `process.env.PI_AGENT_DIR` 在 `function readSessionEvents(options = {}) {` 的函数体内参与 `const agentDir = options.agentDir || process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')` 的解析，不是模块加载时捕获。

`pi-result-events.test.js`、`appearance-plugins.test.js` 与 `renderer-management.test.js` 这三个被改文件名在 tracked `*.js`/`*.cjs`/`*.mjs` 中没有被其他文件引用（逐项 `git grep` 输出为空），因此它们不是已知的、按文件名读取源文本的 reader 目标。

Why：这组清理针对逐文件测试中的重复 require，提升后所有 `test()`/`assert` 计数不变且套件通过，可作为后续同类简化的已验证模式。How to apply：先跑目标文件的基线套件并记录 `test()`/`assert` 数量；确认提升名在模块作用域无同名声明、被 require 的项目模块不在加载期读取 env/IO、且没有其他 js 文件引用该测试文件名；提升后跑 `node --check` 与同一套件，确认计数和 pass/fail 与基线一致。