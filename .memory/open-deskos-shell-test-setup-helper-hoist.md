---
name: "open-deskos-shell-test-setup-helper-hoist.md"
description: "runtime/shell 两个测试文件的逐字节相同 setup 提升已验证：plugin-host-replacement.test.js 3 份 4 行 deferred+fixture+start → startedOldStopFixture() 返回 { entered, finish, f }；app-platform.test.js 3 份 4 行 vm registry-context（2 空格与 4 空格两种缩进）→ registryContext(endpoint) 返回 { root, context }；test()/assert 计数 20/88、13/88 不变，含 e2e-isolation 合并运行 200/200 通过、动态计数 45。"
type: project
---
**Observed（已应用并验证）：** `runtime/shell/tests/plugin-host-replacement.test.js` 第 216/235/254 行原有三份逐字节相同的 4 行 setup，三处归一化比较为 identical，块后 `entered`/`finish`/`f` 仍被使用；三处已替换为 `const { entered, finish, f } = await startedOldStopFixture()`，新增 helper 的体为 `const entered = deferred()`、`const finish = deferred()`、`const f = fixture({ oldStop() { entered.resolve(); return finish.promise } })`、`await f.host.start()`，并 `return { entered, finish, f }`。

`runtime/shell/tests/app-platform.test.js` 第 170/233/315 行原有三份相同的 4 行 vm setup：`const root = { odkPluginHost: { createPluginHost }, odkPlatform: { dispatchIntent: intent => endpoint.dispatch(intent) } }`、`const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })`、`vm.runInContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), context)`、`vm.runInContext(source, context)`；其中 233 行为 4 空格缩进、170/315 为 2 空格缩进，所以不是同一份逐字节文本，替换要按缩进分组。三处改为 `const { root, context } = registryContext(endpoint)`，helper 以 `endpoint` 为参数并 `return { root, context }`。

替换后 `test(`/`assert.` 计数与基线一致：plugin-host-replacement 为 20 个 test / 88 个 assert，app-platform 为 13 / 88；两文件行数 380→379 与 355→354。

合并运行 `node --test --test-concurrency=2 tests/plugin-host-replacement.test.js tests/app-platform.test.js tests/e2e-isolation.test.js` 得到 exit 0、`ℹ tests 200`、`ℹ pass 200`、`ℹ fail 0`，`isolated native launch opts into shared policy` 计数为 45，最终 diff 为 2 files changed、22 insertions(+)、24 deletions(-)。

**Limits（本轮未提升、未验证）：** `integrations/personal-agent/tests/service.test.mjs` 中重复出现的 `service.subscribe(...)`/`await service.toggle()`/`const turn = service.toggle()`/`await new Promise(resolve => setImmediate(resolve))` 之后紧跟 `snapshot(...)`、`t.mock.timers.tick(...)` 与 `assert.equal(service.status...)`，这些站点本轮没有提升，也没有证据表明提升后顺序断言仍成立。

**Why:** 用户要求清理整个 codebase 中非必要的代码、测试、文档，尤其是简化测试；把同一测试文件内逐字节相同的 setup 合并为本地 helper 属于该清理的一种已验证形式。**How to apply:** 先跑目标套件基线并统计 `test(`/`assert.` 数量；只合并整行逐字节相同的块（不同缩进按组分开），确认块后只用到 helper 返回的变量；替换后跑 `node --check`、同一套件，再跑含 `tests/e2e-isolation.test.js` 的合并套件，核对 pass/fail 与该动态计数。