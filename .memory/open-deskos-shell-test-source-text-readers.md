---
name: "open-deskos-shell-test-source-text-readers.md"
description: "runtime/shell/tests/fixture-rejection.test.js 读取 clock-main-bootstrap.test.js、app-manager-electron.test.js、pi-electron.test.js 的源文本并用 source.indexOf 截取代码区间；update-runtime-cli.test.js 在模块加载时读 scripts/*.js 并对源码断言，pi-sessions.test.js 读 renderer 插件源文本。"
type: project
---
`runtime/shell/tests/fixture-rejection.test.js` 把同目录测试文件当源文本读入——`clock-main-bootstrap.test.js`、`app-manager-electron.test.js`、`pi-electron.test.js`——随后用 `source.indexOf('<代码字面量>')` 截出起止区间，或在读到的字符串上跑 `source.matchAll(...)` 找校验器。

`runtime/shell/tests/update-runtime-cli.test.js` 在模块作用域用 `fs.readFileSync(path.join(__dirname, '..', 'scripts', ...), 'utf8')` 读 `update-runtime.js`、`migrate-runtime.js`、`validate-release.js` 等脚本源码，并对源码文本断言（例如 `assert.match(stageRelease, /STAGING_ID=/)`）。

`runtime/shell/tests/pi-sessions.test.js` 在测试内读 `../src/renderer/plugins/pi-sessions.js` 与 `../src/renderer/plugins/status-pi-sessions.js` 的源文本。

Why：这些断言的输入是被读文件的源文本，改动被读文件里的匹配字面量（或删掉读取行本身）会改变断言实际比较的内容。How to apply：改动这些被读文件或其 reader 测试后，直接运行对应的 reader 测试（`fixture-rejection.test.js`、`update-runtime-cli.test.js`、`pi-sessions.test.js`），不要把这类测试文件当作纯文本清理对象。