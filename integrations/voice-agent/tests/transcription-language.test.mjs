import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcribe } from '../src/transcribe.mjs'
import { VoiceService } from '../src/service.mjs'

const defaultPrompt = '在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-language-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'audio.wav')
  const keyFile = join(dir, 'key')
  await writeFile(path, 'RIFFaudio')
  await writeFile(keyFile, 'test-only-key')
  return { path, config: { url: 'https://example.com/v1/audio/transcriptions', model: 'whisper-1', keyFile } }
}

test('local whisper.cpp explicitly detects language and never translates', async t => {
  const { path, config } = await fixture(t)
  for (const url of [
    'http://127.0.0.1:17840/inference',
    'https://127.4.3.2/inference',
    'http://localhost:17840/inference',
    'http://localhost.:17840/inference',
    'http://[::1]:17840/inference?response_format=json',
  ]) {
    for (const language of [undefined, 'zh', 'en', 'auto']) {
      await transcribe(path, { ...config, url, language }, undefined, async (_url, options) => {
        assert.equal(options.body.get('language'), language ?? 'zh')
        assert.equal(options.body.get('translate'), 'false')
        return new Response(JSON.stringify({ text: 'Use GitHub.' }))
      })
    }
  }
})

test('other endpoints omit automatic language and local-only translation options', async t => {
  const { path, config } = await fixture(t)
  for (const url of [
    'https://api.openai.com/v1/audio/transcriptions',
    'https://example.com/inference',
    'https://localhost.example.com/inference',
    'https://128.0.0.1/inference',
    'http://127.0.0.1:17840/v1/audio/transcriptions',
    'http://127.0.0.1:17840/inference/',
  ]) {
    await transcribe(path, { ...config, url, language: 'auto' }, undefined, async (_url, options) => {
      assert.equal(options.body.get('language'), null)
      assert.equal(options.body.get('translate'), null)
      return new Response(JSON.stringify({ text: 'Use GitHub.' }))
    })
  }
})

test('multipart context uses exact default, override and empty opt-out', async t => {
  const { path, config } = await fixture(t)
  for (const url of [config.url, 'http://127.0.0.1:17840/inference']) {
    for (const prompt of [undefined, '', ' Open DeskOS 的 GitHub issue #42。\nTypeScript ', 'a'.repeat(1024)]) {
      await transcribe(path, { ...config, url, prompt }, undefined, async (_url, options) => {
        assert.equal(options.body.get('prompt'), prompt === '' ? null : prompt ?? defaultPrompt)
        return new Response(JSON.stringify({ text: 'Use GitHub.' }))
      })
    }
  }
})

test('oversize prompts fail before I/O without revealing context', async () => {
  await assert.rejects(transcribe('/missing/audio', {
    url: 'https://example.com/transcribe', model: 'whisper-1', keyFile: '/missing/key', prompt: 'private-context'.repeat(100),
  }, undefined, async () => assert.fail('Network must not be used')), { message: 'Invalid transcription prompt' })
})

test('real conversion normalizes complete Chinese text while preserving English and punctuation', async t => {
  const { path, config } = await fixture(t)
  const mixed = '請在 Open DeskOS 的 CM5 上，檢查 ESP32-P4、Pi Agent；按 MIC / Back。\n開啟 Markdown、GitHub 和 TypeScript，修復網絡與軟件問題！'
  const simplified = '请在 Open DeskOS 的 CM5 上，检查 ESP32-P4、Pi Agent；按 MIC / Back。\n开启 Markdown、GitHub 和 TypeScript，修复网络与软件问题！'
  const english = 'Open DeskOS: CM5, ESP32-P4, Pi Agent, MIC / Back.\nReview Markdown, GitHub & TypeScript; don\'t rename `myAPI`!'
  for (const [text, expected] of [[mixed, simplified], [english, english]]) {
    assert.equal(await transcribe(path, config, undefined, async () => new Response(JSON.stringify({ text: ` ${text} ` }))), expected)
  }
})

test('display and agent share normalized text after the complete provider response', async t => {
  const { path, config } = await fixture(t)
  const expected = '请检查 Open DeskOS 的网络和 TypeScript。'
  const bytes = Buffer.from(JSON.stringify({ text: '請檢查 Open DeskOS 的網絡和 TypeScript。' }))
  const service = new VoiceService({
    record: async () => ({ stop: async () => path, cleanup: async () => {}, done: new Promise(() => {}) }),
    transcribe: () => transcribe(path, config, undefined, async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 2) controller.enqueue(bytes.subarray(offset, offset + 2))
        controller.close()
      },
    }))),
    prompt: async received => {
      assert.equal(received, expected)
      assert.equal(service.status.transcript, expected)
      return '已检查。'
    },
  })
  t.after(() => service.close())
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.state, 'idle')
  assert.equal(service.status.transcript, expected)
})
