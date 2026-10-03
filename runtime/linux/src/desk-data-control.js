'use strict'

const { listenChannel } = require('./local-channel')
const { READING_ID } = require('./desk-data-registry')

const MAX_REQUEST_BYTES = 4096
const REQUEST_ID = /^[\w.-]{1,128}$/

/**
 * The read-only face of the Desk Data registry.
 *
 * Two commands exist and neither of them changes anything: a listing names what
 * the desk holds, and a read returns one reading as it stands. A command that is
 * not one of those is refused, so this channel cannot become a second, weaker way
 * to act on the desk.
 */
function createDeskDataControl(registry) {
  return {
    async dispatch(request) {
      if (request?.command === 'list') return { ok: true, readings: registry.list() }
      if (request?.command !== 'read') return { ok: false, error: 'invalid-command' }
      if (typeof request.readingId !== 'string' || !READING_ID.test(request.readingId)) return { ok: false, error: 'invalid-reading-id' }
      return registry.read(request.readingId)
    },
  }
}

/**
 * The Desk Data Link the Personal Bot opens: the Shell listens, the agent asks.
 * The transport and its authentication belong to the local channel, so a Unix
 * host authenticates by ownership and a Windows pipe by the shared channel token.
 */
async function listenDeskData({ endpoint, control, channelToken = '', stateDir = '', platform = process.platform }) {
  return listenChannel({
    endpoint,
    token: channelToken,
    stateDir,
    platform,
    onConnection: (client) => {
      client.setEncoding('utf8')
      client.on('error', () => client.destroy())
      let pending = ''
      let received = false
      client.on('data', chunk => {
        if (received) return client.destroy()
        pending += chunk
        if (Buffer.byteLength(pending, 'utf8') > MAX_REQUEST_BYTES) return client.destroy()
        if (!pending.includes('\n')) return
        received = true
        let request
        try { request = JSON.parse(pending.trim()) } catch { return client.destroy() }
        if (request?.v !== 1 || typeof request.id !== 'string' || !REQUEST_ID.test(request.id)) return client.destroy()
        // The registry is the one bound on a reading, so this layer only carries
        // the answer: a refused read is refused here too, never trimmed on the way.
        void control.dispatch(request).then(result => {
          if (!client.destroyed) client.end(JSON.stringify({ v: 1, id: request.id, ...result }) + '\n')
        }).catch(() => client.destroy())
      })
    },
  })
}

module.exports = { createDeskDataControl, listenDeskData, MAX_REQUEST_BYTES }
