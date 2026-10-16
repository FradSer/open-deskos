'use strict'

const { listenChannel } = require('../../src/local-channel')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')

// This fixture owns framing and listener lifecycle. It shares only the existing
// authenticated channel and selected read-only control, not the default listener.
function createOdkDataLinkReplacement() {
  const counts = { starts: 0, closes: 0, requests: 0 }
  const plugin = {
    manifest: {
      schemaVersion: 1, id: 'odk.transport.data', name: 'Alternative Open DeskOS Data Link',
      version: '2.0.0', kind: 'service', host: 'electron-main', provides: [],
      requires: [{ interface: DESK_PORTS.data }], permissions: ['desk.link'],
    },
    create(ctx) {
      const config = ctx.capability('desk.link')
      const control = ctx.get(DESK_PORTS.data).control
      let listener
      ctx.onCleanup(async () => {
        if (!listener) return
        await listener.close()
        counts.closes++
      })
      return { async start() {
        listener = await listenChannel({
          ...config.options,
          onConnection(client) {
            let frame = ''
            let received = false
            client.setEncoding('utf8')
            client.on('error', () => client.destroy())
            client.on('data', chunk => {
              if (received) return client.destroy()
              frame += chunk
              if (Buffer.byteLength(frame) > 4096) return client.destroy()
              if (!frame.includes('\n')) return
              received = true
              let request
              try { request = JSON.parse(frame.trim()) } catch { return client.destroy() }
              if (request?.v !== 1 || typeof request.id !== 'string' || !/^[\w.-]{1,128}$/.test(request.id)) return client.destroy()
              counts.requests++
              void control.dispatch(request).then(result => {
                if (!client.destroyed) client.end(`${JSON.stringify({ v: 1, id: request.id, ...result })}\n`)
              }).catch(() => client.destroy())
            })
          },
        })
        counts.starts++
      } }
    },
  }
  return { plugin, counts }
}

module.exports = { createOdkDataLinkReplacement }
