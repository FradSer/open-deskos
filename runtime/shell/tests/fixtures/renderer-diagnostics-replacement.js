'use strict'

const { randomUUID } = require('node:crypto')
const { sanitizeRuntimePlugins } = require('../../src/plugin-runtime-report')
const port = 'odk:plugin-runtime/electron-renderer/v1'

function independentRendererDiagnostics() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.renderer-diagnostics', name: 'Selected Renderer diagnosis',
      version: '2.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: port }],
      requires: [], permissions: ['system.renderer-diagnostics'] },
    create(ctx) {
      const options = ctx.capability('system.renderer-diagnostics')
      const requests = new Map()
      const unavailable = (instance, reason) => ({ host: 'electron-renderer', instance, state: 'unavailable', reason, plugins: [] })
      const receive = (event, report) => {
        const request = requests.get(report?.requestId)
        if (!request || event.sender !== request.frame.sender) return
        let mainFrame
        try { mainFrame = request.frame.mainFrame() }
        catch { request.finish(unavailable(request.instance, 'frame-unavailable')); return }
        if (!mainFrame || event.senderFrame !== mainFrame) return
        try {
          request.finish({ host: 'electron-renderer', instance: request.instance, state: 'available',
            plugins: sanitizeRuntimePlugins(report, 'electron-renderer') })
        } catch { request.finish(unavailable(request.instance, 'invalid-report')) }
      }
      const cancel = () => {
        for (const request of requests.values()) request.finish(unavailable(request.instance, 'stopped'))
      }
      options.ipc.on('odk-plugin-runtime-report', receive)
      ctx.signal.addEventListener('abort', cancel)
      ctx.onCleanup(() => {
        cancel()
        ctx.signal.removeEventListener('abort', cancel)
        options.ipc.removeListener('odk-plugin-runtime-report', receive)
      })
      const probe = frame => {
        const instance = `frame-${frame.id}`
        if (requests.size >= 32) return Promise.resolve(unavailable(instance, 'busy'))
        return new Promise(resolve => {
          const requestId = randomUUID()
          const request = { frame, instance, finish(result) {
            if (!requests.delete(requestId)) return
            clearTimeout(request.timer)
            resolve(result)
          } }
          request.timer = setTimeout(() => request.finish(unavailable(instance, 'timeout')), options.timeoutMs ?? 500)
          requests.set(requestId, request)
          try { frame.send('odk-plugin-runtime-request', { requestId }) }
          catch { request.finish(unavailable(instance, 'send-failed')) }
        })
      }
      return { ports: { [port]: { async snapshot() {
        if (ctx.signal.aborted) return [unavailable('shell', 'stopped')]
        const frames = options.frames()
        if (!frames.length) return [unavailable('shell', 'no-frame')]
        const reports = await Promise.all(frames.slice(0, 8).map(probe))
        return frames.length > 8 ? [...reports, unavailable('additional-frames', 'frame-limit')] : reports
      } } } }
    },
  }
}

module.exports = { independentRendererDiagnostics }
