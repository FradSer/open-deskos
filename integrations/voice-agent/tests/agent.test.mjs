import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { loadCapabilities } from '../src/capabilities.mjs'
import { agentOptions, validateWorkspace, createResourceLoader, sessionAdapter } from '../src/agent.mjs'

test('real SDK resource loader loads the widget skill without undefined agentDir', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-loader-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const loader = await createResourceLoader(new URL('../../..', import.meta.url).pathname, dir)
  assert.ok(loader.getSkills().skills.some(skill => skill.name === 'open-deskos-widget'))
  assert.match(loader.getAppendSystemPrompt().join('\n'), /never edit active/i)
  assert.equal(loader.getExtensions().extensions.length, 0)
  const instructions = loader.getAppendSystemPrompt().join('\n')
  assert.match(instructions, /默认使用简体中文/)
  assert.match(instructions, /尊重用户明确指定的其他语言/)
  assert.match(instructions, /coding_targets/)
  assert.match(instructions, /full exposed tool set/)
  assert.doesNotMatch(instructions, /edit\/test-only defaults|Never automatically commit, push, install or deploy/)
  assert.doesNotMatch(instructions, /live sessions/)
  assert.doesNotMatch(instructions, /without markdown/)
  assert.match(instructions, /Markdown/)
})

test('Pi adapter preserves full Markdown for the service to bound once', async () => {
  const reply = '# Result\n' + '中文结果\n'.repeat(4000)
  const calls = []
  const { adapter } = streamingSession(async (emit, ...args) => {
    calls.push(args)
    emit({ type: 'message_end', message: assistant(reply) })
  })
  assert.equal(await adapter.prompt('request'), reply)
  assert.equal(calls.length, 1)
})

function assistant(text, stopReason = 'stop') {
  return { role: 'assistant', stopReason, content: [
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text },
    { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'private argument' } },
  ] }
}

function streamingSession(run) {
  let listener
  let subscribed = false
  let unsubscribed = 0
  const session = {
    messages: [assistant('old history must not leak')],
    subscribe: callback => {
      subscribed = true
      listener = callback
      return () => { subscribed = false; unsubscribed++ }
    },
    prompt: async (...args) => {
      assert.equal(subscribed, true)
      await run(event => listener(event), ...args)
    },
    abort: async () => {}, dispose: () => {},
  }
  return { adapter: sessionAdapter(session), emitLate: event => listener(event), unsubscribed: () => unsubscribed }
}

function update(emit, text, type = 'text_delta') {
  const message = assistant(text)
  emit({ type: 'message_update', message, assistantMessageEvent: { type, contentIndex: 1, delta: text, partial: message } })
}

test('SDK snapshots stream current-request visible text across tool turns with final authority', async () => {
  const snapshots = []
  const fixture = streamingSession(async (emit, text, options) => {
    assert.equal(text, 'Voice request:\nrequest')
    assert.equal(options.expandPromptTemplates, false)
    emit({ type: 'message_start', message: assistant('') })
    update(emit, '', 'thinking_delta')
    update(emit, 'First')
    assert.deepEqual(snapshots, ['First'])
    update(emit, 'First', 'toolcall_delta')
    emit({ type: 'message_end', message: assistant('First turn', 'toolUse') })
    emit({ type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: 'raw secret' }] } })
    emit({ type: 'tool_execution_update', partialResult: { content: [{ type: 'text', text: 'raw secret' }] } })
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'Second')
    assert.equal(snapshots.at(-1), 'First turn\n\nSecond')
    emit({ type: 'message_end', message: assistant('Second final') })
  })
  assert.equal(await fixture.adapter.prompt('request', text => snapshots.push(text)), 'First turn\n\nSecond final')
  assert.equal(fixture.unsubscribed(), 1)
  assert.equal(snapshots.at(-1), 'First turn\n\nSecond final')
  const count = snapshots.length
  update(fixture.emitLate, 'late')
  assert.equal(snapshots.length, count)
  assert.ok(snapshots.every(text => !/private|raw secret|old history/.test(text)))
})

