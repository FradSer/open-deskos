import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migratePersonalBotState, personalBotEnvironment } from '../src/personal-bot-migration.mjs'

test('legacy configuration fills absent bot settings without replacing explicit settings', () => {
  const env = { ODK_VOICE_MODEL: 'legacy', ODK_VOICE_AUDIO_DEVICE: 'mic', ODK_PERSONAL_BOT_MODEL: 'chosen' }
  assert.deepEqual(personalBotEnvironment(env), { ...env, ODK_PERSONAL_BOT_AUDIO_DEVICE: 'mic' })
  assert.equal(env.ODK_PERSONAL_BOT_AUDIO_DEVICE, undefined)
})

test('state migration preserves checkpoint bytes and refuses two histories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-bot-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { XDG_STATE_HOME: root, LOCALAPPDATA: root }
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  const destination = process.platform === 'win32' ? join(root, 'odk', 'personal-bot') : join(root, 'odk-personal-bot')
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  await writeFile(join(legacy, 'checkpoint.json'), '{"ignored":["saved"]}')
  await migratePersonalBotState(env)
  assert.equal(await readFile(join(destination, 'checkpoint.json'), 'utf8'), '{"ignored":["saved"]}')
  await assert.rejects(access(legacy), { code: 'ENOENT' })
  await migratePersonalBotState(env)
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  await writeFile(join(legacy, 'another.json'), 'older')
  await assert.rejects(migratePersonalBotState(env), /Both legacy and Personal Bot/)
  assert.equal(await readFile(join(destination, 'checkpoint.json'), 'utf8'), '{"ignored":["saved"]}')
})

test('Windows state migrates within local app data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-bot-win-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'odk', 'voice'), { recursive: true })
  await writeFile(join(root, 'odk', 'voice', 'memory.json'), 'saved')
  await migratePersonalBotState({ LOCALAPPDATA: root }, 'win32')
  assert.equal(await readFile(join(root, 'odk', 'personal-bot', 'memory.json'), 'utf8'), 'saved')
})

test('an unsafe legacy state directory is refused without moving it', { skip: process.platform === 'win32' ? 'Unix mode fixture; Windows migration protects the ACL before moving' : false }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'personal-bot-unsafe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  await mkdir(legacy, { mode: 0o755 })
  await assert.rejects(migratePersonalBotState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy/)
  await access(legacy)
})

test('linked legacy history is refused before moving the tree', async t => {
  const { symlink, link } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'personal-bot-linked-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = process.platform === 'win32' ? join(root, 'odk', 'voice') : join(root, 'odk-voice')
  await mkdir(legacy, { recursive: true, mode: 0o700 })
  const outside = join(root, 'outside.json')
  await writeFile(outside, 'outside')
  await symlink(outside, join(legacy, 'linked.json'))
  await assert.rejects(migratePersonalBotState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy bot state entry/)
  await rm(join(legacy, 'linked.json'))
  await link(outside, join(legacy, 'linked.json'))
  await assert.rejects(migratePersonalBotState({ XDG_STATE_HOME: root, LOCALAPPDATA: root }), /Unsafe legacy bot state entry/)
  assert.equal(await readFile(outside, 'utf8'), 'outside')
})
