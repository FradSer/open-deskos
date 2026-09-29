import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcribe, transcriptionProvider } from '../src/transcribe.mjs'
import { AudioLimitError } from '../src/errors.mjs'

const endpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const audioPrefix = 'data:audio/wav;x-pcm-16bit;base64,'
const defaultPrompt = '在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。'
const token = 'test-only-aliyun-token'
const wav = Buffer.from('RIFF....WAVEfmt \u0000test-only-audio')
const text = '欢迎使用阿里云。'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-aliyun-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'audio.wav')
  await writeFile(path, wav)
  return { dir, path, config: { url: endpoint, model: 'qwen3-asr-flash', provider: 'aliyun' }, environment: { ALIYUNCS_TOKEN: token } }
}

/** @param {string} [value] */
function reply(value = text) {
  return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ text: value }] } }] } }))
}

test('the cloud transcription provider is declared explicitly and rejected before any I/O', async () => {
  assert.equal(transcriptionProvider(), 'openai')
  assert.equal(transcriptionProvider('openai'), 'openai')
  assert.equal(transcriptionProvider('aliyun'), 'aliyun')
  for (const provider of ['dashscope', 'ALIYUN', 'Aliyun', 'qwen3-asr-flash', '', ' aliyun', 'aliyun ', 'openai,aliyun', null]) {
    assert.throws(() => transcriptionProvider(provider), (error) => {
      assert.equal(error.message, 'Invalid transcription provider')
      return typeof provider !== 'string' || provider === '' || !error.message.includes(provider)
    })
  }
  // An undeclared provider is refused before the recording is stat'ed, the credential is resolved
  // or a request is built, so a typo cannot reach a provider with the desk's audio.
  await assert.rejects(transcribe('/missing/audio', {
    url: endpoint, model: 'qwen3-asr-flash', provider: 'dashscope', keyFile: '/missing/key',
  }, undefined, async () => assert.fail('network must not be used'), {}), { message: 'Invalid transcription provider' })
})

test('the aliyun request is JSON carrying the inlined WAV, an environment bearer and no multipart', async t => {
  const { path, config, environment } = await fixture(t)
  const controller = new AbortController()
  let sent = ''
  const result = await transcribe(path, config, controller.signal, async (url, options) => {
    assert.equal(url, endpoint)
    assert.equal(options.method, 'POST')
    assert.deepEqual(options.headers, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
    assert.equal(typeof options.body, 'string')
    assert.equal(options.body instanceof FormData, false)
    assert.equal(options.redirect, 'error')
    sent = options.body
    const body = JSON.parse(sent)
    assert.equal(body.model, 'qwen3-asr-flash')
    assert.deepEqual(body.input.messages[0], { role: 'system', content: [{ text: defaultPrompt }] })
    assert.equal(body.input.messages[1].role, 'user')
    const audio = body.input.messages[1].content[0].audio
    assert.ok(audio.startsWith(audioPrefix))
    assert.deepEqual(Buffer.from(audio.slice(audioPrefix.length), 'base64'), wav)
    assert.deepEqual(body.parameters, { result_format: 'message', asr_options: { enable_itn: false, language: 'zh' } })
    assert.equal(sent.includes(token), false)
    // The caller's signal composes with the deadline rather than replacing it.
    controller.abort()
    assert.equal(options.signal.aborted, true)
    return reply(` ${text} `)
  }, environment)
  assert.equal(result, text)
})

test('the aliyun path declares the verified asr model when the desk sets none', async t => {
  const { path, environment } = await fixture(t)
  await transcribe(path, { url: endpoint, provider: 'aliyun' }, undefined, async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, 'qwen3-asr-flash')
    return reply()
  }, environment)
})

test('the provider language code is sent and auto becomes language identification', async t => {
  const { path, config, environment } = await fixture(t)
  for (const [language, expected] of [
    [undefined, { enable_itn: false, language: 'zh' }],
    ['zh', { enable_itn: false, language: 'zh' }],
    ['en', { enable_itn: false, language: 'en' }],
    ['auto', { enable_itn: false, enable_lid: true }],
  ]) {
    await transcribe(path, { ...config, language }, undefined, async (_url, options) => {
      const asr = JSON.parse(options.body).parameters.asr_options
      assert.deepEqual(asr, expected)
      // It is one or the other, never both: an automatic request carries no language key at all.
      assert.equal('language' in asr, language !== 'auto')
      assert.equal('enable_lid' in asr, language === 'auto')
      assert.equal(JSON.parse(options.body).parameters.result_format, 'message')
      return reply()
    }, environment)
  }
})

