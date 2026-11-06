---
name: "open-deskos-shell-test-header-require-fold.md"
description: "runtime/shell 测试内与模块作用域重复的 require 可删除或折进头部 require：personal-agent-diagnosis.test.js 删除一条遮蔽模块作用域同名绑定的测试内 require；user-app-api/data-source-plugins 3/2 条并入既有头部 require，odk-plugin-cli 3 条 plugin-host require 折叠；test()/assert 计数（9/26、11/48、12/59）与套件、e2e 163/163、动态 45 不变。"
type: project
---
**已应用并验证（commit df5384e4）：** `runtime/shell/tests/personal-agent-diagnosis.test.js` 的 diff 在 `@@ -209,7 +209,6 @@` 区块删除了一条测试内 `const { createMainPlugins } = require('../src/plugins/main-composition')`，下一行仍使用 `createMainPlugins()`；该文件模块作用域已声明同名绑定 `const { createMainPlugins } = require('../src/plugins/main-composition')`。删除后 `test(` 3→3、`assert.` 34→34、行数 224→223，单文件 9 tests/9 pass，与 `tests/e2e-isolation.test.js` 合并运行 172 tests/172 pass，动态计数 `isolated native launch opts into shared policy` 保持 45，且该文件没有被其他 js 以源文本读取（输出 `(empty=none)`）。

**已应用并验证（commit 3f512767）：** 三个 `runtime/shell/tests/` 文件把函数内的 require 折进模块作用域——`user-app-api.test.js` 第 46/54/91 行的 3 条 `../src/user-app-api`（`requestPublicJson`、`lookupPublicDns`；头部第 4 行已 require 同一模块）、`data-source-plugins.test.js` 第 198/232 行的 2 条 `../src/plugins/data-sources`（`createSourcePlugin`；头部第 6 行已 require 同一模块）、`odk-plugin-cli.test.js` 第 30/55/86 行的 3 条 `../src/plugin-host`（`createPluginHost`、`validatePluginManifest`；该文件内 `../src/plugin-host` 的 require 只出现在这三处，均在测试函数内）。折叠后 `test()`/`assert.` 计数为 9/26、11/48、12/59（与 HEAD 版本一致），行数 99→96、250→248、224→222，三个套件 32 tests/32 pass，含 `tests/e2e-isolation.test.js` 合并运行 163 tests/163 pass、动态计数 45。

折叠前的导出核对：`runtime/shell/src/user-app-api.js` 为 `module.exports = { parseApiSources, isPublicAddress, requestPublicJson, lookupPublicDns, createUserAppApi }`；`runtime/shell/src/plugins/data-sources.js` 为 `module.exports = { createSourcePlugin: sourcePlugin, createDataSourcePlugins, DATA_PORTS }`（导出别名）；`runtime/shell/src/plugin-host.js` 在 `typeof module === 'object' && module.exports` 时导出 `{ createPluginHost, validatePluginManifest }`。

这三个测试文件里没有 `require.cache` 失效、`delete require`、`Module._load`、`vi.resetModules`，也没有 `process.env.*` 赋值（逐文件 cache=0、env=0）；对 `user-app-api.js`、`plugins/data-sources.js`、`plugin-host.js` 三个被 require 模块做加载期 env/IO grep 无命中。

Why：用户要求清理整个 codebase 中非必要的代码、测试、文档，尤其是简化测试；删除与模块作用域重复的测试内 require、把名字折进头部 require 是该清理中已验证不减少断言的形式。How to apply：先跑目标套件基线并记录 `test(`/`assert.` 数量与行数；确认名字确由该模块导出、测试文件不做 require 缓存失效或 env 赋值、被 require 模块加载期不读 env/IO；删除或折叠后用 `node --check` 与同一套件复核，再跑含 `tests/e2e-isolation.test.js` 的合并套件核对 pass 数与动态计数 45。