'use strict'

const { randomUUID } = require('node:crypto')
const { sanitizeRuntimePlugins } = require('./plugin-runtime-report')

const RENDERER_RUNTIME_PORT = 'odk:plugin-runtime/electron-renderer/v1'

function createRendererDiagnosticsPlugin() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.renderer-diagnostics', name: 'Renderer lifecycle diagnosis',
      version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: RENDERER_RUNTIME_PORT }],
      requires: [], permissions: ['system.renderer-diagnostics'] },
    create(ctx) {
      const config = ctx.capability('system.renderer-diagnostics')
      const pending = new Map()
      const unavailable = (instance, reason) => ({ host: 'electron-renderer', instance, state: 'unavailable', reason, plugins: [] })
      const finish = (id, result) => {
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        clearTimeout(request.timer)
        request.resolve(result)
      }
      const report = (event, value) => {
        const request = pending.get(value?.requestId)
        if (!request || event.sender !== request.frame.sender) return
        let mainFrame
        try { mainFrame = request.frame.mainFrame() }
        catch { finish(value.requestId, unavailable(request.instance, 'frame-unavailable')); return }
        if (!mainFrame || event.senderFrame !== mainFrame) return
        try {
          finish(value.requestId, { host: 'electron-renderer', instance: request.instance, state: 'available', plugins: sanitizeRuntimePlugins(value, 'electron-renderer') })
        } catch { finish(value.requestId, unavailable(request.instance, 'invalid-report')) }
      }
      const cancel = () => {
        for (const [id, request] of pending) finish(id, unavailable(request.instance, 'stopped'))
      }
      config.ipc.on('odk-plugin-runtime-report', report)
      ctx.signal.addEventListener('abort', cancel)
      ctx.onCleanup(() => {
        cancel()
        ctx.signal.removeEventListener('abort', cancel)
        config.ipc.removeListener('odk-plugin-runtime-report', report)
      })
      const probe = frame => {
        const instance = `frame-${frame.id}`
        if (pending.size >= 32) return Promise.resolve(unavailable(instance, 'busy'))
        return new Promise(resolve => {
          const requestId = randomUUID()
          const timer = setTimeout(() => finish(requestId, unavailable(instance, 'timeout')), config.timeoutMs ?? 500)
          pending.set(requestId, { frame, instance, resolve, timer })
          try { frame.send('odk-plugin-runtime-request', { requestId }) }
          catch { finish(requestId, unavailable(instance, 'send-failed')) }
        })
      }
      return { ports: { [RENDERER_RUNTIME_PORT]: { async snapshot() {
        if (ctx.signal.aborted) return [unavailable('shell', 'stopped')]
        const frames = config.frames()
        if (!frames.length) return [unavailable('shell', 'no-frame')]
        const results = await Promise.all(frames.slice(0, 8).map(probe))
        if (frames.length > 8) results.push(unavailable('additional-frames', 'frame-limit'))
        return results
      } } } }
    },
  }
}

module.exports = { createRendererDiagnosticsPlugin, RENDERER_RUNTIME_PORT, sanitizeRuntimePlugins }
