;
(function (root) {
  'use strict'

  const EMPTY_STATE = '未打开 App'

  function createAppPlatform({ host }) {
    const events = []
    const state = { active: null, appStates: new Map() }
    const listeners = new Set()
    const stateListeners = new Set()
    let endpointQueue = Promise.resolve()
    let runtimePlugin = null
    let runtimeCleanup = null

    const publish = () => {
      const snapshot = state.active ? { ...state.active } : { label: EMPTY_STATE, state: 'idle' }
      for (const listener of listeners) listener(snapshot)
    }

    const publishAppState = (appId) => {
      const appState = state.appStates.get(appId) || 'installed'
      for (const listener of stateListeners) listener(appId, appState)
    }

    const record = (layer, action, appId) => events.push({ layer, action, appId })

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
        capabilities: [...(plugin.capabilities || [])],
        state: state.appStates.get(appId) || 'installed',
      }
    })

    function dispatchToEndpoint(intent) {
      const request = endpointQueue.then(async () => {
        if (typeof root.odkCompanion?.dispatchIntent !== 'function') {
          return { ok: false, error: 'endpoint-unavailable', trace: [] }
        }
        try {
          return await root.odkCompanion.dispatchIntent(intent)
        } catch {
          return { ok: false, error: 'endpoint-unavailable', trace: [] }
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
        runtimePlugin = plugin
        const rootElement = host.runtimeRoot()
        rootElement.replaceChildren()
        try {
          root.odkPlugins.activate(plugin, rootElement, scopedContext)
        } catch (error) {
          runtimeCleanup()
          runtimeCleanup = null
          runtimePlugin = null
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
        const plugin = runtimePlugin
        const appId = plugin.appId || plugin.id
        record('app-runtime', 'stop', appId)
        try {
          root.odkPlugins.deactivate(plugin, host.runtimeRoot(), host.context())
        } finally {
          runtimeCleanup?.()
          runtimeCleanup = null
          runtimePlugin = null
        }
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
      dispatchAction() {},
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

    function cleanupLocalForeground() {
      try { runtime.stop() } catch {}
      try { manager.stop() } catch {}
      try { host.closeAppFrame() } catch {}
    }

    async function restoreLocalForeground(snapshot) {
      if (!snapshot) return true
      const plugin = installer.ensureInstalled(snapshot.appId)
      if (!plugin) return false
      const source = { widgetId: snapshot.sourceWidget, route: snapshot.route }
      try {
        manager.start(plugin, source)
        host.openAppFrame({ plugin, source })
        runtime.start(plugin, {
          ...host.context(),
          appId: snapshot.appId,
          route: snapshot.route,
          sourceWidget: snapshot.sourceWidget,
          platform,
        })
        return true
      } catch {
        cleanupLocalForeground()
        return false
      }
    }

    function recordEndpointTrace(trace, skipRuntime = true) {
      for (const event of trace || []) {
        if (skipRuntime && event.layer === 'app-runtime') continue
        record(event.layer, event.action, event.appId)
      }
    }

    function showOpenFailure(appId, reason, widgetId, route, preserveForeground = false) {
      const retry = () => platform.openApp({ appId, widgetId, route })
      if (preserveForeground && state.active) {
        host.showAppError(`无法启动 ${appId}：${reason}`, retry)
      } else {
        host.openRuntimeUnavailable(appId, reason, retry)
      }
    }

    function showActionFailure(intent, reason) {
      host.openAppActionError(intent, reason, () => platform.emitIntent(intent))
    }

    async function openApp({ appId, widgetId = null, route = null }) {
      if (state.active?.appId === appId) return true
      const plugin = installer.ensureInstalled(appId)
      if (!plugin) {
        host.openMissingApp(appId)
        return false
      }

      const result = await dispatchToEndpoint({ type: 'open-app', appId, route, source: widgetId })
      if (!result.ok) {
        showOpenFailure(appId, result.error, widgetId, route)
        return false
      }
      recordEndpointTrace(result.trace)
      const previous = state.active ? { ...state.active } : null
      const source = { widgetId, route }

      try {
        stopLocalForeground()
        manager.start(plugin, source)
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
        cleanupLocalForeground()
        const transition = result.transition
        const rollback = transition ? await dispatchToEndpoint({
          type: 'rollback-open',
          appId,
          expectedTargetState: 'running',
          targetState: transition.targetState,
          previousAppId: transition.previousAppId,
          previousState: transition.previousState,
        }) : { ok: false, error: 'rollback-unavailable' }
        if (rollback.ok && previous) await restoreLocalForeground(previous)
        const detail = rollback.ok ? error.message :
          `${error.message}; endpoint rollback failed: ${rollback.error || 'unknown error'}`
        showOpenFailure(appId, detail, widgetId, route, rollback.ok && Boolean(previous))
        return false
      }
    }

    async function dispatchAction(intent) {
      const plugin = installer.prepareAction(intent)
      if (!plugin || state.active?.appId !== intent.appId) return false
      const result = await dispatchToEndpoint(intent)
      if (!result.ok) {
        showActionFailure(intent, result.error)
        return false
      }
      recordEndpointTrace(result.trace)
      manager.dispatchAction(intent)
      if (await runtime.dispatchAction(intent)) return true

      const transition = result.transition
      const rollback = transition ? await dispatchToEndpoint({
        type: 'rollback-action',
        appId: intent.appId,
        expectedState: transition.nextState,
        previousState: transition.previousState,
        previousForegroundAppId: transition.previousForegroundAppId,
      }) : { ok: false, error: 'rollback-unavailable' }
      const detail = rollback.ok ? 'Runtime rejected the action.' :
        `Runtime rejected the action; endpoint rollback failed: ${rollback.error || 'unknown error'}`
      showActionFailure(intent, detail)
      return false
    }

    async function stopForeground() {
      if (!state.active) return true
      const appId = state.active.appId
      const result = await dispatchToEndpoint({ type: 'action', appId, action: 'stop' })
      if (!result.ok) {
        record('app-manager', 'stop-failed', appId)
        showActionFailure({ type: 'action', appId, action: 'stop' }, result.error)
        return false
      }
      recordEndpointTrace(result.trace)
      try {
        stopLocalForeground()
        return true
      } catch (error) {
        const transition = result.transition
        const rollback = transition ? await dispatchToEndpoint({
          type: 'rollback-action',
          appId,
          expectedState: 'stopped',
          previousState: transition.previousState,
          previousForegroundAppId: transition.previousForegroundAppId,
        }) : { ok: false, error: 'rollback-unavailable' }
        const detail = rollback.ok ? error.message :
          `${error.message}; endpoint rollback failed: ${rollback.error || 'unknown error'}`
        showActionFailure({ type: 'action', appId, action: 'stop' }, detail)
        return false
      }
    }

    const platform = {
      events,
      endpoint: 'main-process',
      catalog,
      async listApps() {
        if (typeof root.odkCompanion?.listApps !== 'function') throw new Error('endpoint-unavailable')
        try {
          const apps = await root.odkCompanion.listApps()
          return apps.map((app) => ({ ...app, capabilities: [...(app.capabilities || [])] }))
        } catch {
          throw new Error('endpoint-unavailable')
        }
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
      openApp,
      async emitIntent(intent) {
        if (!intent) return false
        if (intent.type === 'open-app') return openApp(intent)
        if (intent.type !== 'action') return false
        return dispatchAction(intent)
      },
      closeApp: stopForeground,
      async uninstallApp(appId) {
        const plugin = findApp(appId)
        if (!plugin) return false
        if (state.active?.appId === appId && !(await stopForeground())) return false
        const result = await dispatchToEndpoint({ type: 'remove-app', appId })
        if (!result.ok) {
          showActionFailure({ type: 'remove-app', appId }, result.error)
          return false
        }
        recordEndpointTrace(result.trace)
        try {
          root.odkPlugins.retire(plugin, null, host.context())
        } catch (error) {
          const rollback = await dispatchToEndpoint({ type: 'install-app', appId })
          const detail = rollback.ok ? error.message :
            `${error.message}; endpoint rollback failed: ${rollback.error || 'unknown error'}`
          showActionFailure({ type: 'remove-app', appId }, detail)
          return false
        }
        state.appStates.set(appId, '已卸载')
        publishAppState(appId)
        return true
      },
    }

    return platform
  }

  root.odkAppPlatform = { create: createAppPlatform }
})(typeof window !== 'undefined' ? window : globalThis)