test('SDK retries remove failed partial text and retain successful preceding turns', async () => {
  const snapshots = []
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'failed attempt')
    emit({ type: 'message_end', message: assistant('failed attempt', 'error') })
    emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'private provider error' })
    assert.equal(snapshots.at(-1), 'Plan')
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'Success')
    emit({ type: 'message_end', message: assistant('Success') })
    emit({ type: 'auto_retry_end', success: true, attempt: 1 })
  })
  assert.equal(await fixture.adapter.prompt('request', text => snapshots.push(text)), 'Plan\n\nSuccess')
  assert.equal(fixture.unsubscribed(), 1)
})

test('SDK overflow recovery removes only the discarded attempt', async () => {
  for (const stopReason of ['error', 'length']) {
    const fixture = streamingSession(async emit => {
      emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
      emit({ type: 'message_end', message: assistant('discarded', stopReason) })
      emit({ type: 'compaction_end', reason: 'overflow', result: undefined, aborted: false, willRetry: true })
      emit({ type: 'message_end', message: assistant('Recovered') })
    })
    assert.equal(await fixture.adapter.prompt('request'), 'Plan\n\nRecovered')
  }
})

test('SDK terminal overflow failures reject normally resolved prompts and discard truncated attempts', async t => {
  for (const outcome of [
    { aborted: false, errorMessage: 'private compaction error' },
    { aborted: true },
    { aborted: false, errorMessage: 'recovery exhausted', retried: true },
  ]) {
    await t.test(outcome.errorMessage || 'aborted compaction', async () => {
      const snapshots = []
      const fixture = streamingSession(async emit => {
        emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
        emit({ type: 'message_end', message: assistant('truncated', 'length') })
        if (outcome.retried) {
          emit({ type: 'compaction_end', reason: 'overflow', result: {}, aborted: false, willRetry: true })
          emit({ type: 'message_end', message: assistant('still truncated', 'length') })
        }
        emit({ type: 'compaction_end', reason: 'overflow', result: undefined, willRetry: false, ...outcome })
      })
      await assert.rejects(fixture.adapter.prompt('request', text => snapshots.push(text)), /^Error: Agent request failed$/)
      assert.equal(snapshots.at(-1), 'Plan')
      assert.equal(fixture.unsubscribed(), 1)
      const count = snapshots.length
      update(fixture.emitLate, 'late')
      assert.equal(snapshots.length, count)
    })
  }
})

test('SDK length termination without recovery events rejects an incomplete reply', async () => {
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
    emit({ type: 'message_end', message: assistant('truncated', 'length') })
  })
  await assert.rejects(fixture.adapter.prompt('request'), /^Error: Agent request failed$/)
  assert.equal(fixture.unsubscribed(), 1)
})

test('SDK successful overflow maintenance without retry keeps the completed reply', async () => {
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Completed') })
    emit({ type: 'compaction_end', reason: 'overflow', result: {}, aborted: false, willRetry: false })
  })
  assert.equal(await fixture.adapter.prompt('request'), 'Completed')
})

test('SDK no-assistant, rejected, aborted and cancelled retry requests never reuse history and always unsubscribe', async () => {
  const empty = streamingSession(async () => {})
  assert.equal(await empty.adapter.prompt('request'), '')
  assert.equal(empty.unsubscribed(), 1)
  for (const run of [
    async () => { throw Error('prompt rejected') },
    async emit => emit({ type: 'message_end', message: assistant('partial', 'aborted') }),
    async emit => emit({ type: 'message_end', message: assistant('partial', 'error') }),
    async emit => {
      emit({ type: 'message_end', message: assistant('partial', 'error') })
      emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'private error' })
      emit({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'private error' })
    },
  ]) {
    const fixture = streamingSession(run)
    await assert.rejects(fixture.adapter.prompt('request'))
    assert.equal(fixture.unsubscribed(), 1)
  }
})

