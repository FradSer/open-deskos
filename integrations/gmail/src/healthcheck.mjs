import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { checkSocket } from './socket-path.mjs'

/** Probe local admission only. Credentials and Google are never consulted. */
export async function checkHealth(socketPath) {
  try { checkSocket(socketPath) } catch { return false }
  return new Promise(resolve => {
    const id = randomUUID()
    const socket = createConnection(socketPath)
    let pending = Buffer.alloc(0), settled = false
    const timer = setTimeout(() => finish(false), 2000)
    function finish(value) { if (!settled) { settled = true; clearTimeout(timer); socket.destroy(); resolve(value) } }
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
    socket.once('connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'odk/health' }) + '\n'))
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, Buffer.from(chunk)])
      if (pending.length > 2048) return finish(false)
      if (!pending.includes(10)) return
      try { const reply = JSON.parse(pending.toString('utf8')); finish(reply.jsonrpc === '2.0' && reply.id === id && reply.result?.ready === true) }
      catch { finish(false) }
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ready = await checkHealth(process.env.ODK_GMAIL_SERVICE_SOCKET)
  process.stdout.write(ready ? 'Gmail service ready.\n' : 'Gmail service unavailable.\n')
  process.exitCode = ready ? 0 : 1
}
