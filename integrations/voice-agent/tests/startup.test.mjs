import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'

async function startupStatus(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-start-'))
  const child = spawn(process.execPath, ['src/main.mjs'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, HOME: dir, XDG_RUNTIME_DIR: dir, ...env }, stdio: 'ignore' })
  t.after(async () => { child.kill(); await rm(dir, { recursive: true, force: true }) })
  let client
  for (let n = 0; n < 100; n++) {
    client = await new Promise(resolve => {
      const socket = connect(join(dir, 'open-deskos-voice/agent.sock'))
      socket.once('error', () => resolve(undefined))
      socket.once('connect', () => resolve(socket))
    })
    if (client || child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, 'resident socket available without configuration')
  t.after(() => client.destroy())
  const reply = new Promise(resolve => client.once('data', data => resolve(JSON.parse(data.toString().split('\n')[0]))))
  client.write('{"v":1,"type":"status"}\n')
  return reply
}

test('main prompt wiring forwards the live response snapshot callback', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const wiring = source.match(/prompt:\s*([^\n]+),\n/)[1]
  let received
  const runtime = { agent: { prompt: (...args) => { received = args; return Promise.resolve('done') } } }
  const prompt = Function('runtime', `return (${wiring})`)(runtime)
  const snapshot = () => {}
  assert.equal(await prompt('request', snapshot), 'done')
  assert.deepEqual(received, ['request', snapshot])
})

test('unconfigured resident stays reachable and reports configuration error', async t => {
  assert.equal((await startupStatus(t)).state, 'error')
})

test('voice uses the system workspace and advances to transcription configuration', async t => {
  const status = await startupStatus(t, { ODESK_WORKSPACE: '/configured/desk-checkout' })
  assert.match(status.message, /ODESK_VOICE_STT_KEY_FILE/)
})

test('obsolete voice-specific workspace is not a fallback', async t => {
  const status = await startupStatus(t, { ODESK_VOICE_WORKSPACE: '/obsolete/checkout' })
  assert.match(status.message, /Set ODESK_WORKSPACE /)
})

async function keyFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-key-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'stt.key')
  await writeFile(path, 'device-local-bearer', { mode: 0o600 })
  return path
}

test('plain HTTP loopback STT URL is accepted for device-local speech', async t => {
  const status = await startupStatus(t, {
    ODESK_WORKSPACE: '/configured/desk-checkout',
    ODESK_VOICE_STT_KEY_FILE: await keyFile(t),
    ODESK_VOICE_STT_URL: 'http://127.0.0.1:17840/inference',
  })
  assert.match(status.message, /writable checkout/)
})

test('region language tags are rejected with supported language guidance', async t => {
  const status = await startupStatus(t, {
    ODESK_WORKSPACE: '/configured/desk-checkout',
    ODESK_VOICE_STT_KEY_FILE: await keyFile(t),
    ODESK_VOICE_STT_LANGUAGE: 'zh-CN',
  })
  assert.match(status.message, /ODESK_VOICE_STT_LANGUAGE/)
  assert.doesNotMatch(status.message, /zh-CN/)
})

test('oversize transcription prompts fail startup with safe guidance', async t => {
  const status = await startupStatus(t, {
    ODESK_WORKSPACE: '/configured/desk-checkout',
    ODESK_VOICE_STT_KEY_FILE: await keyFile(t),
    ODESK_VOICE_STT_PROMPT: 'private-context'.repeat(100),
  })
  assert.match(status.message, /ODESK_VOICE_STT_PROMPT/)
  assert.match(status.message, /1024/)
  assert.doesNotMatch(status.message, /private-context/)
})

test('main wires validated transcription context including empty opt-out', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const initializeSource = source.match(/async function initialize\(env, report, onRideUpdate\) \{[\s\S]*?\n\}/)[0]
  const { transcriptionLanguage, transcriptionPrompt } = await import('../src/transcribe.mjs')
  const initialize = Function('access', 'createVoiceAgent', 'join', 'homedir', 'transcriptionLanguage', 'transcriptionPrompt', 'loadPersonalConfig', `return (${initializeSource})`)(
    async () => {}, async () => ({}), join, () => '/test-home', transcriptionLanguage, transcriptionPrompt, async () => ({ profile: 'coding' }),
  )
  for (const prompt of [undefined, '', ' My TypeScript project。 ']) {
    const runtime = await initialize({
      ODESK_WORKSPACE: '/test-checkout', ODESK_VOICE_STT_KEY_FILE: '/test-key', ODESK_VOICE_STT_PROMPT: prompt,
    }, () => {})
    assert.equal(runtime.stt.prompt, transcriptionPrompt(prompt))
  }
})

test('plain HTTP STT URL outside loopback is rejected', async t => {
  const status = await startupStatus(t, {
    ODESK_WORKSPACE: '/configured/desk-checkout',
    ODESK_VOICE_STT_KEY_FILE: await keyFile(t),
    ODESK_VOICE_STT_URL: 'http://192.168.1.10:17840/inference',
  })
  assert.match(status.message, /ODESK_VOICE_STT_URL/)
})
