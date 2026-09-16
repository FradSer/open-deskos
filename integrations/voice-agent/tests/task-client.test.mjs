import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTargets, taskCommand, taskRequest } from '../src/task-client.mjs'

const target = { id: 'mac', name: 'Mac', executable: '/bin/helper', roots: ['/work'] }

async function fixture(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'task-client-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const executable = join(dir, 'helper')
  await writeFile(executable, '#!/usr/bin/env node\n' + source, { mode: 0o700 })
  return { ...target, executable }
}

test('strict SSH invocation quotes spaces and apostrophes without shell payloads', () => {
  assert.deepEqual(taskCommand("/work/it's helper", 'user@mac.local'), {
    executable: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '--', 'user@mac.local', "'/work/it'\\''s helper'"],
  })
  for (const host of ['-oProxyCommand=bad', 'mac;whoami', 'mac\n']) assert.throws(() => taskCommand('/bin/helper', host), /Invalid SSH/)
  assert.throws(() => taskCommand('helper'), /absolute/)
  assert.throws(() => taskCommand('/bin/helper\n'), /Invalid/)
})

test('target configuration rejects duplicate IDs, unexpected keys and invalid roots', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-targets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'targets.json')
  for (const config of [
    { targets: [target, target] }, { targets: [{ ...target, id: 'other' }] },
    { targets: [{ ...target, roots: ['relative'] }] }, { targets: [{ ...target, host: '' }] },
    { targets: [{ ...target, command: 'bad' }] }, { targets: [target], extra: true },
    { targets: [{ ...target, roots: ['/opt/open-deskos/current'] }] },
  ]) {
    await writeFile(path, JSON.stringify(config))
    await assert.rejects(loadTargets(path), /Invalid|Duplicate/)
  }
  await writeFile(path, JSON.stringify({ targets: [target] }))
  assert.deepEqual(await loadTargets(path), [target])
  assert.deepEqual(await loadTargets(undefined), [])
})

test('Chinese requests retain Unicode and one generated task UUID', async t => {
  const configured = await fixture(t, 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:true,task:r}))})')
  const response = await taskRequest(configured, { command: 'start', project: '/work/中文', prompt: '修改天气 Widget 并测试' })
  assert.equal(response.task.prompt, '修改天气 Widget 并测试')
  assert.equal(response.task.project, '/work/中文')
  assert.match(response.task.taskId, /^[0-9a-f-]{36}$/)
  assert.notEqual(response.task.taskId, response.requestId)
  await assert.rejects(taskRequest(configured, { command: 'start', project: '/work/../else', prompt: 'no' }), /project/)
  await assert.rejects(taskRequest(configured, { command: 'start', project: '/working', prompt: 'no' }), /project/)
})

test('unknown mutation outcomes expose original target and task ID, never retry', async t => {
  const configured = await fixture(t, 'process.stdin.resume();setTimeout(()=>{},60000)')
  await assert.rejects(taskRequest(configured, { command: 'start', project: '/work', prompt: '测试' }, undefined, 30), error => {
    assert.match(error.message, /outcome unknown.*do not retry/i)
    assert.match(error.message, /mac/)
    assert.match(error.message, /[0-9a-f]{8}-[0-9a-f-]{27}/)
    return true
  })
})

test('aborted mutations retain reconciliation information', async t => {
  const configured = await fixture(t, 'process.stdin.resume();setTimeout(()=>{},60000)')
  const taskId = '12345678-1234-1234-1234-123456789abc'
  for (const command of ['start', 'cancel']) {
    const controller = new AbortController()
    const response = taskRequest(configured, { command, project: '/work', prompt: '测试', taskId }, controller.signal)
    controller.abort()
    await assert.rejects(response, error => {
      assert.match(error.message, /outcome unknown.*do not retry/i)
      assert.match(error.message, /project=\/work/)
      if (command === 'cancel') assert.ok(error.message.includes(taskId))
      return true
    })
  }
})

test('reject uncorrelated, oversized and failed responses', async t => {
  for (const source of [
    'console.log(JSON.stringify({version:1,requestId:"wrong",ok:true}))',
    'console.log("x".repeat(262145))',
    'process.exit(1)',
  ]) {
    const configured = await fixture(t, source)
    await assert.rejects(taskRequest(configured, { command: 'list', project: '/work' }), /response|failed/)
    await assert.rejects(taskRequest(configured, { command: 'start', project: '/work', prompt: '测试' }), /outcome unknown/)
  }
})

test('known daemon rejections preserve safe reasons and hide unknown text', async t => {
  for (const reason of ['项目或主机任务已满', '未找到任务', 'private provider diagnostic']) {
    const configured = await fixture(t, `process.stdin.once('data',data=>{const r=JSON.parse(data);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:false,error:${JSON.stringify(reason)}}))})`)
    await assert.rejects(taskRequest(configured, { command: 'list', project: '/work' }), error => {
      assert.equal(error.message, reason === 'private provider diagnostic' ? 'Managed task request rejected' : reason)
      return true
    })
  }
})
