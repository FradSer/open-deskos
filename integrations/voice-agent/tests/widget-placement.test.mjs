import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadCapabilities } from '../src/capabilities.mjs'

test('desktop discovery and exact install/move placement reach the lifecycle socket', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odeskv-'))
  const socketPath = path.join(root, 'apps.sock')
  const original = process.env.ODESK_APPS_CONTROL_SOCKET
  process.env.ODESK_APPS_CONTROL_SOCKET = socketPath
  const received = []
  const server = net.createServer(client => {
    let buffer = ''
    client.on('data', chunk => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      const request = JSON.parse(buffer)
      received.push(request)
      client.end(JSON.stringify({ v: 1, id: request.id, ok: true, pages: [] }) + '\n')
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
    if (original === undefined) delete process.env.ODESK_APPS_CONTROL_SOCKET
    else process.env.ODESK_APPS_CONTROL_SOCKET = original
  })
  const tools = await loadCapabilities()
  const desktop = tools.find(tool => tool.name === 'user_apps_desktop')
  assert.ok(desktop)
  await desktop.execute('call', {})
  const placement = { pageId: 'reading', col: '2 / 5', row: '3' }
  await tools.find(tool => tool.name === 'user_app_install').execute('call', { id: 'note', placement })
  await tools.find(tool => tool.name === 'user_app_place').execute('call', { id: 'note', placement })
  assert.deepEqual(received.map(({ command }) => command), ['desktop', 'install', 'place'])
  assert.deepEqual(received[1].placement, placement)
  assert.deepEqual(received[2].placement, placement)
})
