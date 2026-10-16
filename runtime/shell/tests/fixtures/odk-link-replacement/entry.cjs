'use strict'

exports.create = context => {
  const capability = context.capability('source.odk-link')
  const transport = capability.createTransport(capability.options)
  const controller = new AbortController()
  const pending = new Set()
  const abort = () => controller.abort()
  if (context.signal.aborted) abort()
  else context.signal.addEventListener('abort', abort, { once: true })
  const ask = (record, requestSignal) => {
    const signal = requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal
    if (signal.aborted) return Promise.resolve(null)
    // Register the request before a transport callback can reenter shutdown.
    let resolve
    let reject
    const operation = new Promise((yes, no) => { resolve = yes; reject = no })
      .then(value => signal.aborted ? null : value, error => {
        if (signal.aborted) return null
        throw error
      })
    pending.add(operation)
    void operation.then(() => pending.delete(operation), () => pending.delete(operation))
    try { resolve(transport.request(record, { signal })) } catch (error) { reject(error) }
    return operation
  }
  const empty = reason => ({ ok: false, reason, scannedAt: null, summary: null, sessions: [], workspaces: [] })
  const response = (record, signal) => controller.signal.aborted || signal?.aborted ? null : record
  const source = {
    socketPath: transport.socketPath,
    fixtureRevision: '2.0.0',
    async stop() {
      abort()
      context.signal.removeEventListener('abort', abort)
      await Promise.allSettled([...pending])
    },
    async snapshot({ signal } = {}) {
      if (!source.socketPath) return empty('odk-link-unconfigured')
      const record = response(await ask({ v: 1, type: 'snapshot' }, signal), signal)
      return record?.ok === true && Array.isArray(record.sessions) ? record
        : empty(typeof record?.reason === 'string' && record.reason ? record.reason : 'odk-link-unavailable')
    },
    async hostedSessions({ signal } = {}) {
      if (!source.socketPath) return { ok: false, reason: 'odk-link-unconfigured', sessions: [], scannedAt: null }
      const record = response(await ask({ v: 1, type: 'hosted-sessions' }, signal), signal)
      return record?.ok === true && Array.isArray(record.sessions)
        ? { ok: true, sessions: record.sessions, scannedAt: record.scannedAt }
        : { ok: false, reason: record?.reason || 'pi host unavailable', sessions: [], scannedAt: record?.scannedAt ?? null }
    },
    async machines({ signal } = {}) {
      if (!source.socketPath) return []
      const record = response(await ask({ v: 1, type: 'machines' }, signal), signal)
      return Array.isArray(record?.machines) ? record.machines : []
    },
    async sessionEvents(sessionId, { signal, hostedPi } = {}) {
      if (!source.socketPath || typeof sessionId !== 'string' || !sessionId) return { ok: false, reason: 'odk-link-unconfigured' }
      const record = response(await ask({ v: 1, type: 'events', sessionId, ...(hostedPi === true ? { hostedPi: true } : {}) }, signal), signal)
      if (!record || typeof record !== 'object') return { ok: false, reason: 'odk-link-unavailable' }
      return record.ok === true ? { ok: true, events: record.events ?? [], truncated: record.truncated === true }
        : { ok: false, reason: record.reason ?? 'odk-link-unavailable' }
    },
  }
  context.onCleanup(() => source.stop())
  return { ports: { 'odk:source/link/v1': source } }
}
