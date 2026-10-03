import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listen } from '../src/socket.mjs'

test('toggle acknowledgement waits for the accepted retry instead of echoing stale error', { timeout: 3000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-ack-'))
  let release
  const service = {
    status: { v: 1, type: 'status', state: 'error', message: 'Previous failure' },
    subscribe: () => () => {},
    async toggle() {
      await new Promise(resolve => { release = resolve })
      this.status = { v: 1, type: 'status', state: 'recording', message: '' }
    },
    setState() {},
  }
  const server = await listen(join(directory, 'agent.sock'), service)
  const client = connect(join(directory, 'agent.sock'))
  t.after(async () => { release?.(); client.destroy(); await server.close(); await rm(directory, { recursive: true, force: true }) })
  await once(client, 'connect')
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write('{"v":1,"type":"toggle"}\n{"v":1,"type":"status"}\n')
  await once(client, 'data')
  assert.equal(records.length, 1, 'Only the explicit status query replies while toggle is pending')
  assert.equal(records[0].state, 'error')
  const acknowledged = once(client, 'data')
  release()
  await acknowledged
  assert.equal(records.at(-1).state, 'recording')
})
