---
name: "open-deskos-shell-generated-fixture-code.md"
description: "runtime/shell 的 app-manager-main-bootstrap.test.js 与 clock-main-bootstrap.test.js 用模板字符串生成 entry.cjs（内联 factory.toString()）；字面量里的 require 绑定 NATIVE_PLUGIN_SCHEME、SYSTEM_PORTS、createRendererManagement 等在全文件只出现一次，按出现次数的 dead-code 扫描会误判，删除会改变写入的 fixture 源文本。"
type: project
---
`runtime/shell/tests/app-manager-main-bootstrap.test.js` 用模板字符串 `shared` 拼出一个 `entry.cjs`：字面量里是一串 `const {X}=require(<绝对路径>)` 声明（`node:net`、`node:crypto`、`NATIVE_PLUGIN_SCHEME`、`RENDERER_DEVELOPMENT_CHANNEL`、`sanitizeRuntimePlugins`、`healthPort`、`createPluginControl`、`createRendererManagement`、`listenOdkData`、`SYSTEM_PORTS`、`DESK_PORTS`、`createRuntimeChannelProbe`），`exports.create` 由 `(${factory.toString()})(${JSON.stringify(options)}).create` 生成，末尾是 `globalThis.odkDiagnosticMainEntries.push(...)`；随后 `await fs.writeFile(path.join(folder, 'entry.cjs'), shared)` 把它落盘，再用 `scripts/odk-plugin-cli.js link <folder> --trust --replace` 装进临时插件目录。

这些绑定在该测试文件里各只出现 1 次（第 251–262 行，也就是上面那段字面量内），所以按整文件出现次数做的未使用绑定扫描会把它们全部报成 dead；`runtime/shell/tests/clock-main-bootstrap.test.js` 第 86–87 行的 `createRendererManagement`、`listenOdkData` 是同样的模板字面量 require，也同样各只出现 1 次。

Why：删掉这些 require 不是零影响——它们会改变写进 `entry.cjs` 的源文本，而该 fixture 正是被 `odk-plugin-cli.js link` 装进临时插件目录的那一份。How to apply：在这两个 bootstrap 测试里，只出现一次的 require 只有在连整段生成 fixture 一起删时才可删，否则保持原样；判断依据是这些行是否位于生成 `entry.cjs` 的模板字面量内。