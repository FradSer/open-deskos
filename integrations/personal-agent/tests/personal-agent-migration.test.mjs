import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, chmod, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migratePersonalAgentState, personalAgentEnvironment } from '../src/personal-agent-migration.mjs'

test('legacy device configuration fills absent Agent settings without replacing explicit settings', () => {
  const env = { ODK_VOICE_AUDIO_DEVICE: 'mic', ODK_PERSONAL_AGENT_STT_LANGUAGE: 'zh' }
  assert.deepEqual(personalAgentEnvironment(env), { ...env, ODK_PERSONAL_AGENT_AUDIO_DEVICE: 'mic' })
  assert.equal(env.ODK_PERSONAL_AGENT_AUDIO_DEVICE, undefined)
})

test('state migration preserves checkpoint bytes and refuses two histories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-agent-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { XDG_STATE_HOME: root, LOCALAPPDATA: root }
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  const destination = process.platform === 'win32' ? join(root, 'odk', 'personal-agent') : join(root, 'odk-personal-agent')
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  await writeFile(join(legacy, 'checkpoint.json'), '{"ignored":["saved"]}')
  await migratePersonalAgentState(env)
  assert.equal(await readFile(join(destination, 'checkpoint.json'), 'utf8'), '{"ignored":["saved"]}')
  await assert.rejects(access(legacy), { code: 'ENOENT' })
  await migratePersonalAgentState(env)
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  await writeFile(join(legacy, 'another.json'), 'older')
  await assert.rejects(migratePersonalAgentState(env), /Both legacy and Personal Agent/)
  assert.equal(await readFile(join(destination, 'checkpoint.json'), 'utf8'), '{"ignored":["saved"]}')
})

test('Windows state migrates within local app data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-agent-win-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'odk', 'voice'), { recursive: true })
  await writeFile(join(root, 'odk', 'voice', 'memory.json'), 'saved')
  await migratePersonalAgentState({ LOCALAPPDATA: root }, 'win32')
  assert.equal(await readFile(join(root, 'odk', 'personal-agent', 'memory.json'), 'utf8'), 'saved')
})

test('an unsafe legacy state directory is refused without moving it', { skip: process.platform === 'win32' ? 'Unix mode fixture; Windows migration protects the ACL before moving' : false }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-agent-unsafe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  await mkdir(legacy, { mode: 0o755 })
  await chmod(legacy, 0o755)
  await assert.rejects(migratePersonalAgentState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy/)
  await access(legacy)
})

test('linked legacy history is refused before moving the tree', async t => {
  const { symlink, link } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'personal-agent-linked-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  const outside = join(root, 'outside.json')
  await writeFile(outside, 'outside')
  await symlink(outside, join(legacy, 'linked.json'))
  await assert.rejects(migratePersonalAgentState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy bot state entry/)
  await rm(join(legacy, 'linked.json'))
  await link(outside, join(legacy, 'linked.json'))
  await assert.rejects(migratePersonalAgentState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy bot state entry/)
  assert.equal(await readFile(outside, 'utf8'), 'outside')
})

for(const platform of ['linux','win32'])test(`previous Personal Agent state name migrates on ${platform}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'personal-agent-prior-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const parent=platform==='win32'?join(root,'odk'):root
 const legacy=join(parent,platform==='win32'?'personal-bot':'odk-personal-bot')
 await mkdir(legacy,{recursive:true,mode:0o700});await writeFile(join(legacy,'history.json'),'unchanged')
 await migratePersonalAgentState({XDG_STATE_HOME:root,LOCALAPPDATA:root},platform)
 assert.equal(await readFile(join(parent,platform==='win32'?'personal-agent':'odk-personal-agent','history.json'),'utf8'),'unchanged')
})

test('retired service keys require explicit migration instead of silently selecting defaults',()=>{
 assert.throws(()=>personalAgentEnvironment({ODK_PERSONAL_BOT_CONFIG:'PRIVATE_PATH'}),error=>/Migrate retired Personal Agent settings/.test(error.message)&&!error.message.includes('PRIVATE_PATH'))
})
