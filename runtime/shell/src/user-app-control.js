const fs = require('node:fs/promises')
const path = require('node:path')
const { listenChannel } = require('./local-channel')

const COMMANDS = new Set(['install', 'update', 'rollback', 'remove', 'place'])

function createUserAppControl(store, onChange = () => {}) {
  return {
    async dispatch(request) {
      if (!['list', 'desktop', 'add'].includes(request?.command) && !COMMANDS.has(request?.command)) return { ok: false, error: 'invalid-command' }
      if (request.command === 'add' && (typeof request.sourcePath !== 'string' || !path.isAbsolute(request.sourcePath) || request.sourcePath.includes('\0'))) {
        return { ok: false, error: 'invalid-package-path' }
      }
      if (COMMANDS.has(request.command) && (typeof request.appId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(request.appId))) {
        return { ok: false, error: 'invalid-app-id' }
      }
      try {
        if (request.command === 'desktop') return { ok: true, pages: await store.desktop() }
        if (request.command === 'list') {
          const apps = await store.list()
          if (!Array.isArray(apps)) return { ok: false, error: 'application-store-unavailable' }
          return { ok: true, apps }
        }
        const method = request.command === 'add' ? 'addFromPath' : request.command === 'update' ? 'updateInstalled' : request.command
        const result = await store[method](request.command === 'add' ? request.sourcePath : request.appId, request.placement)
        if (result.ok) onChange()
        return result
      } catch {
        return { ok: false, error: 'application-store-unavailable' }
      }
    },
  }
}

/**
 * The external control endpoint a user application agent connects to. The
 * transport and its authentication belong to the local channel: ownership where
 * the host has it, the shared channel token where it does not.
 */
async function listenUserAppControl({ socketPath, control, channelToken = '', platform = process.platform }) {
  return listenChannel({
    endpoint: socketPath,
    token: channelToken,
    platform,
    onConnection: (client) => {
      client.setEncoding('utf8')
      client.setTimeout(35000, () => client.destroy())
      client.on('error', () => client.destroy())
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
    },
  })
}

module.exports = { createUserAppControl, listenUserAppControl }
