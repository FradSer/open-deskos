const { test } = require('node:test')
const { integrationURL } = require('./helpers/repo-root')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createPersonalBotClient } = require('../src/personal-bot-client')

test('typed input is acknowledged by the resident service and never replayed', async t => {
  const { PersonalBotService } = await import(integrationURL('personal-bot/src/service.mjs'))
  const { listen } = await import(integrationURL('personal-bot/src/socket.mjs'))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-text-'))
  let complete
  let calls = 0
  const service = new PersonalBotService({ record: async () => { throw Error('not a voice turn') }, transcribe: async () => '',
    prompt: async (text, snapshot) => { calls++; assert.equal(text, 'Hello 中文'); snapshot('Partial'); return await new Promise(resolve => { complete = resolve }) } })
  const endpoint = path.join(dir, 'agent.sock')
  const server = await listen(endpoint, service)
  const client = createPersonalBotClient({ socketPath: endpoint, reconnectDelayMs: 50 })
  t.after(async () => { client.stop(); complete?.('Final'); await service.close(); await server.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const connected = new Promise(resolve => { const release = client.subscribe(status => { if (status.textInput) { release(); resolve() } }) })
  client.start()
  await connected
  assert.equal(await client.sendText('Hello 中文'), true)
  assert.equal(calls, 1)
  assert.equal(await client.sendText('duplicate'), false)
  assert.equal(await client.sendText('\u0000'.repeat(2500)), false)
  complete('Final')
  await service.pending
  client.stop()
  assert.equal(await client.sendText('after disconnect'), false)
})
