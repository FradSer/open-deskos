import { createServer, createConnection } from 'node:net'
import { chmodSync, linkSync, lstatSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { privateSocketPath } from './socket-path.mjs'
import { SocketTransport } from './socket-transport.mjs'
import { createGmailServer } from './server.mjs'

async function staleSocket(path) {
  let before
  try { before = lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!before.isSocket() || before.uid !== process.getuid()) throw Error('Gmail socket path already exists')
  await new Promise((resolve, reject) => {
    const probe = createConnection(path)
    probe.setTimeout(500, () => { probe.destroy(); reject(Error('Gmail socket ownership unknown')) })
    probe.once('connect', () => { probe.destroy(); reject(Error('Gmail service already running')) })
    probe.once('error', error => { probe.destroy(); ['ECONNREFUSED', 'ENOENT'].includes('code' in error ? String(error.code) : '') ? resolve(undefined) : reject(Error('Gmail socket ownership unknown')) })
  })
  const after = lstatSync(path)
  if (before.dev !== after.dev || before.ino !== after.ino) throw Error('Gmail socket changed')
  unlinkSync(path)
}

/** One provider and its cancellation scope belong to each bounded MCP session. */
export async function startGmailDaemon({ socketPath, credentialsFile, fetchImpl = fetch, frameTimeout = 3000 }) {
  privateSocketPath(socketPath, true)
  await staleSocket(socketPath)
  // libuv unlinks its original bind name on close without checking its inode.
  // Publish an exclusive alias so automatic cleanup never targets the public name.
  const bindPath = join(dirname(socketPath), '.g-' + randomUUID().slice(0, 8))
  privateSocketPath(bindPath)
  const sessions = new Map()
  let identity, closing
  const listener = createServer(socket => {
    if (sessions.size >= 8 || closing) { socket.destroy(); return }
    try {
      const runtime = createGmailServer({ credentialsFile, fetchImpl })
      sessions.set(socket, runtime)
      socket.once('close', () => { sessions.delete(socket); void runtime.close().catch(() => {}) })
      void runtime.server.connect(new SocketTransport(socket, { health: true, frameTimeout })).catch(() => socket.destroy())
    } catch { socket.destroy() }
  })
  try {
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(bindPath, () => resolve(undefined)) })
    linkSync(bindPath, socketPath)
    unlinkSync(bindPath)
    identity = lstatSync(socketPath)
    chmodSync(socketPath, 0o600)
  } catch (error) {
    listener.close()
    if (identity) {
      try { const current = lstatSync(socketPath); if (current.dev === identity.dev && current.ino === identity.ino) unlinkSync(socketPath) } catch {}
    }
    throw error
  }
  listener.on('error', () => { void close().catch(() => { process.exitCode = 1 }) })
  function close() {
    return closing ??= (async () => {
      const stopped = new Promise(resolve => listener.close(() => resolve(undefined)))
      for (const [socket, runtime] of sessions) { socket.destroy(); await runtime.close().catch(() => {}) }
      await stopped
      try {
        const current = lstatSync(socketPath)
        if (identity && current.dev === identity.dev && current.ino === identity.ino) unlinkSync(socketPath)
      } catch (error) { if (error.code !== 'ENOENT') throw Error('Gmail socket cleanup unavailable') }
    })()
  }
  return { close }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  try {
    const daemon = await startGmailDaemon({ socketPath: process.env.ODK_GMAIL_SERVICE_SOCKET, credentialsFile: process.env.ODK_MCP_GMAIL_CREDENTIALS_FILE })
    for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => { void daemon.close().then(() => process.exit(0), () => process.exit(1)) })
  } catch { process.stderr.write('Gmail service unavailable. Check private operator bindings.\n'); process.exitCode = 1 }
}
