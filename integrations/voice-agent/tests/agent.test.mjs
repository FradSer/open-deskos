import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { loadCapabilities } from '../src/capabilities.mjs'
import { agentOptions, validateWorkspace, createResourceLoader } from '../src/agent.mjs'

test('real SDK resource loader loads the widget skill without undefined agentDir', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-loader-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const loader = await createResourceLoader(new URL('../../..', import.meta.url).pathname, dir)
  assert.ok(loader.getSkills().skills.some(skill => skill.name === 'open-deskos-widget'))
  assert.match(loader.getAppendSystemPrompt().join('\n'), /Never edit active/)
  assert.equal(loader.getExtensions().extensions.length, 0)
  const instructions = loader.getAppendSystemPrompt().join('\n')
  assert.match(instructions, /默认使用中文/)
  assert.match(instructions, /coding_targets/)
  assert.match(instructions, /Never automatically commit, push, install or deploy/)
  assert.doesNotMatch(instructions, /live sessions/)
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
