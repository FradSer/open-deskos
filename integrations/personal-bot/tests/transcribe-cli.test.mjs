import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcriptionRequest } from '../src/transcribe-cli.mjs'
import { transcribe } from '../src/transcribe.mjs'

const ENDPOINT = 'https://maas.example.com/api/v1/services/aigc/multimodal-generation/generation'

// The command exists so an operator can prove a provider, a model and a
// credential on a host with no microphone: one audio file in, one transcript out.
test('a declared environment transcribes one file with no further arguments', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'capture.wav')
  await writeFile(path, 'RIFFaudio')
  const { config } = transcriptionRequest([path], {
    ODESK_PERSONAL_BOT_STT_URL: ENDPOINT,
    ODESK_PERSONAL_BOT_STT_PROVIDER: 'aliyun',
    ALIYUNCS_TOKEN: 'device-local-bearer',
  })
  assert.equal(config.url, ENDPOINT)
  assert.equal(config.provider, 'aliyun')
  assert.equal(config.model, 'qwen3-asr-flash')
  // The command reports what the provider said and nothing about the credential.
  const text = await transcribe(path, config, undefined, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer device-local-bearer')
    return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ text: ' 開啟 Markdown。' }] } }] } }))
  }, { ALIYUNCS_TOKEN: 'device-local-bearer' })
  assert.equal(text, '开启 Markdown。')
})

test('an explicit endpoint overrides the environment without changing the provider', () => {
  const { path, config } = transcriptionRequest(['--url', ENDPOINT, 'capture.wav'], {
    ODESK_PERSONAL_BOT_STT_PROVIDER: 'openai',
    ODESK_PERSONAL_BOT_STT_KEY_FILE: '/device/stt.key',
  })
  assert.equal(path, 'capture.wav')
  assert.equal(config.url, ENDPOINT)
  assert.equal(config.provider, 'openai')
  assert.equal(config.model, 'whisper-1')
  assert.equal(config.keyFile, '/device/stt.key')
})

test('the command never guesses an endpoint or a file', () => {
  assert.throws(() => transcriptionRequest(['capture.wav'], {}), /ODESK_PERSONAL_BOT_STT_URL/)
  assert.throws(() => transcriptionRequest(['--url'], {}), /required after --url/)
  assert.throws(() => transcriptionRequest([], { ODESK_PERSONAL_BOT_STT_URL: ENDPOINT }), /Exactly one audio file/)
  assert.throws(() => transcriptionRequest(['a.wav', 'b.wav'], { ODESK_PERSONAL_BOT_STT_URL: ENDPOINT }), /Exactly one audio file/)
  assert.throws(() => transcriptionRequest(['--model', 'x', 'a.wav'], { ODESK_PERSONAL_BOT_STT_URL: ENDPOINT }), /Unknown option/)
  // An undeclared provider is rejected by the same validator the service uses.
  assert.throws(() => transcriptionRequest(['a.wav'], { ODESK_PERSONAL_BOT_STT_URL: ENDPOINT, ODESK_PERSONAL_BOT_STT_PROVIDER: 'dashscope' }), /Invalid transcription provider/)
})
