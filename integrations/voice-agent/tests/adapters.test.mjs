import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
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
    assert.equal(options.body.get('file').name, 'audio.wav')
    return new Response(JSON.stringify({ text: ' hello ' }))
  }
  assert.equal(await transcribe(path, config, undefined, fetcher), 'hello')
  await assert.rejects(transcribe(path, config, undefined, async () => new Response('private-key', { status: 401 })), /Transcription failed/)
  await assert.rejects(transcribe(path, config, undefined, async () => new Response(JSON.stringify({ text: '' }))), /Empty transcript/)
  await assert.rejects(transcribe(path, config, undefined, async () => new Response('x'.repeat(70_000))), /Response too large/)
  await assert.rejects(transcribe(path, { ...config, maxAudioBytes: 2 }, undefined, fetcher), /Audio too large/)
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