test('transcription context becomes the system message and an empty context omits it', async t => {
  const { path, config, environment } = await fixture(t)
  for (const prompt of [undefined, '', ' Open DeskOS 的 GitHub issue #42。\nTypeScript ', 'a'.repeat(1024)]) {
    await transcribe(path, { ...config, prompt }, undefined, async (_url, options) => {
      const { messages } = JSON.parse(options.body).input
      assert.equal(messages.length, prompt === '' ? 1 : 2)
      assert.equal(messages.at(-1).role, 'user')
      assert.ok(messages.at(-1).content[0].audio.startsWith(audioPrefix))
      if (prompt === '') {
        assert.equal(messages[0].role, 'user')
      } else {
        assert.deepEqual(messages[0], { role: 'system', content: [{ text: prompt === undefined ? defaultPrompt : prompt }] })
      }
      return reply()
    }, environment)
  }
  // Oversized context is still refused before any I/O on this transport.
  await assert.rejects(transcribe('/missing/audio', {
    url: endpoint, model: 'qwen3-asr-flash', provider: 'aliyun', prompt: 'private-context'.repeat(100),
  }, undefined, async () => assert.fail('network must not be used'), {}), { message: 'Invalid transcription prompt' })
})

test('the aliyun bearer comes from the environment token and a configured key file is never read', async t => {
  const { dir, path, config, environment } = await fixture(t)
  const keyFile = join(dir, 'key')
  await writeFile(keyFile, 'file-only-key')
  for (const configured of [keyFile, join(dir, 'missing-key'), undefined]) {
    await transcribe(path, { ...config, keyFile: configured }, undefined, async (_url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${token}`)
      assert.equal(options.body.includes('file-only-key'), false)
      if (configured) assert.equal(options.body.includes(configured), false)
      return reply()
    }, environment)
  }
  // The environment token is trimmed before it becomes a bearer.
  await transcribe(path, config, undefined, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer padded-token')
    return reply()
  }, { ALIYUNCS_TOKEN: '  padded-token\n' })
})

test('a missing or blank environment token fails before any request', async t => {
  const { path, config } = await fixture(t)
  for (const environment of [{}, { ALIYUNCS_TOKEN: '' }, { ALIYUNCS_TOKEN: '  \n' }, { ALIYUNCS_TOKEN: undefined }]) {
    await assert.rejects(transcribe(path, config, undefined, async () => assert.fail('network must not be used'), environment), {
      message: 'Missing transcription credential',
    })
  }
})

test('the environment is injected instead of read from the process', async t => {
  const { path, config, environment } = await fixture(t)
  const previous = process.env.ALIYUNCS_TOKEN
  t.after(() => { if (previous === undefined) delete process.env.ALIYUNCS_TOKEN; else process.env.ALIYUNCS_TOKEN = previous })
  process.env.ALIYUNCS_TOKEN = 'process-only-token'
  const fetcher = async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    return reply()
  }
  assert.equal(await transcribe(path, config, undefined, fetcher, environment), text)
  // Without an injected token the process value is still not consulted on this call.
  await assert.rejects(transcribe(path, config, undefined, async () => assert.fail('network must not be used'), {}), {
    message: 'Missing transcription credential',
  })
  delete process.env.ALIYUNCS_TOKEN
  assert.equal(await transcribe(path, config, undefined, fetcher, environment), text)
})

test('the aliyun transcript is read from the provider message and normalized to Simplified Chinese', async t => {
  const { path, config, environment } = await fixture(t)
  const traditional = '請在 Open DeskOS 的 CM5 上檢查 ESP32-P4，開啟 GitHub。'
  assert.equal(await transcribe(path, config, undefined, async () => reply(` ${traditional} `), environment),
    '请在 Open DeskOS 的 CM5 上检查 ESP32-P4，开启 GitHub。')
  const english = "Open DeskOS: CM5, ESP32-P4, Pi Agent, MIC / Back.\nReview Markdown, GitHub & TypeScript; don't rename `myAPI`!"
  assert.equal(await transcribe(path, config, undefined, async () => reply(english), environment), english)
})

test('a blank provider transcript is reported as an empty transcript', async t => {
  const { path, config, environment } = await fixture(t)
  for (const value of ['', '   ', '\n']) {
    await assert.rejects(transcribe(path, config, undefined, async () => reply(value), environment), { message: 'Empty transcript' })
  }
})

test('provider failures return a generic error without private content', async t => {
  const { path, config, environment } = await fixture(t)
  const cases = [
    async () => new Response(`rejected ${token}`, { status: 401 }),
    async () => new Response(`rejected ${token}`, { status: 500 }),
    async () => new Response('x'.repeat(70_000)),
    async () => new Response(`not json ${token}`),
    async () => new Response('null'),
    async () => new Response('{}'),
    async () => new Response(JSON.stringify({ output: {} })),
    async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: [] } }] } })),
    async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ text: 42 }] } }] } })),
    async () => { throw Error(`transport ${token}`) },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(Error(`streamed ${token}`)) } })),
  ]
  for (const fetcher of cases) {
    await assert.rejects(transcribe(path, config, undefined, fetcher, environment), (error) => {
      assert.equal(error.message, 'Transcription failed')
      assert.equal(error.message.includes(token), false)
      return true
    })
  }
})

test('an error response body is cancelled instead of read', async t => {
  const { path, config, environment } = await fixture(t)
  let cancelled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(token)) },
    cancel() { cancelled = true },
  })
  await assert.rejects(transcribe(path, config, undefined, async () => new Response(body, { status: 401 }), environment), {
    message: 'Transcription failed',
  })
  assert.equal(cancelled, true)
})

test('an oversize recording is rejected before the credential is read and before any request', async t => {
  const { path, config } = await fixture(t)
  await assert.rejects(transcribe(path, { ...config, maxAudioBytes: 8 }, undefined,
    async () => assert.fail('oversize audio must not be uploaded'), {}), (error) => {
    assert.ok(error instanceof AudioLimitError)
    assert.equal(error.message, 'Audio too large')
    assert.equal(error.limit, 8)
    return true
  })
})

test('the aliyun request refuses a URL that would leak the bearer or the audio', async t => {
  const { path, config, environment } = await fixture(t)
  for (const url of [
    'http://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    'https://user:secret@dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    'ftp://dashscope.aliyuncs.com/generation',
  ]) {
    await assert.rejects(transcribe(path, { ...config, url }, undefined, async () => assert.fail('network must not be used'), environment), {
      message: 'Invalid transcription URL',
    })
  }
  // A declared loopback HTTP proxy keeps the same rule the Open DeskOS URL check applies.
  await transcribe(path, { ...config, url: 'http://127.0.0.1:17840/generation' }, undefined, async () => reply(), environment)
})

test('the transcription deadline aborts the aliyun request', async t => {
  const { path, config, environment } = await fixture(t)
  await assert.rejects(transcribe(path, { ...config, timeoutMs: 1 }, undefined, async (_url, options) => {
    assert.equal(options.signal instanceof AbortSignal, true)
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('deadline'))))
  }, environment), { message: 'Transcription failed' })
})

test('an explicitly declared openai provider keeps the multipart transport', async t => {
  const { dir, path, environment } = await fixture(t)
  const keyFile = join(dir, 'key')
  await writeFile(keyFile, 'file-only-key')
  await transcribe(path, { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', provider: 'openai', keyFile },
    undefined, async (_url, options) => {
      assert.equal(options.body instanceof FormData, true)
      assert.equal(options.body.get('file').name, 'audio.wav')
      assert.equal(options.body.get('model'), 'whisper-1')
      assert.equal(options.headers.Authorization, 'Bearer file-only-key')
      return new Response(JSON.stringify({ text: 'hello' }))
    }, environment)
})
