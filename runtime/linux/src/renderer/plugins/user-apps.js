;
(function (root) {
  'use strict'

  const api = () => root.odkUserApps
  const frameApi = () => root.odkUserAppFrame
  const text = (parent, tag, value, className) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    node.textContent = value == null ? '' : String(value)
    parent.append(node)
    return node
  }
  const button = (parent, label, className, handler) => {
    const node = document.createElement('button')
    node.type = 'button'; node.className = className || 'button-pill button-secondary'
    node.textContent = label; node.addEventListener('click', handler); parent.append(node)
    return node
  }
  const errorText = (result) => result?.error || 'The operation could not be completed.'

  root.odkPlugins.register({
    id: 'odk.page.user-apps', manifest: { schemaVersion: 1 }, kind: 'page', surface: 'app',
    mount(el, ctx) {
      el.replaceChildren()
      const shell = document.createElement('div'); shell.className = 'user-apps app-surface-card odk-stack'
      const header = document.createElement('header'); header.className = 'app-surface-header'
      text(header, 'h1', 'User applications', 'app-surface-heading'); shell.append(header)
      const form = document.createElement('form'); form.className = 'user-apps-install'
      const label = text(form, 'label', 'Application ID', 'user-apps-label'); const input = document.createElement('input')
      input.type = 'text'; input.className = 'user-apps-input'; input.id = 'user-app-id'; input.autocomplete = 'off'; input.required = true; label.htmlFor = input.id
      form.append(input); const install = button(form, 'Install', 'button-pill button-primary', () => form.requestSubmit()); shell.append(form)
      const status = text(shell, 'p', '', 'user-apps-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
      const list = document.createElement('div'); list.className = 'user-apps-list'; shell.append(list); el.append(shell)
      let apps = []; let generation = 0; const frames = new Map(); let busy = false
      const disposeFrame = (id) => { const frame = frames.get(id); frames.delete(id); try { frame?.dispose?.() } catch {} try { frame?.close?.remove?.() } catch {} }
      const clearFrames = (keep = new Set()) => { for (const id of frames.keys()) if (!keep.has(id)) disposeFrame(id) }
      const render = () => {
        clearFrames(); list.replaceChildren()
        if (!apps.length) { text(list, 'p', 'No installed applications.', 'user-apps-empty'); return }
        for (const app of apps) {
          const card = document.createElement('article'); card.className = 'user-app-card'; card.dataset.appId = app.id
          const heading = document.createElement('header'); heading.className = 'user-app-card-heading'; text(heading, 'h2', app.name, 'user-app-name')
          const metadata = document.createElement('p'); metadata.className = 'user-app-meta';
          text(metadata, 'span', `Version ${app.version}`, 'user-app-meta-item'); text(metadata, 'span', `Revision ${app.revision}`, 'user-app-meta-item'); heading.append(metadata); card.append(heading)
          const actions = document.createElement('div'); actions.className = 'user-app-actions'; const frameHost = document.createElement('div'); frameHost.className = `user-app-frame-host${app.kind === 'widget' ? ' user-app-frame-host-widget' : ''}`; frameHost.hidden = app.kind === 'widget' ? false : true
          if (app.kind !== 'widget') button(actions, 'Open', 'button-pill button-secondary', () => open(app, frameHost, actions))
          button(actions, 'Update', 'button-pill button-secondary', () => dispatch('install', app.id)); button(actions, 'Rollback', 'button-pill button-secondary', () => dispatch('rollback', app.id)); button(actions, 'Remove', 'button-pill button-danger', () => dispatch('remove', app.id))
          card.append(actions, frameHost); list.append(card)
          if (app.kind === 'widget') open(app, frameHost, actions)
        }
      }
      const open = (app, host, actions) => {
        host.replaceChildren(); host.hidden = false
        disposeFrame(app.id)
        let close = null
        if (app.kind !== 'widget') close = button(actions, 'Close', 'button-pill button-secondary', () => { disposeFrame(app.id); host.replaceChildren(); host.hidden = true; close.remove() })
        const current = { dispose: null, close: close || { remove() {} } }; frames.set(app.id, current)
        const mounted = frameApi()?.mount?.(host, { id: app.id, name: app.name, revision: app.revision, url: `odk-user-app://app/${encodeURIComponent(app.id)}/${encodeURIComponent(app.revision)}`, onError: () => { if (frames.get(app.id) === current) status.textContent = `Unable to open ${app.name}.` } })
        if (!mounted) { disposeFrame(app.id); status.textContent = `Unable to open ${app.name}.`; return }
        if (typeof mounted.dispose === 'function') current.dispose = mounted.dispose
        if (app.kind === 'widget') mounted.frame?.setAttribute?.('tabindex', '-1')
        const ready = mounted.ready || (mounted.then ? mounted : null)
        if (!ready) { disposeFrame(app.id); status.textContent = `Unable to open ${app.name}.`; return }
        Promise.resolve(ready).catch(() => { if (frames.get(app.id) === current) status.textContent = `Unable to open ${app.name}.` })
      }
      const dispatch = async (command, appId) => {
        if (busy || !api()?.dispatch) return
        busy = true; install.disabled = true; status.textContent = `${command} in progress.`; const token = ++generation
        try {
          const result = await api().dispatch({ command, appId })
          if (token !== generation) return
          if (!result?.ok) { status.textContent = `${command} failed: ${errorText(result)}`; return }
          status.textContent = `${command} complete.`; await load(token)
        } catch (error) { if (token === generation) status.textContent = `${command} failed: ${error.message || 'unavailable'}` }
        finally { busy = false; install.disabled = false }
      }
      const load = async (token = ++generation) => {
        status.textContent = 'Loading applications.'
        try { const result = await api()?.list?.(); if (token !== generation) return; if (!result?.ok) throw new Error(errorText(result)); apps = Array.isArray(result.apps) ? result.apps : (Array.isArray(result) ? result : []); render(); if (!apps.length) status.textContent = 'No installed applications.'; else status.textContent = '' }
        catch (error) { if (token !== generation) return; apps = []; render(); status.textContent = `Applications unavailable: ${error.message || 'backend unavailable'}` }
      }
      form.addEventListener('submit', (event) => { event.preventDefault(); const id = input.value.trim(); if (id) void dispatch('install', id) })
      const unsubscribe = api()?.subscribe?.(() => { void load() }); ctx.trackCleanup?.(unsubscribe)
      ctx.trackCleanup?.(() => { generation++; clearFrames() }); void load()
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
