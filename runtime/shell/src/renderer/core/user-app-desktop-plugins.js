;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../plugin-host'))
  else root.odkUserAppDesktopPlugins = factory(root.odkPluginHost, root.odkUserAppDesktop.mount)
})(typeof window !== 'undefined' ? window : globalThis, function (hostApi, defaultMount) {
  'use strict'

  const PORT = 'odk:system/user-app-desktop/v1'
  const manifest = Object.freeze({
    schemaVersion: 1, id: 'odk.system.user-app-desktop', name: 'Installed desktop composition',
    version: '1.0.0', kind: 'system', host: 'electron-renderer',
    provides: Object.freeze([Object.freeze({ interface: PORT })]),
    requires: Object.freeze([]), permissions: Object.freeze([]),
  })
  function validate(raw) {
    const declared = hostApi.validatePluginManifest(raw)
    const fields = ['schemaVersion', '$schema', 'id', 'name', 'version', 'kind', 'host', 'provides', 'requires', 'permissions', 'entry']
    if (declared.id !== manifest.id || declared.kind !== manifest.kind || declared.host !== manifest.host
      || JSON.stringify(declared.provides) !== JSON.stringify(manifest.provides)
      || declared.requires.length || declared.permissions.length || Object.keys(declared).some(key => !fields.includes(key))) {
      throw Error('installed desktop replacement changes its public contract')
    }
    return declared
  }

  function create({ replacements = [] } = {}) {
    if (!Array.isArray(replacements) || replacements.length > 1) throw Error('invalid installed desktop replacements')
    const selected = replacements[0] || { manifest, create: () => ({ ports: { [PORT]: { mount: defaultMount } } }) }
    const declared = validate(selected.manifest)
    const factory = selected.create
    if (typeof factory !== 'function') {
      throw Error('installed desktop replacement changes its public contract')
    }
    const host = hostApi.createPluginHost()
    let closing = false
    host.register({ manifest: declared, async create(context) {
      const instance = await factory(context)
      if (!instance || typeof instance !== 'object') throw Error('installed desktop requires a factory instance')
      const port = instance?.ports?.[PORT]
      const controllers = new Set()
      const pendingMounts = new Set()
      async function release() {
        await Promise.all([...pendingMounts])
        const results = await Promise.allSettled([...controllers].map(async controller => {
          await controller.dispose()
          controllers.delete(controller)
        }))
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
        if (failures.length) throw new AggregateError(failures, 'installed desktop cleanup failed')
      }
      context.onCleanup(release)
      return {
        ports: { [PORT]: { mount(options) {
          if (closing || context.signal.aborted || typeof port?.mount !== 'function') throw Error('installed desktop is not running')
          const controller = port.mount(options)
          // Rejected interfaces can already own resources that require release.
          if (typeof controller?.dispose === 'function') controllers.add(controller)
          if (controller && typeof controller.then === 'function') {
            // Keep the synchronous contract while owning rejected asynchronous work.
            const pending = Promise.resolve(controller).then(result => {
              if (typeof result?.dispose === 'function') controllers.add(result)
            }, () => {})
            pendingMounts.add(pending)
            pending.then(() => { pendingMounts.delete(pending) })
            throw Error('installed desktop requires refresh and dispose synchronously')
          }
          if (!controller || typeof controller.refresh !== 'function' || typeof controller.dispose !== 'function') {
            throw Error('installed desktop requires refresh and dispose')
          }
          return controller
        } } },
        async start() {
          if (typeof port?.mount !== 'function') throw Error('installed desktop requires a mount port')
          await instance.start?.()
        },
        async stop() { await release(); await instance.stop?.() },
        destroy: () => instance.destroy?.(),
      }
    } })
    return {
      async start() {
        await host.start()
        if (host.list()[0].state !== 'running') throw Error('installed desktop startup failed')
        closing = false
      },
      mount(options) {
        const port = host.get(PORT)
        if (closing || !port) throw Error('installed desktop is not running')
        return port.mount(options)
      },
      async stop() {
        closing = true
        await host.stop()
        if (['cleanup-failed', 'cleanup-blocked'].includes(host.list()[0].state)) throw Error('installed desktop retains cleanup ownership')
      },
      catalog: () => host.list(),
    }
  }

  return { PORT, manifest, validate, create }
})
