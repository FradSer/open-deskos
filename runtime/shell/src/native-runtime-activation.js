'use strict'

const { readConfig, resolveConfigPath } = require('./plugin-config')
const { loadNativePlugins } = require('./native-plugin-loader')

function createNativeRuntimeActivator({ host, env = process.env, configPath = resolveConfigPath(env), load = loadNativePlugins, defaults = [] }) {
  const builtins = new Map(defaults.map(definition => [definition.manifest.id, {
    manifest: structuredClone(definition.manifest), create: definition.create,
  }]))
  let pending = Promise.resolve()
  return (id, { signal, restoreDefault = false } = {}) => {
    const requireAvailable = (completed = false) => {
      if (signal?.aborted) throw Error('native activation cancelled')
      const current = host.list().find(plugin => plugin.manifest.id === id)
      const states = restoreDefault && !completed ? ['running', 'failed', 'cleanup-failed', 'cleanup-blocked', 'blocked'] : ['running']
      if (!current || current.manifest.host !== 'electron-main' || !current.enabled || !states.includes(current.state)
        || (env.ODESK_DISABLED_PLUGINS || '').split(/[\s,]+/).includes(id)) throw Error('native activation requires a running Main plugin')
    }
    const result = pending.then(async () => {
      requireAvailable()
      let definition
      let revision
      if (restoreDefault) {
        definition = builtins.get(id)
        if (!definition) throw Error('plugin has no built-in default')
      } else {
        const config = readConfig(configPath)
        const preference = config.plugins[id]
        if (!preference?.native || preference.native.host !== 'electron-main' || preference.enabled === false) {
          throw Error('native activation requires an enabled signed Main selection')
        }
        // Use startup's capture and authorization path, with no error suppression.
        // The request supplies only an identity; policy and selection stay host-owned.
        const selections = await load({ version: config.version, plugins: { [id]: preference } }, {
          env, existingPlugins: host.list().filter(plugin => plugin.manifest.id !== id),
        })
        definition = selections[0]
        revision = preference.native.revision
      }
      requireAvailable()
      if (!definition || definition.manifest.id !== id) throw Error('native activation selection unavailable')
      await host.replace(definition, { recompose: restoreDefault })
      requireAvailable(true)
      const selected = host.definition(id)
      if (selected.create !== definition.create || selected.manifest.version !== definition.manifest.version) {
        throw Error('native activation selection changed')
      }
      return { ...(restoreDefault ? { implementation: 'built-in' } : { revision }), version: selected.manifest.version, state: 'running' }
    })
    pending = result.catch(() => {})
    return result
  }
}

module.exports = { createNativeRuntimeActivator }
