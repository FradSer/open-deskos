;
(function (root) {
  'use strict'

  const EMPTY_STATE = '未打开 App'

  function createAppPlatform({ host }) {
    const events = []
    const state = { active: null, appStates: new Map() }
    const listeners = new Set()
    const stateListeners = new Set()

    const publish = () => {
      const snapshot = state.active ? { ...state.active } : { label: EMPTY_STATE, state: 'idle' }
      for (const listener of listeners) listener(snapshot)
    }

    const publishAppState = (appId) => {
      const appState = state.appStates.get(appId) || 'installed'
      for (const listener of stateListeners) listener(appId, appState)
    }

    const record = (layer, action, appId) => {
      events.push({ layer, action, appId })
    }

    const findApp = (appId) => root.odkPlugins.byKind('app').find((candidate) =>
      (candidate.appId || candidate.id) === appId)

    const catalog = () => root.odkPlugins.byKind('app').map((plugin) => {
      const appId = plugin.appId || plugin.id
      return {
        appId,
        name: plugin.app || plugin.name || appId,
        version: plugin.version || 'builtin',
        kind: plugin.appKind || 'ui',
        source: plugin.source || 'builtin',
        capabilities: plugin.capabilities || [],
        state: state.appStates.get(appId) || 'installed',
      }
    })

    const installer = {
      ensureInstalled(appId) {
        record('installer', 'ensure-installed', appId)
        return findApp(appId) || null
      },
      prepareAction(intent) {
        record('installer', 'prepare-action', intent.appId)
        return findApp(intent.appId) || null
      },
    }

    let runtimePlugin = null
    let runtimeCleanup = null
    const runtime = {
      start(plugin, appContext) {
        const appId = plugin.appId || plugin.id
        record('app-runtime', 'start', appId)
        const cleanups = []
        const scopedContext = {
          ...appContext,
          onTick(callback) {
            const unsubscribe = appContext.onTick(callback)
            cleanups.push(unsubscribe)
            return unsubscribe
          },
        }
        runtimeCleanup = () => {
          for (const unsubscribe of cleanups.splice(0)) unsubscribe()
        }
        const rootElement = host.runtimeRoot()
        rootElement.replaceChildren()
        root.odkPlugins.activate(plugin, rootElement, scopedContext)
        runtimePlugin = plugin
      },
      dispatchAction(intent) {
        if (!runtimePlugin?.handleAction) return true
        record('app-runtime', 'action', intent.appId)
        return runtimePlugin.handleAction(intent, {
          ...host.context(),
          runtimeRoot: host.runtimeRoot,
        }) !== false
      },
      stop() {
        if (!runtimePlugin) return
        const appId = runtimePlugin.appId || runtimePlugin.id
        record('app-runtime', 'stop', appId)
        root.odkPlugins.deactivate(runtimePlugin, host.runtimeRoot(), host.context())
        runtimeCleanup?.()
        runtimeCleanup = null
        runtimePlugin = null
      },
    }

    const manager = {
      start(plugin, source) {
        const appId = plugin.appId || plugin.id
        if (state.active?.appId === appId) return
        record('app-manager', 'start', appId)
        state.active = {
          appId,
          label: plugin.app || plugin.name || appId,
          state: 'running',
          sourceWidget: source?.widgetId || null,
          route: source?.route || null,
        }
        state.appStates.set(appId, '运行中')
        publish()
        publishAppState(appId)
      },
      dispatchAction(intent) {
        record('app-manager', 'action', intent.appId)
        return true
      },
      stop() {
        if (!state.active) return
        const appId = state.active.appId
        record('app-manager', 'stop', appId)
        state.active = null
        state.appStates.set(appId, '已停止')
        publish()
        publishAppState(appId)
      },
    }

    function stopForeground() {
      if (!state.active) return
      runtime.stop()
      manager.stop()
      host.closeAppFrame()
    }

    const platform = {
      events,
      catalog,
      subscribe(listener) {
        listeners.add(listener)
        publish()
        return () => listeners.delete(listener)
      },
      subscribeAppState(listener) {
        stateListeners.add(listener)
        for (const plugin of root.odkPlugins.byKind('app')) {
          const appId = plugin.appId || plugin.id
          listener(appId, state.appStates.get(appId) || 'installed')
        }
        return () => stateListeners.delete(listener)
      },
      stateFor: (appId) => state.appStates.get(appId) || 'installed',
      setState(appId, appState) {
        state.appStates.set(appId, appState)
        if (state.active?.appId === appId) state.active.state = appState === '运行中' ? 'running' : 'paused'
        publish()
        publishAppState(appId)
      },
      active: () => state.active ? { ...state.active } : null,
      openApp({ appId, widgetId = null, route = null }) {
        if (state.active?.appId === appId) return true
        if (state.active) stopForeground()
        const plugin = installer.ensureInstalled(appId)
        if (!plugin) {
          host.openMissingApp(appId)
          return false
        }
        const source = { widgetId, route }
        manager.start(plugin, source)
        host.openAppFrame({ plugin, source })
        runtime.start(plugin, {
          ...host.context(),
          appId: plugin.appId || plugin.id,
          route,
          sourceWidget: widgetId,
          platform,
        })
        return true
      },
      emitIntent(intent) {
        if (!intent) return false
        if (intent.type === 'open-app') return platform.openApp(intent)
        if (intent.type !== 'action') return false
        const plugin = installer.prepareAction(intent)
        if (!plugin || state.active?.appId !== intent.appId) return false
        manager.dispatchAction(intent)
        return runtime.dispatchAction(intent)
      },
      closeApp: stopForeground,
    }

    return platform
  }

  root.odkAppPlatform = { create: createAppPlatform }
})(typeof window !== 'undefined' ? window : globalThis)
