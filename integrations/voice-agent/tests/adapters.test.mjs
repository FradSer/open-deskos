import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { transcribe } from '../src/transcribe.mjs'
import { listen } from '../src/socket.mjs'
import { VoiceService } from '../src/service.mjs'

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('transcription sends multipart and rejects unsafe provider results', async t => {
  const dir = await temp(t)
  const path = join(dir, 'audio.wav')
  const keyFile = join(dir, 'key')
  await writeFile(path, 'RIFFaudio')
  await writeFile(keyFile, 'private-key')
  const config = { url: 'https://example.com/transcribe', model: 'whisper-1', keyFile }
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-key')
    assert.equal(options.body.get('model'), 'whisper-1')
    assert.equal(options.body.get('language'), 'zh')
    assert.equal(options.body.get('file').name, 'audio.wav')
    return new Response(JSON.stringify({ text: ' hello ' }))
  }
  assert.equal(await transcribe(path, config, undefined, fetcher), 'hello')
  await assert.rejects(transcribe(path, config, undefined, async () => new Response('private-key', { status: 401 })), /Transcription failed/)
  await assert.rejects(transcribe(path, config, undefined, async () => new Response(JSON.stringify({ text: '' }))), /Empty transcript/)
  await assert.rejects(transcribe(path, config, undefined, async () => new Response('x'.repeat(70_000))), /Response too large/)
  await assert.rejects(transcribe(path, { ...config, maxAudioBytes: 2 }, undefined, fetcher), /Audio too large/)
})

test('uploads accept up to 25000000 bytes and reject larger files before network or credentials', async t => {
  const dir = await temp(t)
  const path = join(dir, 'audio.wav')
  const keyFile = join(dir, 'key')
  await writeFile(keyFile, 'test-only-key')
  const file = await open(path, 'w')
  t.after(() => file.close())
  const config = { url: 'https://example.com/transcribe', model: 'whisper-1', keyFile }
  for (const size of [2_500_000, 25_000_000]) {
    await file.truncate(size)
    assert.equal(await transcribe(path, config, undefined, async (_url, options) => {
      assert.equal(options.body.get('file').size, size)
      return new Response(JSON.stringify({ text: 'long recording' }))
    }), 'long recording')
  }
  await file.truncate(25_000_001)
  await assert.rejects(transcribe(path, { ...config, keyFile: '/missing' }, undefined, async () => {
    assert.fail('oversize audio must not be uploaded')
  }), /Audio too large/)
})

test('status transport preserves maximally escaped bounded replies and transcripts together', async t => {
  const dir = await temp(t)
  const socketPath = join(dir, 'private', 'agent.sock')
  const service = new VoiceService({ record: async () => { throw Error('no device') }, transcribe: async () => '', prompt: async () => '' })
  const reply = '\u0000'.repeat(16_384)
  const transcript = '\u0000'.repeat(4096)
  service.setState('idle', reply, transcript)
  const server = await listen(socketPath, service)
  t.after(() => server.close())
  const client = connect(socketPath)
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const received = new Promise((resolve, reject) => {
    let pending = ''
    client.on('error', reject)
    client.on('data', data => {
      pending += data
      if (pending.includes('\n')) resolve(JSON.parse(pending.trim()))
    })
  })
  client.write('{"v":1,"type":"status"}\n')
  const status = await received
  assert.equal(status.message, reply)
  assert.equal(status.transcript, transcript)
  assert.equal(status.level, 0)
  assert.ok(Buffer.byteLength(`${JSON.stringify(status)}\n`) < 123_000)
})

test('Chinese transcription preserves mixed project names and configurable languages', async t => {
  const dir = await temp(t)
  const path = join(dir, 'audio.wav')
  const keyFile = join(dir, 'key')
  await writeFile(path, 'RIFFaudio')
  await writeFile(keyFile, 'private-key')
  const text = '请在 Open DeskOS 中用 pi-session-control 查看会话，不要改名。'
  for (const language of [undefined, 'zh', 'eng', 'en', 'auto']) {
    const config = { url: 'https://example.com/transcribe', model: 'whisper-1', keyFile, language }
    const fetcher = async (_url, options) => {
      assert.equal(options.body.get('language'), language === 'auto' ? null : language ?? 'zh')
      return new Response(JSON.stringify({ text }))
    }
    assert.equal(await transcribe(path, config, undefined, fetcher), text)
  }
})

test('invalid transcription languages fail before I/O without revealing configuration', async () => {
  for (const language of ['', 'ZH', 'chinese', 'zh-CN', 'en-US', 'zh_CN', 'zh\r\nprivate-value', 'auto-private-value']) {
    await assert.rejects(transcribe('/missing/audio', {
      url: 'https://example.com/transcribe', model: 'whisper-1', keyFile: '/missing/key', language,
    }, undefined, async () => { throw Error('Network must not be used') }), {
      message: 'Invalid transcription language',
    })
  }
})

test('transcription transport and malformed provider errors are sanitized', async t => {
  const dir = await temp(t)
  const path = join(dir, 'audio.wav')
  const keyFile = join(dir, 'key')
  await writeFile(path, 'RIFFaudio')
  await writeFile(keyFile, 'private-key')
  const config = { url: 'https://example.com/transcribe', model: 'whisper-1', keyFile }
  for (const fetcher of [
    async () => { throw Error('private-key transport details') },
    async () => new Response('private-key provider details'),
    async () => new Response('null'),
    async () => new Response(new ReadableStream({
      start(controller) { controller.error(Error('private-key streaming details')) },
    })),
    async () => new Response(new ReadableStream({
      cancel() { throw Error('private-key cancellation details') },
    }), { status: 401 }),
  ]) {
    await assert.rejects(transcribe(path, config, undefined, fetcher), { message: 'Transcription failed' })
  }
})

test('voice service forwards Chinese requests and replies unchanged', async () => {
  const text = '请检查 Open DeskOS 和 pi-session-control。'
  const reply = '已检查 Open DeskOS 和 pi-session-control，尚未部署。'
  const service = new VoiceService({
    record: async () => ({ stop: async () => 'audio.wav', cleanup: async () => {}, done: new Promise(() => {}) }),
    transcribe: async () => text,
    prompt: async received => { assert.equal(received, text); return reply },
  })
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.state, 'idle')
  assert.equal(service.status.message, reply)
  await service.close()
})

test('private socket accepts JSONL and rejects invalid framing', async t => {
  const dir = await temp(t)
  const socketPath = join(dir, 'private', 'agent.sock')
  const service = new VoiceService({ record: async () => { throw Error('no device') }, transcribe: async () => '', prompt: async () => {} })
  const server = await listen(socketPath, service)
  t.after(() => server.close())
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600)
  assert.equal((await stat(join(dir, 'private'))).mode & 0o777, 0o700)
  const client = connect(socketPath)
  t.after(() => client.destroy())
  const messages = []
  client.setEncoding('utf8')
  client.on('data', data => messages.push(...data.trim().split('\n').map(JSON.parse)))
  await new Promise(resolve => client.once('connect', resolve))
  client.write('{"v":1,"type":"status"}\n{"v":1,"type":"toggle"}\n')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.ok(messages.some(m => m.state === 'idle'))
  assert.ok(messages.some(m => m.state === 'error'))
  client.write('{"v":9,"type":"toggle"}\n')
  await new Promise(resolve => client.once('close', resolve))
})
