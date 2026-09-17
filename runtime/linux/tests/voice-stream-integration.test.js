const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createVoiceAgentClient } = require('../src/voice-agent-client')
const { pathToFileURL } = require('node:url')
const { findRepositoryRoot } = require('./helpers/repo-root')

function waitFor(client, predicate) {
  if (predicate(client.snapshot())) return Promise.resolve(client.snapshot())
  return new Promise((resolve) => {
    const unsubscribe = client.subscribe((status) => {
      if (!predicate(status)) return
      unsubscribe()
      resolve(status)
    })
  })
}

test('resident transcription and partial reply reach the Shell before completion over the real socket', { timeout: 5000 }, async (t) => {
  const backend = path.join(findRepositoryRoot(__dirname), 'integrations', 'voice-agent', 'src')
  const { VoiceService } = await import(pathToFileURL(path.join(backend, 'service.mjs')).href)
  const { listen } = await import(pathToFileURL(path.join(backend, 'socket.mjs')).href)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-stream-'))
  const socketPath = path.join(directory, 'voice.sock')
  const transcript = '帮我总结这个项目'
  let emitText
  let complete
  const service = new VoiceService({
    record: async () => ({ done: new Promise(() => {}), stop: async () => 'fixture.wav', cleanup: async () => {} }),
    transcribe: async () => transcript,
    prompt: async (_text, onText) => {
      emitText = onText
      return new Promise((resolve) => { complete = resolve })
    },
  })
  const server = await listen(socketPath, service)
  const client = createVoiceAgentClient({ socketPath })
  t.after(async () => {
    complete?.('')
    client.stop()
    await server.close()
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  client.start()
  await waitFor(client, (status) => status.state === 'idle')
  assert.equal(client.toggle(), true)
  await waitFor(client, (status) => status.state === 'recording')
  assert.equal(client.toggle(), true)
  const working = await waitFor(client, (status) => status.state === 'thinking')
  assert.equal(working.transcript, transcript)
  assert.equal(working.message, '')
  emitText('## 项目\n正在整理')
  const partial = await waitFor(client, (status) => status.message === '## 项目\n正在整理')
  assert.equal(partial.state, 'thinking')
  assert.equal(partial.transcript, transcript)
  complete('## 项目\n整理完成')
  const final = await waitFor(client, (status) => status.state === 'idle')
  assert.equal(final.transcript, transcript)
  assert.equal(final.message, '## 项目\n整理完成')
})
