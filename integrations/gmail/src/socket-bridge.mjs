import { createConnection } from 'node:net'
import { pathToFileURL } from 'node:url'
import { checkSocket } from './socket-path.mjs'

/** Credential-free stdio adapter. Only bounded MCP frames cross this socket. */
export function bridgeSocket({ socketPath, input = process.stdin, output = process.stdout }) {
  checkSocket(socketPath)
  const socket = createConnection(socketPath)
  let incoming = Buffer.alloc(0), outgoing = Buffer.alloc(0)
  let inputTimer, outputTimer
  let settled = false
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(), 2000)
    function fail() { if (!settled) { settled = true; clearTimeout(timer); socket.destroy(); reject(Error('Gmail service unavailable')) } }
    socket.once('error', fail)
    socket.once('connect', () => { settled = true; clearTimeout(timer); resolve(undefined) })
  })
  function forward(chunk, pending, limit, destination, source) {
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset)
      const end = newline < 0 ? chunk.length : newline + 1
      const part = chunk.subarray(offset, end)
      if (pending.length + part.length > limit) { socket.destroy(); return Buffer.alloc(0) }
      pending = Buffer.concat([pending, part])
      offset = end
      if (newline < 0) break
      const frame = pending
      pending = Buffer.alloc(0)
      try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame)) } catch { socket.destroy(); return Buffer.alloc(0) }
      if (destination.writableLength > 131072) { socket.destroy(); return Buffer.alloc(0) }
      if (!destination.write(frame, error => { if (error) socket.destroy() })) { source.pause(); destination.once('drain', () => source.resume()) }
    }
    return pending
  }
  const onInput = chunk => {
    incoming = forward(chunk, incoming, 8192, socket, input)
    if (!incoming.length) { clearTimeout(inputTimer); inputTimer = undefined }
    else if (!inputTimer) inputTimer = setTimeout(() => socket.destroy(), 3000)
  }
  const onOutput = chunk => {
    outgoing = forward(chunk, outgoing, 65536, output, socket)
    if (!outgoing.length) { clearTimeout(outputTimer); outputTimer = undefined }
    else if (!outputTimer) outputTimer = setTimeout(() => socket.destroy(), 3000)
  }
  const stop = () => socket.destroy()
  input.on('data', onInput)
  input.once('end', stop)
  input.once('error', stop)
  output.once('error', stop)
  socket.on('data', onOutput)
  const closed = new Promise(resolve => socket.once('close', () => {
    input.off('data', onInput); input.off('end', stop); input.off('error', stop)
    clearTimeout(inputTimer); clearTimeout(outputTimer)
    input.pause()
    resolve(undefined)
  }))
  return { ready, closed, close: stop }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bridge = bridgeSocket({ socketPath: process.env.ODK_MCP_GMAIL_SOCKET })
    for (const name of ['SIGTERM', 'SIGINT']) process.once(name, bridge.close)
    await bridge.ready
    await bridge.closed
  } catch { process.stderr.write('Gmail service unavailable.\n'); process.exitCode = 1 }
}
