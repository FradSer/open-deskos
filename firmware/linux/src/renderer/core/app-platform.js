;
(function (root) {
  'use strict'

  const EMPTY_STATE = '未打开 App'
  const PLATFORM_LAYERS = ['installer', 'app-manager', 'app-runtime']

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

    let endpointQueue = Promise.resolve()
    function dispatchToEndpoint(intent) {
      const request = endpointQueue.then(async () => {
        if (root.odkCompanion?.dispatchIntent) {
          try {
            return await root.odkCompanion.dispatchIntent(intent)
          } catch {
            return { ok: false, error: 'endpoint-unavailable', trace: [] }
          }
        }
        return {
          ok: true,
          trace: PLATFORM_LAYERS.slice(0, 2).map((layer) => ({ layer, action: intent.type, appId: intent.appId })),
        }
      })
      endpointQueue = request.catch(() => ({ ok: false, error: 'endpoint-unavailable', trace: [] }))
      return request
    }

    const installer = {
      ensureInstalled(appId) {
        return findApp(appId) || null
      },
      prepareAction(intent) {
        return findApp(intent.appId) || null
      },
    }

    let runtimePlugin = null
    const runtime = {
      start(plugin, appContext) {
        const appId = plugin.appId || plugin.id
        record('app-runtime', 'start', appId)
        const rootElement = host.runtimeRoot()
        rootElement.replaceChildren()
        try {
          root.odkPlugins.activate(plugin, rootElement, appContext)
          runtimePlugin = plugin
        } catch (error) {
          rootElement.replaceChildren()
          throw error
        }
      },
      async dispatchAction(intent) {
        if (!runtimePlugin) return false
        record('app-runtime', 'action', intent.appId)
        if (!runtimePlugin.handleAction) return true
        try {
          return runtimePlugin.handleAction(intent, {
            ...host.context(),
            runtimeRoot: host.runtimeRoot,
          }) !== false
        } catch {
          return false
        }
      },
      stop() {
        if (!runtimePlugin) return
        const appId = runtimePlugin.appId || runtimePlugin.id
        record('app-runtime', 'stop', appId)
        root.odkPlugins.deactivate(runtimePlugin, host.runtimeRoot(), host.context())
        runtimePlugin = null
      },
    }

    const manager = {
      start(plugin, source) {
        const appId = plugin.appId || plugin.id
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
      stop() {
        if (!state.active) return
        const appId = state.active.appId
        state.active = null
        state.appStates.set(appId, '已停止')
        publish()
        publishAppState(appId)
      },
    }

    function stopLocalForeground() {
      if (!state.active) return
      runtime.stop()
      manager.stop()
      host.closeAppFrame()
    }

    function recordEndpointTrace(trace, skipRuntime = true) {
      for (const event of trace || []) {
        if (skipRuntime && event.layer === 'app-runtime') continue
        record(event.layer, event.action, event.appId)
      }
    }

    async function restoreForeground(previous, reason, retry) {
      if (!previous) {
        host.openRuntimeUnavailable(retry.appId, reason)
        return false
      }
      const endpointResult = await dispatchToEndpoint({ type: 'restore-ui', appId: previous.appId })
      if (!endpointResult.ok) {
        host.openRuntimeUnavailable(retry.appId, reason)
        return false
      }
      const previousPlugin = installer.ensureInstalled(previous.appId)
      if (!previousPlugin) {
        host.openRuntimeUnavailable(retry.appId, reason)
        return false
      }
      const source = { widgetId: previous.sourceWidget, route: previous.route }
      manager.start(previousPlugin, source)
      host.openAppFrame({ plugin: previousPlugin, source })
      try {
        runtime.start(previousPlugin, {
          ...host.context(),
          appId: previous.appId,
          route: previous.route,
          sourceWidget: previous.sourceWidget,
          platform,
        })
        host.showAppError(`无法启动 ${retry.appId}：${reason}`, () => platform.openApp(retry))
        return true
      } catch {
        manager.stop()
        host.closeAppFrame()
        host.openRuntimeUnavailable(retry.appId, reason)
        return false
      }
    }

    async function closeForeground() {
      if (!state.active) return true
      const appId = state.active.appId
      const result = await dispatchToEndpoint({ type: 'action', appId, action: 'stop' })
      if (!result.ok) {
        host.showAppError(`无法停止 ${appId}：${result.error}`, () => platform.closeApp())
        return false
      }
      recordEndpointTrace(result.trace)
      stopLocalForeground()
      return true
    }

    const platform = {
      events,
      endpoint: 'main-process',
      catalog,
      async listApps() {
        const apps = root.odkCompanion?.listApps
          ? await root.odkCompanion.listApps()
          : catalog()
        return apps.map((app) => ({ ...app, capabilities: [...(app.capabilities || [])] }))
      },
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
      activeSnapshot: () => state.active ? { ...state.active } : null,
      setState(appId, appState) {
        state.appStates.set(appId, appState)
        if (state.active?.appId === appId) state.active.state = appState === '运行中' ? 'running' : 'paused'
        publish()
        publishAppState(appId)
      },
      active: () => state.active ? { ...state.active } : null,
      async openApp({ appId, widgetId = null, route = null }) {
        if (state.active?.appId === appId) return true
        const plugin = installer.ensureInstalled(appId)
        if (!plugin) {
          host.openMissingApp(appId)
          return false
        }
        const target = { appId, widgetId, route }
        const endpointResult = await dispatchToEndpoint({ type: 'open-app', appId, route, source: widgetId })
        if (!endpointResult.ok) {
          host.openRuntimeUnavailable(appId, endpointResult.error)
          return false
        }
        recordEndpointTrace(endpointResult.trace)
        const previous = state.active ? { ...state.active } : null
        stopLocalForeground()
        const source = { widgetId, route }
        manager.start(plugin, source)
        try {
          host.openAppFrame({ plugin, source })
          runtime.start(plugin, {
            ...host.context(),
            appId,
            route,
            sourceWidget: widgetId,
            platform,
          })
          return true
        } catch (error) {
          runtime.stop()
          manager.stop()
          return restoreForeground(previous, error.message, target)
        }
      },
      async emitIntent(intent) {
        if (!intent) return false
        if (intent.type === 'open-app') return platform.openApp(intent)
        if (intent.type !== 'action') return false
        const plugin = installer.prepareAction(intent)
        if (!plugin || state.active?.appId !== intent.appId) return false
        const endpointResult = await dispatchToEndpoint(intent)
        if (!endpointResult.ok) {
          host.showAppError(`操作失败：${endpointResult.error}`, () => platform.emitIntent(intent))
          return false
        }
        recordEndpointTrace(endpointResult.trace)
        const succeeded = await runtime.dispatchAction(intent)
        if (!succeeded) host.showAppError('操作未完成，请重试。', () => platform.emitIntent(intent))
        return succeeded
      },
      closeApp: closeForeground,
      async uninstallApp(appId) {
        const plugin = findApp(appId)
        if (!plugin) return false
        const endpointResult = await dispatchToEndpoint({ type: 'remove-app', appId })
        if (!endpointResult.ok) return false
        if (state.active?.appId === appId) await closeForeground()
        root.odkPlugins.retire(plugin, null, host.context())
        state.appStates.set(appId, 'uninstalled')
        publishAppState(appId)
        return true
      },
    }

    return platform
  }

  root.odkAppPlatform = { create: createAppPlatform }
})(typeof window !== 'undefined' ? window : globalThis)
