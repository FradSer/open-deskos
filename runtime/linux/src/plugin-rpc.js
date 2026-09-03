function createPluginRpcRouter({ manifests = new Map() } = {}) {
  const handlers = new Map()

  function registerHandler(pluginId, action, handler, requiredPermission = null) {
    if (!pluginId || !action || typeof handler !== 'function') {
      throw new Error('invalid RPC handler registration')
    }
    handlers.set(`${pluginId}:${action}`, { handler, requiredPermission })
  }

  async function dispatch({ pluginId, action, payload } = {}) {
    if (!pluginId || !action) {
      throw new Error('invalid-rpc-request')
    }

    const key = `${pluginId}:${action}`
    const registration = handlers.get(key)
    if (!registration) {
      if (!manifests.has(pluginId)) {
        throw new Error(`unknown-plugin: ${pluginId}`)
      }
      throw new Error(`unhandled-action: ${action}`)
    }

    const { handler, requiredPermission } = registration
    if (requiredPermission) {
      const manifest = manifests.get(pluginId)
      if (!manifest) {
        throw new Error(`unknown-plugin: ${pluginId}`)
      }
      const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
      if (!permissions.includes(requiredPermission)) {
        throw new Error(`permission-denied: requires ${requiredPermission}`)
      }
    }

    return handler(payload)
  }

  return {
    registerHandler,
    dispatch,
  }
}

module.exports = {
  createPluginRpcRouter,
}
