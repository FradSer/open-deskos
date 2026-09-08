import { createServer, connect } from 'node:net'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

async function removeStale(path) {
  try {
    const info = await lstat(path)
    if (!info.isSocket()) throw Error('Control path is not a socket')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const active = await new Promise((resolve, reject) => {
    const probe = connect(path)
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', error => {
      if ('code' in error && (error.code === 'ECONNREFUSED' || error.code === 'ENOENT')) resolve(false)
      else reject(error)
    })
  })
  if (active) throw Error('Voice service already running')
  await unlink(path)
}

export async function listen(path, service) {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  if (!info.isDirectory() || info.uid !== process.getuid?.()) throw Error('Unsafe control directory')
  await chmod(dir, 0o700)
  await removeStale(path)
  const clients = new Set()
  const server = createServer(client => {
    clients.add(client)
    client.setEncoding('utf8')
    let pending = ''
    client.on('error', () => client.destroy())
    client.on('close', () => clients.delete(client))
    client.on('data', data => {
      pending += data
      if (Buffer.byteLength(pending) > 4096) return client.destroy()
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        let command
        try { command = JSON.parse(line) } catch { return client.destroy() }
        if (command?.v !== 1 || !['toggle', 'status'].includes(command.type)) return client.destroy()
        if (command.type === 'toggle') void service.toggle().catch(() => service.setState('error', 'Voice request failed'))
        send(client, service.status)
      }
    })
  })
  const unsubscribe = service.subscribe(status => { for (const client of clients) send(client, status) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => { server.removeListener('error', reject); resolve(undefined) })
  })
  await chmod(path, 0o600)
  return { close: async () => {
    unsubscribe()
    for (const client of clients) client.destroy()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
  } }
}

function send(client, status) {
  if (client.writableLength > 65_536) client.destroy()
  else client.write(`${JSON.stringify(status)}\n`)
}
