'use strict'

const { randomUUID } = require('node:crypto')
const { sanitizeRuntimePlugins } = require('./plugin-runtime-report')

function createRuntimeChannelProbe({ endpoint, host, instance, connect, timeoutMs = 500,
  encodeRequest = requestId => ({ v: 1, type: 'runtime_diagnose', requestId }),
  decodeResponse = (record, requestId) => record?.v === 1 && record.type === 'runtime_diagnosis' && record.requestId === requestId ? { runtime: record.runtime } : null,
}) {
  const pending = new Set()
  const unavailable = reason => [{ host, instance, state: 'unavailable', reason, plugins: [] }]
  function request({ signal } = {}) {
    if (signal?.aborted) return Promise.resolve(unavailable('stopped'))
    let target
    try { target = typeof endpoint === 'function' ? endpoint() : endpoint }
    catch { return Promise.resolve(unavailable('resolution-failed')) }
    if (signal?.aborted) return Promise.resolve(unavailable('stopped'))
    if (!target) return Promise.resolve(unavailable('disconnected'))
    if (pending.size >= 16) return Promise.resolve(unavailable('busy'))
    return new Promise(resolve => {
      let socket
      let timer
      let settled = false
      let buffer = ''
      let bytes = 0
      const requestId = randomUUID()
      const finish = result => {
        if (settled) return
        settled = true
        pending.delete(cancel)
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        socket?.destroy()
        resolve(result)
      }
      const cancel = () => finish(unavailable('stopped'))
      pending.add(cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => finish(unavailable('timeout')), timeoutMs)
      try { socket = connect(target) }
      catch { finish(unavailable('disconnected')); return }
      if (settled) { socket.destroy(); return }
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        if (settled) return
        try { socket.write(`${JSON.stringify(encodeRequest(requestId))}\n`) }
        catch { finish(unavailable('send-failed')) }
      })
      socket.on('data', chunk => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 65536) return finish(unavailable('invalid-report'))
        buffer += chunk
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          let record
          try { record = JSON.parse(line) } catch { continue }
          try {
            const response = decodeResponse(record, requestId)
            if (!response) continue
            const runtime = response.runtime
            if (runtime?.host !== host || runtime.instance !== instance) throw Error('invalid runtime')
            if (runtime.state === 'available') finish([{ host, instance, state: 'available', plugins: sanitizeRuntimePlugins(runtime, host) }])
            else if (runtime.state === 'unavailable' && typeof runtime.reason === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(runtime.reason)) finish(unavailable(runtime.reason))
            else throw Error('invalid runtime')
          } catch { finish(unavailable('invalid-report')) }
          return
        }
      })
      socket.once('error', () => finish(unavailable('disconnected')))
      socket.once('close', () => finish(unavailable('disconnected')))
    })
  }
  return { request, stop() { for (const cancel of pending) cancel() } }
}

module.exports = { createRuntimeChannelProbe }
