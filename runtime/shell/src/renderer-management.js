'use strict'

const { randomUUID } = require('node:crypto')
const { listenDeskData } = require('./desk-data-control')
const ID = 'odk.system.renderer-control'
const SCOPE = 'electron-renderer'
const PLUGIN_ID = /^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/

function createRendererManagement({ ipc, frames, signal, timeoutMs, prepareActivation }) {
  const pending = new Map()
  let closed = false
  let activating = null
  const releaseImplementation = request => {
    if (activating === request && !request.preparing && (!request.dispatched || request.settled)) activating = null
  }
  const failure = (request, reason) => ({ ok: false, error: request.command === 'inventory' ? reason : `${reason}; operation outcome unknown` })
  const finish = (id, result) => {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    request.lifetime.abort()
    clearTimeout(request.timer)
    request.resolve(result)
  }
  function validate(result, request) {
    if (!result || Buffer.byteLength(JSON.stringify(result)) > 16384) throw Error('invalid result')
    if (result.ok === false && Object.keys(result).every(key => ['ok', 'error'].includes(key))
      && ['invalid-command', 'unknown-plugin', 'runtime-unavailable', 'lifecycle-failed', 'activation-failed', 'restoration-failed'].includes(result.error)) return result
    if (result.ok !== true || result.scope !== SCOPE) throw Error('invalid result')
    if (request.command === 'inventory') {
      if (Object.keys(result).some(key => !['ok', 'scope', 'plugins'].includes(key))
        || !Array.isArray(result.plugins) || !result.plugins.length || result.plugins.length > 128) throw Error('invalid inventory')
      const identities = new Set()
      for (const plugin of result.plugins) {
        if (!plugin || Object.keys(plugin).some(key => !['pluginId', 'host'].includes(key))
          || typeof plugin.pluginId !== 'string' || !PLUGIN_ID.test(plugin.pluginId) || plugin.host !== SCOPE || identities.has(plugin.pluginId)) throw Error('invalid inventory')
        identities.add(plugin.pluginId)
      }
    } else if (request.command === 'restore-default') {
      if (Object.keys(result).some(key => !['ok', 'scope', 'pluginId', 'implementation', 'version', 'state'].includes(key))
        || result.pluginId !== request.pluginId || result.implementation !== 'built-in'
        || typeof result.version !== 'string' || !result.version || result.state !== 'running') throw Error('invalid restoration receipt')
    } else if (request.command === 'activate') {
      if (Object.keys(result).some(key => !['ok', 'scope', 'pluginId', 'revision', 'version', 'state'].includes(key))
        || result.pluginId !== request.pluginId || result.revision !== request.revision
        || result.version !== request.version || result.state !== 'running') throw Error('invalid activation receipt')
    } else if (Object.keys(result).some(key => !['ok', 'scope', 'pluginId', 'enabled', 'state'].includes(key))
      || result.pluginId !== request.pluginId || result.enabled !== (request.command === 'enable')
      || result.state !== (result.enabled ? 'running' : 'disabled')) throw Error('invalid receipt')
    return result
  }
  const report = (event, value) => {
    if (closed || signal.aborted) return
    // A public timeout ends the caller's wait, not the browser's operation.
    // Retain the original frame and capture until its actual completion arrives.
    const request = pending.get(value?.requestId) || (activating?.requestId === value?.requestId ? activating : undefined)
    if (!request || event.sender !== request.frame.sender || event.senderFrame !== request.mainFrame) return
    try {
      if (Object.keys(value).some(key => !['requestId', 'result'].includes(key)) || Buffer.byteLength(JSON.stringify(value)) > 16384) throw Error('invalid report')
      if (request.frame.mainFrame() !== request.mainFrame) throw Error('navigated frame')
      const result = validate(value.result, request.command)
      if (activating === request) {
        if (!request.dispatched || request.settled) return
        request.settled = true
        releaseImplementation(request)
      }
      finish(value.requestId, result)
    } catch {
      finish(value.requestId, request.command.command === 'inventory'
        ? { ok: false, error: 'inventory-unavailable' } : failure(request.command, 'invalid-renderer-response'))
    }
  }
  const cancel = () => {
    for (const [id, request] of pending) finish(id, failure(request.command, 'runtime-stopped'))
  }
  ipc.on('odk-renderer-control-report', report)
  signal.addEventListener('abort', cancel)
  return {
    dispatch(request) {
      if (!request || !['inventory', 'enable', 'disable', 'activate', 'restore-default'].includes(request.command)
        || Object.keys(request).some(key => !['v', 'id', 'command', ...(request.command === 'inventory' ? [] : ['pluginId'])].includes(key))) {
        return Promise.resolve({ ok: false, error: 'invalid-command' })
      }
      if (request.command !== 'inventory' && (typeof request.pluginId !== 'string' || !PLUGIN_ID.test(request.pluginId))) {
        return Promise.resolve({ ok: false, error: 'unknown-plugin' })
      }
      if (closed || signal.aborted) return Promise.resolve({ ok: false, error: 'runtime-stopped' })
      const implementationChange = ['activate', 'restore-default'].includes(request.command)
      if (implementationChange && (activating || (request.command === 'activate' && typeof prepareActivation !== 'function'))) {
        return Promise.resolve({ ok: false, error: activating ? 'runtime-busy' : 'runtime-unavailable' })
      }
      if (pending.size >= 32) return Promise.resolve({ ok: false, error: 'runtime-busy' })
      let selected
      let mainFrame
      try {
        const available = frames()
        if (available.length !== 1) return Promise.resolve({ ok: false, error: available.length ? 'inventory-unavailable' : 'runtime-unavailable' })
        selected = available[0]
        mainFrame = selected.mainFrame()
        if (!mainFrame) throw Error('missing frame')
      } catch { return Promise.resolve({ ok: false, error: 'runtime-unavailable' }) }
      let resolveResult
      const result = new Promise(resolve => { resolveResult = resolve })
      const resolve = resolveResult
      const lifetime = new AbortController()
      const requestId = randomUUID()
      const command = { command: request.command, ...(request.pluginId ? { pluginId: request.pluginId } : {}) }
      const timer = setTimeout(() => finish(requestId, failure(command, 'renderer-timeout')), timeoutMs ?? (request.command === 'inventory' ? 500 : 25000))
      const operation = { requestId, frame: selected, mainFrame, command, resolve, timer, lifetime,
        preparing: request.command === 'activate', dispatched: false, settled: false }
      pending.set(requestId, operation)
      if (implementationChange) activating = operation
      const send = () => {
        if (!pending.has(requestId) || lifetime.signal.aborted) return
        try {
          if (selected.mainFrame() !== mainFrame) throw Error('navigated frame')
          operation.dispatched = true
          selected.send('odk-renderer-control-request', { requestId, ...command })
        } catch {
          finish(requestId, failure(command, 'renderer-send-failed'))
          releaseImplementation(operation)
        }
      }
      if (request.command !== 'activate') {
        send()
      }
      else {
        void Promise.resolve().then(async () => {
          const capture = await prepareActivation(request.pluginId, { signal: lifetime.signal })
          if (lifetime.signal.aborted || !pending.has(requestId)) return
          if (!capture || !/^[a-f0-9]{64}$/.test(capture.revision) || typeof capture.version !== 'string' || !capture.version
            || !/^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.js$/.test(capture.entryUrl)) throw Error('invalid capture')
          Object.assign(command, { revision: capture.revision, version: capture.version, entryUrl: capture.entryUrl })
          send()
          await result
        }).catch(() => finish(requestId, { ok: false, error: 'activation-failed' }))
          .finally(() => { operation.preparing = false; releaseImplementation(operation) })
      }
      return result
    },
    close() {
      closed = true
      cancel()
      activating = null
      signal.removeEventListener('abort', cancel)
      ipc.removeListener('odk-renderer-control-report', report)
    },
  }
}

function createRendererControlPlugin() {
  return {
    manifest: { schemaVersion: 1, id: ID, name: 'Renderer runtime control', version: '1.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['system.renderer-control'] },
    create(ctx) {
      const config = ctx.capability('system.renderer-control')
      const control = createRendererManagement({ ...config, signal: ctx.signal })
      let server
      ctx.onCleanup(async () => {
        control.close()
        if (server) { await server.close(); server = null }
      })
      return { async start() {
        if (ctx.signal.aborted) return
        if (config.smokeMode || !config.endpoint) throw Error('renderer control channel unavailable')
        server = await listenDeskData({ ...config, requestTimeoutMs: 30000, control })
      } }
    },
  }
}

module.exports = { createRendererManagement, createRendererControlPlugin }
