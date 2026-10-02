import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { agentOptions, createResourceLoader, sessionAdapter } from '../src/agent.mjs'
import { createMemoryStore } from '../src/memory.mjs'
import { createPersonalTools } from '../src/personal-tools.mjs'
import { createDidiTools } from '../src/didi/index.mjs'
import { assistant, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))

test('one codemode call batches reviewed tools through the real pipeline without mutation tools', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'voice-codemode-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const calls = []
  const safe = defineTool({ name: 'desk_fixture', label: 'Fixture', description: 'Read a fixture reading',
    parameters: Type.Object({ id: Type.String() }), outputSchema: Type.Object({ id: Type.String(), value: Type.Integer() }),
    execute: async (_id, params) => { calls.push(params.id); return { content: [{ type: 'text', text: JSON.stringify(params) }],
      details: {}, structuredContent: { id: params.id, value: 7 } } } })
  const loader = await createResourceLoader(repository, dir)
  const { session, requests } = await offlineSession({ ...agentOptions(repository, dir, [safe]), agentDir: dir, resourceLoader: loader },
    (_context, count) => count === 1 ? assistant([{ type: 'toolCall', id: 'batch', name: 'codemode', arguments: { code:
      'const r=await Promise.allSettled([tools.desk_fixture({id:"one"}),tools.desk_fixture({id:"two"})]); text(r); text({bash:"bash" in tools,write:"write" in tools,process:typeof process,models:typeof models});' } }], 'toolUse') : assistant('两个读数已读取。'))
  t.after(() => session.dispose())
  const snapshots = []
  assert.equal(await sessionAdapter(session).prompt('读取两个读数', value => snapshots.push(value)), '两个读数已读取。')
  assert.deepEqual(calls.sort(), ['one', 'two'])
  for (const request of requests) assert.deepEqual(visibleTools(request).map(tool => tool.name), ['codemode'])
  const result = session.messages.find(message => message.role === 'toolResult')
  assert.equal(result.isError, false, 'optional capability probes must not fail an otherwise useful script')
  assert.ok(!JSON.stringify(result.content).includes('Script failed'))
  assert.match(JSON.stringify(result.content), /fulfilled/)
  assert.match(JSON.stringify(result.content), /undefined/)
  const scriptText = result.content.filter(part => part.type === "text").map(part => part.text).join("\n")
  assert.ok(scriptText.includes('"bash":false') && scriptText.includes('"write":false'))
  assert.equal(result.nestedCalls.calls.length, 2)
  assert.ok(result.nestedCalls.calls.every(call => call.name === 'desk_fixture' && call.status === 'ok'))
  assert.deepEqual(snapshots, ['两个读数已读取。'])
})

test('a failed script keeps completed side effects, unawaited work and partial store state honest', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codemode-failure-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const log = []
  const safe = defineTool({ name: 'note_fixture', label: 'Fixture', description: 'Record a side effect',
    parameters: Type.Object({ id: Type.String() }), outputSchema: Type.Object({ id: Type.String() }),
    execute: async (_id, params) => {
      log.push(params.id)
      if (params.id !== 'one') throw new Error('refused fixture reason')
      return { content: [{ type: 'text', text: 'noted' }], details: {}, structuredContent: { id: params.id } }
    } })
  const loader = await createResourceLoader(repository, dir)
  const { session } = await offlineSession({ ...agentOptions(repository, dir, [safe]), agentDir: dir, resourceLoader: loader },
    (_context, count) => count === 1 ? assistant([{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code:
      'store("phase","first"); await tools.note_fixture({id:"one"}); await tools.note_fixture({id:"missing"}); store("phase","never"); text("unreached");' } }], 'toolUse') : assistant('第一步已执行，第二步失败。'))
  t.after(() => session.dispose())
  assert.equal(await sessionAdapter(session).prompt('执行两步'), '第一步已执行，第二步失败。')
  assert.deepEqual(log, ['one', 'missing'], 'each nested call runs once; a failed script is never retried or replayed')
  const failed = session.messages.find(message => message.role === 'toolResult' && message.toolName === 'codemode')
  assert.match(JSON.stringify(failed.content), /Script failed|Error/)
  const statuses = failed.nestedCalls.calls.map(call => [call.name, call.status])
  assert.deepEqual(statuses, [['note_fixture', 'ok'], ['note_fixture', 'error']])
  const store = session.messages.filter(message => message.role === 'custom' && message.customType === 'codemode-store')
  assert.equal(store.length, 0, 'store writes persist only for a successful script')
})

