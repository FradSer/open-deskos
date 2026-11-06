---
name: "open-deskos-test-inline-setup-hoist.md"
description: "open-deskos 测试清理：同一测试文件内逐字节相同的重复 setup 块可提升为本地 helper——futu-source.test.js 4 份 5 行 endpoint+createFutuSource 块→futuSource(dir) 返回 { endpoint, source }；adapters.test.mjs 的 5 行 transcription setup 块→transcriptionFixtures(t) 返回 { path, keyFile }。只比 5 行前缀会误报（odk-data 前缀同但 read 闭包各异需参数化）。脚本须先替换块再插入 helper，否则 helper 体被替换成自调用。"
type: project
---
在 runtime/shell 的测试清理中，同一文件内逐字节相同的重复 setup 块可提升为本地 helper：`runtime/shell/tests/futu-source.test.js` 第 160/177/249/289 行的 5 行块（`const endpoint = path.join(dir, 'futu-poller.sock')`、`const source = createFutuSource({`、`runtimeDir: dir,`、`services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),`、`})`）逐字节相同（“exact 5-line block at: [160, 177, 249, 289]”），提升后的 helper 为 `function futuSource(dir)`，内容仍是上述三句加 `return { endpoint, source }`。

这 4 处块之后只有 `endpoint` 与 `source` 被使用，`dir` 不再出现（块后统计 dir=0、endpoint/source 有使用），且每个测试的 `finally` 只有一句 `await source.stop()`（块后 finally=1），所以提炼不改变清理顺序。

`integrations/personal-agent/tests/adapters.test.mjs` 里重复出现的 5 行 transcription setup（`const dir = await temp(t)`、`const path = join(dir, 'audio.wav')`、`const keyFile = join(dir, 'key')`、`await writeFile(path, 'RIFFaudio')`、`await writeFile(keyFile, 'private-key')`）提升为 `async function transcriptionFixtures(t)`：helper 体内仍先 `await temp(t)`（`t.after` 清理由 `temp` 注册），返回 `{ path, keyFile }`，测试改为 `const { path, keyFile } = await transcriptionFixtures(t)`。

只比 5 行前缀不足以判定重复：`runtime/shell/tests/odk-data.test.js` 4 处的 5 行前缀相同（`const registry = createOdkDataRegistry()` 起，含 `id: HYDRA`、`label: 'Hydra plants'`、`kind: 'tile'`），但每处 `read` 闭包不同（`reads += 1` 返回 `{ nodes: [{ id: 1, soilPercent: soil }] }`；`changed += 1` 返回 `{ soil: 30 }`；`notes: 'x'.repeat(MAX_READING_BYTES + 1024)`），抽成共享 helper 需要参数化。

改写脚本的顺序有一个已观察到的陷阱：先插入 helper 再替换重复块时，helper 体本身也会匹配到该块并被替换成自调用——观察到的编辑里 helper 变成 `function futuSource(dir) { const { endpoint, source } = futuSource(dir); return { endpoint, source } }`；先替换所有重复块、再插入 helper 才得到正确的 `futuSource(dir)`。

两次改动后的合并回归输出：`runtime/shell` 侧 exit 0、187 tests / 187 pass / 0 fail；`integrations/personal-agent` 侧 exit 0、11 tests / 11 pass / 0 fail。

Why：用户要求清理整个 codebase 中非必要的代码、测试、文档，尤其是简化测试；把测试内逐字节相同的 setup 块合并为 helper 属于该清理的一种可验证形式。How to apply：先记录目标文件基线套件结果；只用逐字节整行比较确认所有出现处完全相同（不要只比 5 行前缀）；确认块后只用到 helper 返回的变量且 `finally`/`t.after` 清理位置不变；先替换所有重复块再插入 helper，跑 `node --check` 与该文件套件，确认 pass/fail 与基线一致。