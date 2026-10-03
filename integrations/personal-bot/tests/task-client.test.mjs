import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carriedProject, loadTargets, taskCommand, taskRequest } from '../src/task-client.mjs'

const target = { id: 'mac', name: 'Mac', executable: '/bin/helper', roots: ['/work'] }
const TASK_ID = '12345678-1234-1234-1234-123456789abc'

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

// Admission belongs to the host, so the coordinator carries the project verbatim. Repeating the root
// policy here is what refused a project the daemon had itself just reported whenever a configured
// root was a symlink, and the reported project is exactly what a spoken reference has to reuse.
test('the coordinator carries a project verbatim instead of repeating the host root policy', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'task-verbatim-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const real = join(dir, 'real')
  const link = join(dir, 'link')
  await mkdir(join(real, 'sub'), { recursive: true })
  await symlink(real, link, 'dir')
  const helper = await fixture(t, 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:true,task:r}))})')
  const configured = { ...helper, roots: [link] }
  const reported = join(real, 'sub')
  assert.equal((await taskRequest(configured, { command: 'status', project: reported, taskId: TASK_ID })).task.project, reported)
  const outside = join(dir, 'elsewhere')
  assert.equal((await taskRequest(configured, { command: 'status', project: outside, taskId: TASK_ID })).task.project, outside,
    'a project outside the declared roots must travel; the host decides')
  // The host's own refusal is what an operator sees, unchanged and unexplained further.
  const refusing = await fixture(t, `process.stdin.once('data',d=>{const r=JSON.parse(d);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:false,error:"项目不在允许的开发目录内"}))})`)
  await assert.rejects(taskRequest({ ...refusing, roots: [link] }, { command: 'list', project: outside }), /项目不在允许的开发目录内/)
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
  // A sibling path is not the coordinator's call: it travels, and the host answers for it.
  assert.equal((await taskRequest(configured, { command: 'start', project: '/working', prompt: 'no' })).task.project, '/working')
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
  for (const reason of ['项目或主机任务已满', '未找到任务', 'Hosted Pi 已结束', 'Hosted Pi 正在启动', '流式提示需要 delivery behavior', 'private provider diagnostic']) {
    const configured = await fixture(t, `process.stdin.once('data',data=>{const r=JSON.parse(data);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:false,error:${JSON.stringify(reason)}}))})`)
    await assert.rejects(taskRequest(configured, { command: 'list', project: '/work' }), error => {
      assert.equal(error.message, reason === 'private provider diagnostic' ? 'Managed task request rejected' : reason)
      return true
    })
  }
})

// A daemon that refuses a prompt before accepting it leaves nothing to reconcile, so the operator
// must be told why instead of being handed the unknown-outcome warning that exists for timeouts.
test('a refused prompt reports the reason rather than an unknown outcome', async t => {
  for (const reason of ['Hosted Pi 已结束', 'Hosted Pi 正在启动', '流式提示需要 delivery behavior', 'private provider diagnostic']) {
    const configured = await fixture(t, `process.stdin.once('data',data=>{const r=JSON.parse(data);console.log(JSON.stringify({version:1,requestId:r.requestId,ok:false,error:${JSON.stringify(reason)}}))})`)
    await assert.rejects(taskRequest(configured, { command: 'prompt', project: '/work', taskId: '12345678-1234-1234-1234-123456789abc', prompt: '继续完成测试' }), error => {
      assert.doesNotMatch(error.message, /outcome unknown|do not retry/i)
      assert.equal(error.message, reason === 'private provider diagnostic' ? 'Managed task request rejected' : reason)
      return true
    })
  }
})

// A remote target's project is a path on that host, so a desk that reaches the target
// over SSH must judge it as that host writes it. Normalizing a remote POSIX path with
// this host's rules is what a Windows Shell Host did: it rewrote every separator and
// prefixed a root, so every project it was asked to carry came back as invalid.
test('a remote target carries a project its own host would resolve', () => {
  for (const project of ['/Users/fradser/Developer/open-deskos', '/work/中文', '/srv/deep/path']) {
    assert.equal(carriedProject(project, true), true, `a remote project must travel: ${project}`)
  }
  // What the target host could not resolve is refused before the wire: a relative
  // path, a path of another host's syntax, a parent segment, a control character.
  for (const project of ['work/project', 'C:\\Users\\desk\\project', '/work/../else', '/work\n', '', 42]) {
    assert.equal(carriedProject(project, true), false, `a remote project must be refused: ${project}`)
  }
})

test('a local target keeps judging a project with this host path rules', () => {
  assert.equal(carriedProject('/work/中文'), true)
  assert.equal(carriedProject('/work/../else'), false)
  assert.equal(carriedProject('work/project'), false)
})

// The control helper's answer is one correlated frame, so that frame is the fact —
// not the helper's exit. This matters on a Windows Shell Host, whose OpenSSH client
// neither relays a piped stdin nor closes the session once the remote command has
// finished, so a client that waits for the process would time out on work that is
// already done.
test('a helper that answers and then lingers still completes the request', async t => {
  const helper = await fixture(t, `
const request = require('node:fs').readFileSync(0, 'utf8')
process.stdout.write(JSON.stringify({ version: 1, requestId: JSON.parse(request).requestId, ok: true, tasks: [{ id: 'a' }], truncated: false }) + '\\n')
setInterval(() => {}, 1000)
`)
  const response = await taskRequest(helper, { command: 'list', project: '/work' }, undefined, 5000)
  assert.equal(response.ok, true)
  assert.deepEqual(response.tasks, [{ id: 'a' }])
})

test('a helper that exits non-zero after a valid response does not undo it', async t => {
  const helper = await fixture(t, `
const request = require('node:fs').readFileSync(0, 'utf8')
process.stdout.write(JSON.stringify({ version: 1, requestId: JSON.parse(request).requestId, ok: true, tasks: [], truncated: false }) + '\\n')
process.exit(3)
`)
  const response = await taskRequest(helper, { command: 'list', project: '/work' }, undefined, 5000)
  assert.equal(response.ok, true, 'a completed request is the reply, not the exit status')
})

test('a helper that answers nothing is still a timeout with the same reason', async t => {
  const helper = await fixture(t, 'setInterval(() => {}, 1000)\n')
  await assert.rejects(taskRequest(helper, { command: 'list', project: '/work' }, undefined, 500), /timeout/)
})

test('the request arrives whole, including a non-ASCII project', async t => {
  const helper = await fixture(t, `
const request = require('node:fs').readFileSync(0, 'utf8')
process.stdout.write(JSON.stringify({ version: 1, requestId: JSON.parse(request).requestId, ok: true, received: request, tasks: [], truncated: false }) + '\\n')
`)
  const response = await taskRequest(helper, { command: 'list', project: '/work/中文' }, undefined, 5000)
  assert.equal(response.ok, true)
  assert.equal(response.received.includes('/work/中文'), true, 'the request must arrive whole')
  assert.equal(response.received.trimEnd().split('\n').length, 1, 'and as the one bounded frame it is')
})
