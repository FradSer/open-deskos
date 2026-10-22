import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, mkdir, chmod, stat, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostedSession, readHostedHistory } from '../src/task-agent.mjs'
import { assistant, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

test('a Hosted session uses native Pi model lookup without provider overrides', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'hosted-provider-')))
  t.after(() => rm(dir, {recursive: true, force: true}))
  await isolateAgentDirectory(t, dir)
  const previous = process.env.OPENCODE_API_KEY
  process.env.OPENCODE_API_KEY = 'synthetic-console'
  t.after(() => {if (previous === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previous})
  const model = {provider: 'opencode', id: 'fixture', api: 'openai-completions', baseUrl: 'https://old.invalid'}
  const events = []
  const runtime = {
    getModels: () => [model],
    registerProvider(provider, options) {events.push('registry'); assert.equal(provider, 'opencode'); assert.equal(options.models[0].baseUrl, 'https://opencode.ai/inference/openai/v1')},
    async setRuntimeApiKey(provider, key) {events.push('credential'); assert.equal(provider, 'opencode'); assert.equal(key, 'synthetic-console')},
    getModel() {assert.deepEqual(events, []); return model},
  }
  let selected
  const hosted = await createHostedSession({task: {project: dir}, sessionDir: join(dir, 'logs'), model: 'opencode/fixture'}, {
    createRuntime: async () => runtime,
    createSession: async options => {selected = options.model; return {session: {bindExtensions: async () => {}, subscribe: () => () => {}, dispose() {}}}},
  })
  hosted.dispose()
  assert.equal(selected, model)
})

test('a nested coding check stays in persisted history even when the script omits its output', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'hosted-codemode-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  let sdk
  const hosted = await createHostedSession({ task: { project: dir }, sessionDir: join(dir, 'logs') }, {
    createRuntime: async () => ({}),
    createSession: async options => {
      sdk = await offlineSession({ ...options, agentDir: join(dir, 'agent') }, (_context, count) => count === 1
        ? assistant([{ type: 'toolCall', id: 'worker-code', name: 'codemode', arguments: {
          code: 'const r=await tools.coding_check({command:"echo fixture-check"}); text("check output intentionally omitted");' } }], 'toolUse')
        : assistant('Turn ended; no independent verification'))
      return { session: sdk.session }
    },
  })
  t.after(() => hosted.dispose())
  assert.equal((await hosted.prompt('run the check')).stopReason, 'stop')
  const registered = sdk.session.getAllTools().map(tool => tool.name)
  const callable = sdk.session.getCallableToolNames()
  for (const name of ['read', 'write', 'edit', 'bash', 'codemode']) {
    assert.ok(sdk.session.getActiveToolNames().includes(name))
    assert.ok(registered.includes(name))
  }
  for (const name of ['read', 'write', 'edit', 'bash', 'coding_check']) assert.ok(callable.includes(name))
  assert.ok(sdk.requests.every(request => visibleTools(request).some(tool => tool.name === 'codemode')))
  const rawCheck = readHostedHistory(hosted.sessionFile).events.flatMap(batch => batch.events).find(event => event.toolName === 'coding_check')
  assert.ok(rawCheck, 'nested results are not persisted by Pi, so host must retain the observed evidence itself')
  const evidence = JSON.parse(rawCheck.text.split('\n\n')[0]).codingCheck
  assert.equal(evidence.exitCode, 0)
  assert.equal(evidence.sourceBinding, 'unavailable', 'a non-Git project must not invent a source candidate')
  assert.equal(evidence.toolCallId, 'worker-code/1')
})

test('an explicit reopen appends to the original SDK session file without replay or another identity',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'hosted-reopen-')));t.after(()=>rm(dir,{recursive:true,force:true}));await isolateAgentDirectory(t,dir)
 const sessionDir=join(dir,'sessions','task');await mkdir(sessionDir,{recursive:true,mode:0o700})
 let providers=0;const seen=[]
 const dependencies={createRuntime:async()=>({}),createSession:async options=>{const sdk=await offlineSession({...options,agentDir:join(dir,'agent')},context=>{providers++;seen.push(context.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text).join('')));return assistant('synthetic done')});return {session:sdk.session}}}
 const first=await createHostedSession({task:{project:dir},sessionDir},dependencies);await first.prompt('original synthetic prompt');const file=first.sessionFile,before=await readFile(file),header=JSON.parse(before.toString().split('\n')[0]);first.dispose()
 const reopened=await createHostedSession({task:{project:dir,sessionFile:file},sessionDir,resume:true},dependencies);assert.equal(providers,1,'opening never generates');assert.equal(reopened.sessionFile,file)
 await reopened.prompt('new synthetic prompt');reopened.dispose();const after=await readFile(file);assert(after.subarray(0,before.length).equals(before));assert.equal(JSON.parse(after.toString().split('\n')[0]).id,header.id);assert.equal(providers,2);assert.deepEqual(seen[1],['original synthetic prompt','new synthetic prompt'])
})


test('adapter refuses an unsafe or absent original directory without repairing it or starting runtime',async t=>{
 if(process.platform==='win32'){t.skip('POSIX directory mode boundary');return}
 const dir=await realpath(await mkdtemp(join(tmpdir(),'hosted-reopen-guard-')));t.after(()=>rm(dir,{recursive:true,force:true}))
 const sessionDir=join(dir,'sessions','task'),file=join(sessionDir,'2026-01-01_11111111-1111-4111-8111-111111111111.jsonl');await mkdir(sessionDir,{recursive:true,mode:0o700})
 await writeFile(file,JSON.stringify({type:'session',version:3,id:'11111111-1111-4111-8111-111111111111',cwd:dir})+'\n',{mode:0o600})
 let calls=0;const dependencies={createRuntime:async()=>{calls++;throw Error('must not initialize')},createSession:async()=>{calls++;throw Error('must not create')}}
 const alias=join(dir,'sessions-alias');await symlink(join(dir,'sessions'),alias);await assert.rejects(createHostedSession({task:{project:dir,sessionFile:join(alias,'task',file.split('/').at(-1))},sessionDir:join(alias,'task'),resume:true},dependencies),/原会话目录必须使用真实私有规范路径/);assert.equal(calls,0)
 await chmod(sessionDir,0o755);await assert.rejects(createHostedSession({task:{project:dir,sessionFile:file},sessionDir,resume:true},dependencies),/原会话目录必须使用真实私有规范路径/);assert.equal((await stat(sessionDir)).mode&0o777,0o755);assert.equal(calls,0)
 await rm(sessionDir,{recursive:true});await assert.rejects(createHostedSession({task:{project:dir,sessionFile:file},sessionDir,resume:true},dependencies),/原会话目录必须使用真实私有规范路径/);await assert.rejects(stat(sessionDir),{code:'ENOENT'});assert.equal(calls,0)
})