test('SDK adapter rejects concurrent prompts without sharing subscriptions', async () => {
  let finish
  const fixture = streamingSession(() => new Promise(resolve => { finish = resolve }))
  const pending = fixture.adapter.prompt('first')
  await assert.rejects(fixture.adapter.prompt('second'), /progress/)
  finish()
  await pending
  assert.equal(fixture.unsubscribed(), 1)
})

test('user application lifecycle tools use the bounded shell control protocol', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-apps-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const socketPath = join(dir, 'control.sock')
  process.env.ODESK_APPS_CONTROL_SOCKET = socketPath
  t.after(() => delete process.env.ODESK_APPS_CONTROL_SOCKET)
  const server = createServer(connection => {
    connection.setEncoding('utf8')
    connection.once('data', data => {
      const request = JSON.parse(data.trim())
      connection.end(JSON.stringify({ v: 1, id: request.id, ok: true, apps: [] }) + '\n')
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(() => server.close())
  const tools = await loadCapabilities()
  const list = tools.find(tool => tool.name === 'user_apps_list')
  const install = tools.find(tool => tool.name === 'user_app_install')
  assert.ok(list && install)
  const listed = await list.execute('call', {}, undefined)
  assert.deepEqual(JSON.parse(listed.content[0].text).apps, [])
  const installed = await install.execute('call', { id: 'hello-widget' }, undefined)
  assert.equal(JSON.parse(installed.content[0].text).ok, true)
})

test('trusted capability modules augment real coding tools and resume dedicated sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-cap-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'custom.mjs'), 'export default async () => [{name:"custom",execute:async()=>({content:[],details:{}})}]')
  const tools = await loadCapabilities([join(dir, 'custom.mjs')])
  assert.ok(tools.some(tool => tool.name === 'coding_targets'))
  for (const name of ['coding_task_start', 'coding_task_status', 'coding_tasks_list', 'coding_task_cancel']) assert.ok(tools.some(tool => tool.name === name))
  assert.ok(!tools.some(tool => ['live_sessions', 'send_to_session'].includes(tool.name)))
  assert.ok(tools.some(tool => tool.name === 'custom'))
  const options = agentOptions('/work/checkout', dir, tools)
  assert.ok(options.tools.includes('bash'))
  assert.ok(options.tools.includes('custom'))
  assert.equal(options.cwd, '/work/checkout')
  await assert.rejects(validateWorkspace('/opt/open-deskos/current'), /Workspace/)
})

test('coding tools list configuration only and route explicit project requests', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-targets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'targets.json')
  const executable = join(dir, 'helper')
  await writeFile(executable, '#!/usr/bin/env node\nlet s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({...r,ok:true}))})', { mode: 0o700 })
  await writeFile(file, JSON.stringify({ targets: [{ id: 'cm5', name: '开发板', roots: ['/work'], executable }] }))
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = file
  t.after(() => { if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE; else process.env.ODESK_TASK_TARGETS_FILE = previous })
  const tools = await loadCapabilities()
  const targets = await tools.find(tool => tool.name === 'coding_targets').execute('call', {}, undefined)
  assert.deepEqual(JSON.parse(targets.content[0].text), { targets: [{ id: 'cm5', name: '开发板', roots: ['/work'] }] })
  for (const command of ['start', 'status', 'list', 'cancel']) {
    const tool = tools.find(tool => tool.name === (command === 'list' ? 'coding_tasks_list' : `coding_task_${command}`))
    const params = { target: 'cm5', project: '/work/天气', prompt: '修改已有应用', taskId: '12345678-1234-1234-1234-123456789abc' }
    const response = JSON.parse((await tool.execute('call', params, undefined)).content[0].text)
    assert.equal(response.command, command)
    assert.equal(response.project, params.project)
    await assert.rejects(tool.execute('call', { ...params, target: 'mac' }, undefined), /not configured/)
    await assert.rejects(tool.execute('call', { ...params, project: undefined }, undefined), /project/)
    assert.equal(tool.parameters.additionalProperties, false)
  }
})
