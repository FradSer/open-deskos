;(function (root) {
  'use strict'

  const KINDS = new Set(['surface', 'application', 'service', 'transport', 'device-driver', 'processor', 'protocol', 'integration', 'system'])
  const HOSTS = new Set(['electron-main', 'electron-renderer', 'remote-bridge', 'esp32-s3', 'esp32-p4', 'python-agent', 'personal-agent'])
  const PORT = /^odk:[a-z][a-z0-9./-]*\/v[1-9][0-9]*$/

  function validatePluginManifest(raw) {
    if (raw?.schemaVersion !== 1) throw Error('plugin requires schema version 1')
    if (typeof raw.id !== 'string' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(raw.id)) throw Error('plugin requires an Open DeskOS identity')
    if (!KINDS.has(raw.kind) || !HOSTS.has(raw.host)) throw Error('plugin requires a supported kind and host')
    if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version)) throw Error('plugin requires a name and version')
    const manifest = structuredClone(raw)
    for (const field of ['provides', 'requires']) {
      manifest[field] ??= []
      if (!Array.isArray(manifest[field])) throw Error(`invalid plugin ${field}`)
      const seen = new Set()
      for (const port of manifest[field]) {
        if (!port || !PORT.test(port.interface) || seen.has(port.interface)
          || Object.keys(port).some(key => !['interface', 'optional'].includes(key))
          || (port.optional !== undefined && (field === 'provides' || typeof port.optional !== 'boolean'))) throw Error(`invalid plugin ${field}`)
        seen.add(port.interface)
      }
    }
    manifest.permissions ??= []
    if (!Array.isArray(manifest.permissions) || new Set(manifest.permissions).size !== manifest.permissions.length
      || manifest.permissions.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(name))) throw Error('invalid plugin permissions')
    return manifest
  }

  function declaration(definition) {
    const manifest = validatePluginManifest(definition?.manifest)
    if (typeof definition.create !== 'function') throw Error('plugin requires a factory')
    return manifest
  }

  // Factories are trusted, locally supplied implementations. Capability injection
  // narrows their contracts; it does not sandbox native modules or authorize loading
  // third-party code. Port versions are explicit URI components, compared exactly.
  function createPluginHost({ capabilities = {}, disabled = [], onError = () => {} } = {}) {
    const records = new Map()
    const ports = new Map()
    const disabledIds = new Set(disabled)
    const requestedDisabledIds = new Set(disabled)
    let order = []
    let pending = Promise.resolve()
    let running = false
    let locked = false
    let generation = 0

    const serial = operation => {
      const result = pending.then(operation)
      pending = result.catch(() => {})
      return result
    }
    const report = (record, error) => {
      record.error = error.message || String(error)
      try { onError(record.manifest.id, error) } catch { /* Diagnostics cannot prevent cleanup. */ }
    }
    const list = () => [...records.values()].map(record => ({
      manifest: structuredClone(record.manifest),
      state: record.state,
      enabled: !disabledIds.has(record.manifest.id),
      ...(record.error ? { error: record.error } : {}),
    }))

    function compile() {
      const providers = new Map()
      for (const record of records.values()) {
        for (const port of record.manifest.provides) {
          if (providers.has(port.interface)) throw Error(`duplicate port ${port.interface}`)
          providers.set(port.interface, record)
        }
      }
      const sorted = []
      const visiting = new Set()
      const visited = new Set()
      function visit(record) {
        if (visited.has(record)) return
        if (visiting.has(record)) throw Error(`dependency cycle at ${record.manifest.id}`)
        visiting.add(record)
        for (const port of record.manifest.requires) {
          const provider = providers.get(port.interface)
          if (!provider && !port.optional) throw Error(`missing required port ${port.interface}`)
          if (provider) visit(provider)
        }
        visiting.delete(record)
        visited.add(record)
        sorted.push(record)
      }
      for (const record of records.values()) visit(record)
      return sorted
    }

    const owns = record => record.instance !== null || (record.cleanups?.size || 0) > 0

    async function release(record) {
      for (const port of record.manifest.provides) ports.delete(port.interface)
      record.controller?.abort()
      if (!owns(record)) {
        record.controller = null
        record.provided = null
        return
      }
      const provided = new Set(record.manifest.provides.map(port => port.interface))
      const retainedConsumer = [...records.values()].find(consumer => consumer !== record && owns(consumer)
        && consumer.manifest.requires.some(port => provided.has(port.interface)))
      if (retainedConsumer) {
        record.state = 'cleanup-blocked'
        report(record, Error(`resources retained by ${retainedConsumer.manifest.id}`))
        return
      }
      record.releasing = true
      try {
        for (const phase of ['stop', 'destroy']) {
          if (record.completed.has(phase)) continue
          try {
            await record.instance?.[phase]?.()
            record.completed.add(phase)
          } catch (error) {
            record.state = 'cleanup-failed'
            report(record, error)
            return
          }
        }
        for (const cleanup of [...(record.cleanups || [])].reverse()) {
          try { await cleanup(); record.cleanups.delete(cleanup) } catch (error) {
            record.state = 'cleanup-failed'
            report(record, error)
          }
        }
        if (record.cleanups?.size) return
        record.instance = null
        record.controller = null
        record.provided = null
        if (record.state !== 'failed') record.state = 'stopped'
      } finally {
        record.releasing = false
      }
    }

    function asynchronousState(value) {
      if (value && typeof value.then === 'function') {
        const refuse = () => { throw Error('plugin state handoff must be synchronous') }
        // Invalid work still belongs to the instance until its actual settlement.
        return Promise.resolve(value).then(refuse, refuse)
      }
      return null
    }

    function stateHooks(instance) {
      const hooks = instance?.handoff
      if (!hooks || !PORT.test(hooks.schema) || typeof hooks.capture !== 'function' || typeof hooks.restore !== 'function') {
        throw Error('invalid plugin state handoff')
      }
      return hooks
    }

    async function activate(record, epoch) {
      if (record.state === 'running') return
      if (owns(record)) return
      record.error = null
      if (disabledIds.has(record.manifest.id) || requestedDisabledIds.has(record.manifest.id)) { record.state = 'disabled'; return }
      const missing = record.manifest.requires.find(port => !port.optional && !ports.has(port.interface))
      if (missing) {
        record.state = 'blocked'
        record.error = `unavailable required port ${missing.interface}`
        return
      }
      record.state = 'starting'
      record.controller = new AbortController()
      record.cleanups = new Set()
      record.completed = new Set()
      const controller = record.controller
      const cleanups = record.cleanups
      const grants = new Map()
      const required = new Map(record.manifest.requires.map(port => [port.interface, port]))
      const cancelled = () => epoch !== generation || controller.signal.aborted || disabledIds.has(record.manifest.id) || requestedDisabledIds.has(record.manifest.id)
      try {
        for (const name of record.manifest.permissions) {
          if (!Object.hasOwn(capabilities, name)) throw Error(`missing capability ${name}`)
          grants.set(name, capabilities[name])
        }
        const context = Object.freeze({
          signal: controller.signal,
          get(name) {
            if (!required.has(name)) throw Error(`undeclared port ${name}`)
            if (ports.has(name)) return ports.get(name)
            if (record.releasing && record.controller === controller) {
              const provider = [...records.values()].find(candidate => candidate.manifest.provides.some(port => port.interface === name))
              return provider?.provided?.[name] ?? null
            }
            return null
          },
          capability(name) {
            if (!record.manifest.permissions.includes(name)) throw Error(`undeclared capability ${name}`)
            return grants.get(name)
          },
          onCleanup(cleanup) {
            if (typeof cleanup !== 'function') throw TypeError('cleanup must be a function')
            cleanups.add(cleanup)
            return cleanup
          },
        })
        record.instance = await record.create(context)
        if (cancelled()) { await release(record); return }
        if (!record.instance || typeof record.instance !== 'object' || Array.isArray(record.instance)) throw Error('invalid plugin instance')
        const provided = record.instance.ports || {}
        const declared = new Set(record.manifest.provides.map(port => port.interface))
        if (Object.keys(provided).some(name => !declared.has(name))) throw Error('undeclared provided port')
        for (const name of declared) {
          if (!Object.hasOwn(provided, name) || provided[name] === undefined || provided[name] === null) throw Error(`missing provided port ${name}`)
        }
        record.provided = provided
        if (record.transfer) {
          const hooks = stateHooks(record.instance)
          if (hooks.schema !== record.transfer.schema) throw Error('incompatible plugin state handoff')
          const pendingState = asynchronousState(hooks.restore(structuredClone(record.transfer.state)))
          if (pendingState) await pendingState
        }
        await record.instance.start?.()
        if (cancelled()) { await release(record); return }
        for (const name of declared) ports.set(name, provided[name])
        record.state = 'running'
      } catch (error) {
        record.state = 'failed'
        report(record, error)
        await release(record)
      }
    }

    function affectedBy(id) {
      const affected = new Set([records.get(id)])
      let changed = true
      while (changed) {
        changed = false
        const provided = new Set([...affected].flatMap(record => record.manifest.provides.map(port => port.interface)))
        for (const record of records.values()) {
          if (!affected.has(record) && record.manifest.requires.some(port => provided.has(port.interface))) {
            affected.add(record)
            changed = true
          }
        }
      }
      return affected
    }

    function contract(manifest) {
      return JSON.stringify({
        id: manifest.id, kind: manifest.kind, host: manifest.host,
        provides: manifest.provides.map(port => port.interface).sort(),
        requires: manifest.requires.map(port => [port.interface, Boolean(port.optional)])
          .sort((a, b) => a[0].localeCompare(b[0])),
        permissions: [...manifest.permissions].sort(),
      })
    }

    return {
      register(definition) {
        if (locked) throw Error('cannot register a plugin while the host is running')
        const manifest = declaration(definition)
        if (records.has(manifest.id)) throw Error(`plugin ${manifest.id} already registered`)
        records.set(manifest.id, { manifest, create: definition.create, state: 'registered', instance: null, cleanups: null, controller: null, error: null, transfer: null })
      },
      validate: () => compile().map(record => record.manifest.id),
      list,
      get: name => ports.has(name) ? ports.get(name) : null,
      definition(id) {
        const record = records.get(id)
        if (!record) throw Error(`unknown plugin ${id}`)
        return { manifest: structuredClone(record.manifest), create: record.create }
      },
      replace(definition, { recompose = false, signal } = {}) {
        let manifest
        try { manifest = declaration(definition) } catch (error) { return Promise.reject(error) }
        const create = definition.create
        const epoch = generation
        return serial(async () => {
          signal?.throwIfAborted()
          if (epoch !== generation) throw Error('plugin replacement cancelled by shutdown')
          if (!running) throw Error('plugin replacement requires a running Host')
          const record = records.get(manifest.id)
          if (!record) throw Error(`unknown plugin ${manifest.id}`)
          if (typeof recompose !== 'boolean' || record.manifest.kind !== manifest.kind || record.manifest.host !== manifest.host
            || (!recompose && contract(record.manifest) !== contract(manifest))) throw Error('plugin replacement changes external contract')
          const affected = affectedBy(manifest.id)
          const previousOrder = order
          let candidateOrder = order
          if (recompose) {
            const previousManifest = record.manifest
            record.manifest = manifest
            try {
              candidateOrder = compile()
              for (const consumer of affectedBy(manifest.id)) affected.add(consumer)
            } finally { record.manifest = previousManifest }
          }
          const releaseAffected = async () => {
            for (const entry of affected) entry.controller?.abort()
            for (const entry of [...order].reverse()) if (affected.has(entry)) await release(entry)
            if ([...affected].some(owns)) throw Error('plugin replacement retains resources; retry release before another factory')
            if (epoch !== generation) throw Error('plugin replacement cancelled by shutdown')
          }
          const activateAffected = async () => {
            for (const entry of order) {
              if (epoch !== generation) throw Error('plugin replacement cancelled by shutdown')
              if (affected.has(entry)) await activate(entry, epoch)
            }
            if (epoch !== generation) throw Error('plugin replacement cancelled by shutdown')
          }
          // Capture synchronously in the same turn as cancellation of old admissions.
          // Keep detached recovery state until the whole replacement has settled.
          const captured = new Map()
          for (const entry of affected) {
            if (!entry.transfer && entry.instance?.handoff) {
              const hooks = stateHooks(entry.instance)
              const state = hooks.capture()
              const pendingState = asynchronousState(state)
              if (pendingState) await pendingState
              captured.set(entry, { schema: hooks.schema, state: structuredClone(state) })
            }
          }
          for (const [entry, transfer] of captured) entry.transfer = transfer
          const clearTransfers = () => {
            for (const entry of affected) if (['running', 'disabled'].includes(entry.state)) entry.transfer = null
          }
          await releaseAffected()
          if (signal?.aborted) {
            await activateAffected()
            clearTransfers()
            throw Error('plugin replacement cancelled before candidate startup')
          }
          const previous = { manifest: record.manifest, create: record.create }
          record.manifest = manifest
          record.create = create
          order = candidateOrder
          await activateAffected()
          const failed = [...affected].some(entry => ['failed', 'cleanup-failed', 'cleanup-blocked'].includes(entry.state))
          if (!failed) { clearTransfers(); return list() }
          // Rollback can start only after every candidate consumer and provider releases.
          // A failed release retains the candidate record for explicit recovery.
          await releaseAffected()
          record.manifest = previous.manifest
          record.create = previous.create
          order = previousOrder
          await activateAffected()
          clearTransfers()
          throw Error('plugin replacement failed; previous factory restored where available')
        })
      },
      start() {
        const epoch = generation
        locked = true
        return serial(async () => {
          if (epoch !== generation) return list()
          locked = true
          if (running) return list()
          if ([...records.values()].some(owns)) throw Error('plugin host still owns resources; retry shutdown before startup')
          try { order = compile() } catch (error) { locked = false; throw error }
          for (const record of order) {
            if (epoch !== generation) break
            await activate(record, epoch)
          }
          if (epoch === generation) running = true
          return list()
        })
      },
      stop() {
        generation++
        for (const record of records.values()) record.controller?.abort()
        return serial(async () => {
          for (const record of [...order].reverse()) {
            await release(record)
            record.transfer = null
          }
          running = false
          locked = [...records.values()].some(owns)
          return list()
        })
      },
      setEnabled(id, enabled) {
        if (!records.has(id)) return Promise.reject(Error(`unknown plugin ${id}`))
        if (typeof enabled !== 'boolean') return Promise.reject(TypeError('enabled must be a boolean'))
        const epoch = generation
        const initialAffected = affectedBy(id)
        const changed = enabled === requestedDisabledIds.has(id)
        if (enabled) requestedDisabledIds.delete(id)
        else requestedDisabledIds.add(id)
        if (!enabled && changed) for (const record of initialAffected) record.controller?.abort()
        return serial(async () => {
          const affected = affectedBy(id)
          for (const record of affected) record.transfer = null
          if (enabled === !disabledIds.has(id) && ![...affected].some(record => record.state === 'failed' || (owns(record) && record.state !== 'running'))) return list()
          if (enabled) disabledIds.delete(id)
          else disabledIds.add(id)
          if (!running || epoch !== generation) return list()
          for (const record of [...order].reverse()) if (affected.has(record)) await release(record)
          for (const record of order) {
            if (epoch !== generation) break
            if (affected.has(record)) await activate(record, epoch)
          }
          return list()
        })
      },
    }
  }

  if (typeof module === 'object' && module.exports) module.exports = { createPluginHost, validatePluginManifest }
  else root.odkPluginHost = { createPluginHost, validatePluginManifest }
})(typeof window !== 'undefined' ? window : globalThis)