test('a rejected personal script never reaches a mutation the gate refuses, and DiDi keeps its own confirmation', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codemode-isolation-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const calls = []
  const memory = createMemoryStore(join(dir, 'MEMORY.json'))
  const deny = defineTool({ name: 'deny_fixture', label: 'Fixture', description: 'Always refuse',
    parameters: Type.Object({}), outputSchema: Type.Object({ ok: Type.Boolean() }),
    execute: async () => { calls.push('deny'); throw new Error('refused fixture reason') } })
  const ok = defineTool({ name: 'allow_fixture', label: 'Fixture', description: 'Always answer',
    parameters: Type.Object({}), outputSchema: Type.Object({ ok: Type.Boolean() }),
    execute: async () => { calls.push('allow'); return { content: [{ type: 'text', text: '{}' }], details: {}, structuredContent: { ok: true } } } })
  const loader = await createResourceLoader(repository, dir)
  const { session } = await offlineSession({ ...agentOptions(repository, dir, [deny, ok]), agentDir: dir, resourceLoader: loader },
    (_context, count) => count === 1 ? assistant([{ type: 'toolCall', id: 'batch', name: 'codemode', arguments: { code:
      'const r=await Promise.allSettled([tools.allow_fixture({}),tools.deny_fixture({})]); text(r.map(x=>x.status));' } }], 'toolUse') : assistant('一个成功，一个失败。'))
  t.after(() => session.dispose())
  assert.equal(await sessionAdapter(session).prompt('两个独立调用').then(text => text), '一个成功，一个失败。')
  assert.deepEqual(calls.sort(), ['allow', 'deny'])
  const result = session.messages.find(message => message.role === 'toolResult')
  assert.match(JSON.stringify(result.content), /fulfilled/)
  assert.equal(memory.read instanceof Function, true)
})

test('DiDi tools declare structured sequential transaction results for codemode', async () => {
  const controller = { snapshot: () => ({ sandbox: true }), search: async () => [{ name: 'fixture' }] }
  const tools = createDidiTools(controller)
  const search = tools.find(tool => tool.name === 'didi_search')
  assert.ok(tools.every(tool => tool.exposure === 'codemode' && tool.executionMode === 'sequential'))
  assert.ok(search.outputSchema)
  const read = await search.execute('fixture', { city: 'fixture', keywords: 'fixture' })
  assert.deepEqual(read.structuredContent, { sandbox: true, result: [{ name: 'fixture' }] })
  const failure = await tools.find(tool => tool.name === 'didi_submit').execute('fixture', {})
  assert.equal(failure.isError, true)
  assert.equal(failure.structuredContent.sandbox, true)
  assert.ok(failure.structuredContent.error)
})

test('personal codemode keeps exact-turn memory gates and has no filesystem or shell escape', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'personal-codemode-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const memory = createMemoryStore(join(dir, 'MEMORY.json'))
  const tools = createPersonalTools({ memory, skillPaths: [] })
  const loader = await createResourceLoader(dir, dir, { profile: 'personal', skillPaths: [] })
  const { session, requests } = await offlineSession({ ...agentOptions(dir, dir, tools, 'personal'), agentDir: dir, resourceLoader: loader },
    (_context, count) => count % 2 === 1 ? assistant([{ type: 'toolCall', id: 'memory-' + count, name: 'codemode', arguments: { code:
      'try {text(await tools.memory_update({category:"note",value:"tea"}));} catch(e) {text(e.message);} text(await tools.memory_read({}));text({read:"read" in tools,bash:"bash" in tools,models:typeof models});' } }], 'toolUse') : assistant('该轮请求已处理。'))
  t.after(() => session.dispose())
  const adapter = sessionAdapter(session, { beginTurn: text => memory.beginTurn(text) })
  await adapter.prompt('讨论茶')
  assert.equal(await memory.read(), '{}')
  await adapter.prompt('remember: tea')
  assert.equal(await memory.read(), '{"note":"tea"}')
  const results = session.messages.filter(message => message.role === 'toolResult')
  assert.match(JSON.stringify(results[0].content), /exact explicit command/)
  assert.equal(results[1].isError, false, 'personal optional probes must not throw after a permitted mutation')
  assert.ok(!JSON.stringify(results[1].content).includes('Script failed'))
  assert.match(JSON.stringify(results[1].content), /undefined/)
  const scriptText = results[1].content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  assert.ok(scriptText.includes('"bash":false') && scriptText.includes('"read":false'))
  assert.ok(results[0].nestedCalls.calls.some(call => call.name === 'memory_update' && call.status === 'error'))
  for (const request of requests) assert.deepEqual(visibleTools(request).map(tool => tool.name), ['codemode'])
  assert.deepEqual(session.getActiveToolNames(), ['codemode'])
  assert.deepEqual(session.getCallableToolNames().sort(), tools.map(tool => tool.name).sort())
  assert.ok(tools.filter(tool => tool.name.startsWith('memory')).every(tool => tool.executionMode === 'sequential'))
})

