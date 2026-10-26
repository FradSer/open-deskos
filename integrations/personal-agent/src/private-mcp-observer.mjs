import { openMcpSession } from './agent-catalog/mcp.mjs'
import { validateMcpManifest } from './agent-catalog/catalog.mjs'

export const PRIVATE_SOURCE_PROVENANCE = Object.freeze({ ownerOnly: true, privateData: true, untrusted: true, learningEligible: false })
const unavailable = () => Error('Private source is unavailable or changed.')

async function wait(operation, signal) {
  signal.throwIfAborted()
  let cancel
  try {
    const aborted = new Promise((_, reject) => { cancel = () => reject(unavailable()); signal.addEventListener('abort', cancel, { once: true }) })
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }), aborted])
  } finally { if (cancel) signal.removeEventListener('abort', cancel) }
}

/** An owner-selected background source owns its session, never an interactive turn.
 * Tool names come from reviewed host code, not from MCP descriptions or annotations.
 */
export function createPrivateMcpObserver({ catalog, connectorId, readOnlyTools, env = process.env, openSession = openMcpSession, timeoutMs = 20000, onPrivateData = (_provenance) => {} }) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(connectorId) || !Array.isArray(readOnlyTools) || !readOnlyTools.length
      || readOnlyTools.length > 8 || new Set(readOnlyTools).size !== readOnlyTools.length
      || !readOnlyTools.every(name => /^[A-Za-z0-9_.-]{1,128}$/.test(name))
      || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw unavailable()
  const permitted = new Set(readOnlyTools)
  const lifetime = new AbortController()
  let enabled = true, epoch = 0, connection, active, closing

  async function selected() {
    const item = await catalog.package(connectorId)
    const snapshot = validateMcpManifest(item.snapshot)
    if (snapshot.id !== connectorId || snapshot.policy?.ownerOnly !== true || snapshot.policy?.privateData !== true
        || !/^[a-f0-9]{64}$/.test(item.revision)) throw unavailable()
    return { snapshot, connectorRevision: item.revision }
  }
  async function discard(abortActive = true) {
    epoch++
    if (abortActive) active?.abort()
    const previous = connection
    connection = undefined
    if (previous) {
      previous.controller.abort()
      // A late open is closed by its continuation. Do not await an opening
      // provider that has not yet honored cancellation.
      if (previous.session) await previous.session.close()
    }
  }
  async function check(expected, signal = undefined) {
    signal?.throwIfAborted()
    if (!enabled || lifetime.signal.aborted || expected.epoch !== epoch) throw unavailable()
    let current
    try { current = signal ? await wait(selected, signal) : await selected() }
    catch { await discard(); throw unavailable() }
    if (expected.connectorRevision !== current.connectorRevision) { await discard(); throw unavailable() }
    signal?.throwIfAborted()
  }
  return {
    get enabled() { return enabled && !lifetime.signal.aborted },
    get epoch() { return epoch },
    async isCurrent(snapshot, { signal = undefined } = {}) {
      try { await check(snapshot, AbortSignal.any([lifetime.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)])); return true } catch { return false }
    },
    async run(operation, { signal = undefined } = {}) {
      if (!enabled || lifetime.signal.aborted || active || typeof operation !== 'function') throw unavailable()
      const owner = new AbortController()
      active = owner
      const combined = AbortSignal.any([owner.signal, lifetime.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs * 4)])
      try {
        combined.throwIfAborted()
        const current = await wait(selected, combined)
        combined.throwIfAborted()
        if (connection?.connectorRevision !== current.connectorRevision) await discard(false)
        combined.throwIfAborted()
        const snapshot = { connectorRevision: current.connectorRevision, epoch }
        onPrivateData(PRIVATE_SOURCE_PROVENANCE)
        if (!connection) {
          const controller = new AbortController()
          const entry = { ...snapshot, controller, promise: undefined, session: undefined }
          entry.promise = Promise.resolve().then(() => openSession(current.snapshot, { env, timeoutMs, signal: AbortSignal.any([controller.signal, lifetime.signal]) })).then(async session => {
            entry.session = session
            if (controller.signal.aborted || connection !== entry) await session.close()
            return session
          })
          entry.promise.catch(() => {})
          connection = entry
        }
        const owned = connection
        const session = await wait(() => owned.promise, combined)
        await check(snapshot, combined)
        if (connection !== owned || session.closed) throw unavailable()
        const definitions = await wait(() => session.tools(combined), combined)
        await check(snapshot, combined)
        const call = async (name, args = {}) => {
          if (!permitted.has(name)) throw unavailable()
          const declared = definitions.find(tool => tool.name === name)
          if (!declared || declared.annotations?.readOnlyHint !== true || declared.annotations?.destructiveHint !== false) throw unavailable()
          await check(snapshot, combined)
          const value = await wait(() => session.call(name, args, combined), combined)
          await check(snapshot, combined)
          return value
        }
        const schema = name => permitted.has(name) ? structuredClone(definitions.find(tool => tool.name === name)?.inputSchema) : undefined
        const value = await wait(() => operation({ ...snapshot, provenance: PRIVATE_SOURCE_PROVENANCE, schema, call, signal: combined }), combined)
        await check(snapshot, combined)
        return { value, ...snapshot, provenance: PRIVATE_SOURCE_PROVENANCE }
      } catch {
        // A failed connection or read is unavailable, never a cached live observation.
        await discard().catch(() => {})
        throw unavailable()
      } finally {
        if (active === owner) active = undefined
      }
    },
    async invalidate() { await discard() },
    async setEnabled(value) {
      if (typeof value !== 'boolean' || lifetime.signal.aborted) throw unavailable()
      if (enabled !== value) { enabled = value; await discard() }
    },
    close() {
      if (!closing) { enabled = false; lifetime.abort(); closing = discard() }
      return closing
    },
  }
}
