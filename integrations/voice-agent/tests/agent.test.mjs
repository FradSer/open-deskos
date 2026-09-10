import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { sessionRequest, loadCapabilities, sessionCommand } from '../src/capabilities.mjs'
import { agentOptions, validateWorkspace, createResourceLoader } from '../src/agent.mjs'

test('SSH session command is fixed, strict and configuration validated', () => {
  assert.deepEqual(sessionCommand('/usr/local/bin/pi-session-control', 'user@mac.local'), {
    executable: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '--', 'user@mac.local', "'/usr/local/bin/pi-session-control'"],
  })
  assert.throws(() => sessionCommand('/bin/control', '-oProxyCommand=bad'), /Invalid SSH/)
  assert.throws(() => sessionCommand('control', 'mac'), /absolute/)
  assert.throws(() => sessionCommand('/bin/control\nwhoami', 'mac'), /Invalid/)
})

test('session CLI uses request ID and JSON stdin; rejects mismatched reply', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const script = join(dir, 'control')
  await writeFile(script, '#!/usr/bin/env node\nprocess.stdin.once("data",data=>{const r=JSON.parse(data);console.log(JSON.stringify({...r,ok:true,sessions:[]}))})\n', { mode: 0o700 })
  await assert.rejects(sessionRequest({ command: 'send', sessionId: 'live', text: 'hello' }, undefined, join(dir, 'missing')), /delivery outcome unknown; do not retry automatically/)
  const result = await sessionRequest({ command: 'list' }, undefined, script)
  assert.equal(result.ok, true)
  assert.equal(result.version, 1)
  assert.ok(result.requestId)
  await writeFile(script, '#!/usr/bin/env node\nconsole.log(JSON.stringify({version:1,requestId:"wrong",ok:true}))\n')
  await assert.rejects(sessionRequest({ command: 'list' }, undefined, script), /Invalid session-control response/)
})

test('real SDK resource loader loads the widget skill without undefined agentDir', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-loader-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const loader = await createResourceLoader(new URL('../../..', import.meta.url).pathname, dir)
  assert.ok(loader.getSkills().skills.some(skill => skill.name === 'open-deskos-widget'))
  assert.match(loader.getAppendSystemPrompt().join('\n'), /Never edit active/)
  assert.equal(loader.getExtensions().extensions.length, 0)
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
  assert.ok(tools.some(tool => tool.name === 'live_sessions'))
  assert.ok(tools.some(tool => tool.name === 'send_to_session'))
  assert.ok(tools.some(tool => tool.name === 'custom'))
  const options = agentOptions('/work/checkout', dir, tools)
  assert.ok(options.tools.includes('bash'))
  assert.ok(options.tools.includes('custom'))
  assert.equal(options.cwd, '/work/checkout')
  await assert.rejects(validateWorkspace('/opt/open-deskos/current'), /Workspace/)
})
