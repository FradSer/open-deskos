---
name: "open-deskos-task-runner-streaming-fixture.md"
description: "integrations/personal-agent/tests/task-runner.test.mjs 第 465 行已有 async function streamingFixture(t)，返回 { adapter, f, service, launched }；第 562/611/626/636/720/732/752/761/838 行调用它，而第 466/478/500/523/593/654/673/695/782 行仍内联同一段 setup，部分站点在 setup 之间夹有自身断言。"
type: project
---
`integrations/personal-agent/tests/task-runner.test.mjs` 第 465 行已有 `async function streamingFixture(t)`，体内为 `const adapter = persistentAdapter()`、`const f = await fixture(t)`、`await f.service.close()`、`const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)`、`t.after(() => service.close())`、`const launched = start(f.root)`、`await service.handle(launched)`、`while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))`，`return { adapter, f, service, launched }`。

该 helper 已在第 562/611/626/636/720/732/752/761/838 行被调用（如 `const { adapter, f, service, launched } = await streamingFixture(t)`），而第 466/478/500/523/593/654/673/695/782 行仍以 `const adapter = persistentAdapter()` 开头内联同一段 setup。

第 478 行站点在 `await service.handle(launched)` 处直接对返回值断言（`assert.equal((await service.handle(launched)).task.lifecycle, 'launching')`），之后才等待 `adapter.sessions[0]?.isStreaming`；现有 `streamingFixture(t)` 体内的 `await service.handle(launched)` 不暴露该返回值，所以这些内联站点不能只把前缀替换成该 helper 调用。

**Why:** 用户要求简化测试；该文件已有共享 setup helper，再加一个等价 helper 会制造重复。**How to apply:** 再处理这些内联站点时，先确认该站点在 setup 之间是否有自己的断言或副作用，需要参数化现有 helper 或保留内联；本轮未改动该文件。