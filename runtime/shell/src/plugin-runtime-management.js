'use strict'

const { requestLocalControl } = require('./local-control-client')

const RUNTIMES = Object.freeze([
  { scope: 'electron-main', endpoint: 'plugin-control' },
  { scope: 'electron-renderer', endpoint: 'renderer-plugin-control' },
  { scope: 'remote-bridge', endpoint: 'remote-plugin-control' },
  { scope: 'personal-agent', endpoint: 'personal-agent-control' },
  { scope: 'personal-agent', endpoint: 'hosted-pi-control' },
  { scope: 'python-agent', endpoint: 'futu-plugin-control' },
])

async function resolveRuntimeManagement(host, pluginId, request = requestLocalControl) {
  const results = await Promise.allSettled(RUNTIMES.map(async runtime => {
    const response = await request({ endpoint: host.endpoint(runtime.endpoint), tokenFile: host.localChannelTokenFile,
      platform: host.platform, label: 'plugin management inventory', request: { command: 'inventory' } })
    const ids = new Set()
    if (response.scope !== runtime.scope || !Array.isArray(response.plugins) || !response.plugins.length || response.plugins.length > 128) {
      throw Error('invalid management inventory')
    }
    for (const plugin of response.plugins) {
      if (!plugin || Object.keys(plugin).some(key => !['pluginId', 'host'].includes(key))
        || plugin.host !== runtime.scope || typeof plugin.pluginId !== 'string' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(plugin.pluginId)
        || ids.has(plugin.pluginId)) throw Error('invalid management inventory')
      ids.add(plugin.pluginId)
    }
    return { ...runtime, ids }
  }))
  if (results.some(result => result.status === 'rejected' && /invalid .*inventory|inventory response too large|inventory-unavailable|runtime-busy/.test(result.reason.message))) {
    throw Error('invalid management inventory; mutation refused')
  }
  const available = results.filter(result => result.status === 'fulfilled').map(result => result.value)
  const owners = available.filter(runtime => runtime.ids.has(pluginId))
  if (owners.length > 1) throw Error('ambiguous plugin runtime; mutation refused')
  if (!owners.length) throw Error(available.length ? 'unknown-plugin or runtime-unavailable' : 'runtime-unavailable')
  return { scope: owners[0].scope, endpoint: host.endpoint(owners[0].endpoint) }
}

module.exports = { resolveRuntimeManagement, RUNTIMES }
