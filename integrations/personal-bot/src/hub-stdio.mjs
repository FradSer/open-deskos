// Forced SSH command: this entry exposes only the owner's fixed runtime socket.
import net from 'node:net'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function bridgeMain({ input = process.stdin, output = process.stdout, uid = process.getuid?.(), connect = net.connect } = {}) {
  if (!Number.isSafeInteger(uid) || uid <= 0) throw Error('A non-root resident owner is required')
  const socket = connect(`/run/user/${uid}/odk-personal-bot/agent.sock`)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    input.unpipe(socket)
    socket.destroy()
    if (!output.destroyed) output.end()
  }
  socket.once('error', close)
  socket.once('close', close)
  output.once('error', close)
  output.once('close', close)
  input.once('close', close)
  input.once('error', close)
  input.pipe(socket)
  socket.pipe(output)
  return socket
}
let directEntry = false
try { directEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch {}
if (directEntry) {
  if (process.argv.length !== 2) process.exitCode = 1
  else { try { bridgeMain() } catch { process.exitCode = 1 } }
}
