const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')

const COMMANDS = new Set(['install', 'rollback', 'remove'])

function createUserAppControl(store, onChange = () => {}) {
  return {
    async dispatch(request) {
      if (request?.command !== 'list' && !COMMANDS.has(request?.command)) return { ok: false, error: 'invalid-command' }
      if (request.command !== 'list' && (typeof request.appId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(request.appId))) {
        return { ok: false, error: 'invalid-app-id' }
      }
      try {
        if (request.command === 'list') {
          const apps = await store.list()
          if (!Array.isArray(apps)) return { ok: false, error: 'application-store-unavailable' }
          return { ok: true, apps }
        }
        const result = await store[request.command](request.appId)
        if (result.ok) onChange()
        return result
      } catch {
        return { ok: false, error: 'application-store-unavailable' }
      }
    },
  }
}

async function removeStaleSocket(socketPath) {
  let info
  try { info = await fs.lstat(socketPath) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!info.isSocket() || info.uid !== process.getuid()) throw Error('Unsafe application socket')
  const active = await new Promise((resolve, reject) => {
    const probe = net.connect(socketPath)
    probe.setTimeout(1000, () => { probe.destroy(); reject(Error('Application socket probe timeout')) })
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve(false)
      else reject(error)
    })
  })
  if (active) throw Error('Application service already running')
  await fs.unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error })
}

async function listenUserAppControl({ socketPath, control }) {
  const directory = path.dirname(socketPath)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(directory)
  if (!info.isDirectory() || info.uid !== process.getuid()) throw Error('Unsafe application runtime directory')
  await fs.chmod(directory, 0o700)
  await removeStaleSocket(socketPath)
  const clients = new Set()
  const server = net.createServer(client => {
    clients.add(client)
    client.setEncoding('utf8')
    client.setTimeout(35000, () => client.destroy())
    client.on('error', () => client.destroy())
    client.once('close', () => clients.delete(client))
    let pending = ''
    let received = false
    client.on('data', chunk => {
      if (received) return client.destroy()
      pending += chunk
      if (Buffer.byteLength(pending) > 4096) return client.destroy()
      if (!pending.includes('\n')) return
      received = true
      let request
      try { request = JSON.parse(pending.trim()) } catch { return client.destroy() }
      if (request?.v !== 1 || typeof request.id !== 'string' || !/^[\w.-]{1,128}$/.test(request.id)) return client.destroy()
      void control.dispatch(request).then(result => {
        if (!client.destroyed) client.end(JSON.stringify({ v: 1, id: request.id, ...result }) + '\n')
      }).catch(() => client.destroy())
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await fs.chmod(socketPath, 0o600)
  return { close: async () => {
    for (const client of clients) client.destroy()
    await new Promise(resolve => server.close(resolve))
  } }
}

module.exports = { createUserAppControl, listenUserAppControl }
