import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadCapabilities } from '../src/capabilities.mjs'
import { createPersonalTools } from '../src/personal-tools.mjs'
import { deskDataEndpoint, deskDataRequest } from '../src/desk-data.mjs'

const HYDRA = 'odk.tile.hydra'

/** A Shell-side Desk Data Link that answers what the test needs it to answer. */
async function listenDeskData(t, answer) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-desk-data-'))
  const socketPath = path.join(root, 'service.sock')
  const requests = []
  const server = net.createServer(client => {
    // A reader that refuses an oversized response closes the connection while this
    // side is still writing, which is the refusal working, not a failure.
    client.on('error', () => {})
    let buffer = ''
    client.on('data', chunk => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const request = JSON.parse(line)
        requests.push(request)
        client.write(JSON.stringify({ v: 1, id: request.id, ...answer(request) }) + '\n')
      }
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const original = process.env.ODESK_DESK_DATA_SOCKET
  process.env.ODESK_DESK_DATA_SOCKET = socketPath
  t.after(() => {
    if (original === undefined) delete process.env.ODESK_DESK_DATA_SOCKET
    else process.env.ODESK_DESK_DATA_SOCKET = original
  })
  return requests
}

const answered = request => request.command === 'list'
  ? { ok: true, readings: [{ id: HYDRA, label: 'Hydra plants', kind: 'tile' }] }
  : { ok: true, reading: { id: request.readingId, label: 'Hydra plants', kind: 'tile', state: 'live', value: { nodes: [{ id: 1, soilPercent: 30 }] } } }

const read = async (tool, params = {}) => JSON.parse((await tool.execute('call', params)).content[0].text)

test('the desk data endpoint is the one the Shell Host names for the desk-data link', () => {
  assert.equal(deskDataEndpoint({}, 'linux'), null, 'a Unix host without a runtime directory resolves no endpoint to guess')
  assert.equal(deskDataEndpoint({ XDG_RUNTIME_DIR: 'run/user/1000' }, 'linux'), null)
  assert.equal(deskDataEndpoint({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux'), '/run/user/1000/open-deskos-desk-data/service.sock')
  assert.equal(deskDataEndpoint({}, 'win32'), '\\\\.\\pipe\\open-deskos-desk-data')
  assert.equal(deskDataEndpoint({ ODESK_DESK_DATA_SOCKET: '/tmp/desk.sock' }, 'linux'), '/tmp/desk.sock')
})

test('the coding coordinator reads the readings the desk holds', async t => {
  const requests = await listenDeskData(t, answered)
  const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  assert.ok(tool, 'the coordinator must be able to reach the desk own readings')

  assert.deepEqual(await read(tool), { readings: [{ id: HYDRA, label: 'Hydra plants', kind: 'tile' }] })
  const reading = await read(tool, { id: HYDRA })
  assert.equal(reading.reading.state, 'live')
  assert.equal(reading.reading.value.nodes[0].soilPercent, 30)
  assert.deepEqual(requests.map(request => request.command), ['list', 'read'])
  assert.equal(requests[1].readingId, HYDRA)
})

test('both profiles read the one desk they share', async t => {
  await listenDeskData(t, answered)
  const coordinator = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  const assistant = createPersonalTools({ memory: { read: async () => '', update: async () => ({}), forget: async () => ({}) }, skillPaths: [] })
    .find(candidate => candidate.name === 'desk_data')
  assert.ok(assistant, 'the personal profile must reach the same readings the coordinator does')
  const fromCoordinator = await read(coordinator, { id: HYDRA })
  const fromAssistant = await read(assistant, { id: HYDRA })
  assert.deepEqual(fromAssistant, fromCoordinator, 'two profiles, one reading')
  assert.equal(fromCoordinator.reading.value.nodes[0].soilPercent, 30)
})

test('a refused reading is reported as a refusal and never as an empty reading', async t => {
  await listenDeskData(t, request => ({ ok: false, error: request.command === 'list' ? 'invalid-command' : 'unknown-reading' }))
  const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  await assert.rejects(() => tool.execute('call', { id: 'odk.tile.nothing' }), /unknown-reading/)
  await assert.rejects(() => tool.execute('call', {}), /invalid-command/)
})

test('an absent Shell is reported as the desk being unavailable', async () => {
  const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  const original = process.env.ODESK_DESK_DATA_SOCKET
  process.env.ODESK_DESK_DATA_SOCKET = path.join(os.tmpdir(), 'odesk-absent-desk-data.sock')
  try {
    await assert.rejects(() => tool.execute('call', {}), /unavailable/)
  } finally {
    if (original === undefined) delete process.env.ODESK_DESK_DATA_SOCKET
    else process.env.ODESK_DESK_DATA_SOCKET = original
  }
})

test('an oversized response is refused rather than truncated into a plausible reading', async t => {
  await listenDeskData(t, () => ({ ok: true, reading: { id: HYDRA, state: 'live', value: { notes: 'x'.repeat(300 * 1024) } } }))
  const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  await assert.rejects(() => tool.execute('call', { id: HYDRA }), /too large/)
})

test('a host without a runtime directory refuses to guess an endpoint', async () => {
  const original = process.env.ODESK_DESK_DATA_SOCKET
  const originalRuntime = process.env.XDG_RUNTIME_DIR
  delete process.env.ODESK_DESK_DATA_SOCKET
  delete process.env.XDG_RUNTIME_DIR
  try {
    const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
    await assert.rejects(() => tool.execute('call', {}), /unavailable/)
  } finally {
    if (original === undefined) delete process.env.ODESK_DESK_DATA_SOCKET
    else process.env.ODESK_DESK_DATA_SOCKET = original
    if (originalRuntime !== undefined) process.env.XDG_RUNTIME_DIR = originalRuntime
  }
})

test('the tool and both profiles state that this channel is judged on its own', async () => {
  const tool = (await loadCapabilities()).find(candidate => candidate.name === 'desk_data')
  assert.match(tool.description, /its own channel/)
  assert.match(tool.description, /read it again for every question/)
  const { codingInstructions, personalInstructions } = await import('../src/agent.mjs')
  assert.match(codingInstructions, /every such question reads the reading again/)
  assert.match(personalInstructions, /每一轮关于桌面读数的问题都要重新读一次/)
})

test('a reading whose own fields name a token is still a reading', async t => {
  // The frame's handshake is consumed by the listener, so the first line back is
  // the response. A client that hunts for a line that is not the handshake would
  // skip a perfectly valid reading whose value happens to contain that word.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-dd-'))
  t.after(async () => fs.rm(root, { recursive: true, force: true }))
  const socketPath = path.join(root, 'service.sock')
  const server = net.createServer(client => {
    let buffer = ''
    client.on('data', chunk => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      const request = JSON.parse(buffer.split('\n').filter(Boolean).at(-1))
      client.write(JSON.stringify({
        v: 1, id: request.id, ok: true,
        reading: { id: 'desk-note', kind: 'package', state: 'live', untrusted: true, value: { token: 'abc', remaining_seconds: 42 } },
      }) + '\n')
    })
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.listen(socketPath, resolve))
  const original = process.env.ODESK_DESK_DATA_SOCKET
  process.env.ODESK_DESK_DATA_SOCKET = socketPath
  t.after(() => { if (original === undefined) delete process.env.ODESK_DESK_DATA_SOCKET; else process.env.ODESK_DESK_DATA_SOCKET = original })
  const { reading } = await deskDataRequest('read', { id: 'desk-note' })
  assert.deepEqual(reading.value, { token: 'abc', remaining_seconds: 42 })
})

test('a frame that is not this protocol fails fast with a named reason', async t => {
  // The first line back is the response, so a frame that opens with anything else
  // is a wrong frame, not a slow one: it must say so at once rather than sit out
  // the request timeout and look like an absent Shell.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-dd3-'))
  t.after(async () => fs.rm(root, { recursive: true, force: true }))
  const cases = [
    ['a banner that is not JSON', 'welcome\n', /not a readable response/],
    ['a JSON frame from another protocol', '{"note":"not this protocol"}\n', /not a Desk data response/],
  ]
  for (const [label, firstLine, expected] of cases) {
    const socketPath = path.join(root, `${label.replace(/\W+/g, '-')}.sock`)
    const server = net.createServer(client => {
      let buffer = ''
      client.on('data', chunk => {
        buffer += chunk
        if (!buffer.includes('\n')) return
        client.write(firstLine)
        client.write(JSON.stringify({ v: 1, id: JSON.parse(buffer.split('\n').filter(Boolean).at(-1)).id, ok: true }) + '\n')
      })
    })
    t.after(() => new Promise(resolve => server.close(resolve)))
    await new Promise(resolve => server.listen(socketPath, resolve))
    const original = process.env.ODESK_DESK_DATA_SOCKET
    process.env.ODESK_DESK_DATA_SOCKET = socketPath
    const started = Date.now()
    await assert.rejects(() => deskDataRequest('list'), expected, label)
    assert.ok(Date.now() - started < 5000, `${label} must not wait out the request timeout`)
    if (original === undefined) delete process.env.ODESK_DESK_DATA_SOCKET
    else process.env.ODESK_DESK_DATA_SOCKET = original
  }
})
