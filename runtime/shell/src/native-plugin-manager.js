'use strict'

const { isDeepStrictEqual } = require('node:util')
const { readConfig, updateConfig } = require('./plugin-config')

function checkGrants(manifest, grants) {
  if (!Array.isArray(grants) || new Set(grants).size !== grants.length
    || grants.length !== manifest.permissions.length || manifest.permissions.some(name => !grants.includes(name))) throw Error('native selection requires exact capability grants')
}

function sameContract(a, b) {
  return ['id', 'host', 'kind', 'provides', 'requires', 'surfaceKind', 'surface', 'minCell', 'interaction', 'slot', 'appId', 'appKind']
    .every(key => isDeepStrictEqual(a[key], b[key]))
}

function withoutHistory(selection) {
  const { previous, ...current } = selection
  return structuredClone(current)
}

function createNativePluginManager({ store, configPath }) {
  function selected(id) {
    if (typeof id !== 'string' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw Error('invalid native plugin identity')
    const selection = readConfig(configPath).plugins[id]?.native
    if (!selection) throw Error('native plugin is not selected')
    return selection
  }
  async function verify(id, selection) {
    const plugin = await store.read(selection.revision)
    if (plugin.manifest.id !== id || plugin.manifest.host !== selection.host || plugin.replacement !== selection.replace) throw Error('native selection identity changed')
    checkGrants(plugin.manifest, selection.grants)
    return plugin
  }
  async function candidate(source, authorization) {
    if (authorization?.trust !== true) throw Error('native selection requires explicit trust')
    const bundle = await store.stage(source)
    checkGrants(bundle.manifest, authorization.grants)
    return { bundle, selection: { revision: bundle.revision, host: bundle.manifest.host, replace: bundle.replacement,
      grants: [...authorization.grants], trustAcknowledgedAt: new Date().toISOString() } }
  }
  function commit(id, expected, selection) {
    updateConfig(configPath, config => {
      const entry = config.plugins[id] || {}
      if (entry.development) throw Error('native plugin ownership conflicts with a development link')
      if (!isDeepStrictEqual(entry.native, expected)) throw Error('native selection changed; retry after inspection')
      if (selection) entry.native = selection
      else delete entry.native
      config.plugins[id] = entry
    })
    return selection ? structuredClone(selection) : { removed: id }
  }
  return {
    async inspect(id) {
      const selection = selected(id)
      const plugin = await verify(id, selection)
      return { ...plugin, selection: structuredClone(selection) }
    },
    async install(source, authorization) {
      const { bundle, selection } = await candidate(source, authorization)
      const id = bundle.manifest.id
      if (readConfig(configPath).plugins[id]?.native) throw Error('native plugin ownership already exists; use update')
      return commit(id, undefined, selection)
    },
    async update(id, source, authorization) {
      const previous = selected(id)
      const current = await verify(id, previous)
      const { bundle, selection } = await candidate(source, authorization)
      if (!sameContract(current.manifest, bundle.manifest) || bundle.replacement !== current.replacement) throw Error('native update changes public contract')
      if (selection.revision === previous.revision) return commit(id, previous, previous)
      return commit(id, previous, { ...selection, previous: withoutHistory(previous) })
    },
    async rollback(id) {
      const current = selected(id)
      if (!current.previous) throw Error('native rollback has no previous revision')
      const [active, prior] = await Promise.all([verify(id, current), verify(id, current.previous)])
      if (!sameContract(active.manifest, prior.manifest) || active.replacement !== prior.replacement) throw Error('native rollback changes public contract')
      return commit(id, current, { ...current.previous, previous: withoutHistory(current) })
    },
    async remove(id) {
      return commit(id, selected(id), null)
    },
  }
}

module.exports = { createNativePluginManager }
