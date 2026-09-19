;(function (root) {
  'use strict'

  function mount({ track, layout, status, onPagesChanged, onCatalogChanged }) {
    const entries = new Map()
    let generation = 0
    let disposed = false
    let hasCatalog = false

    function remove(id) {
      const entry = entries.get(id)
      entries.delete(id)
      entry.mounted?.dispose()
      entry.host.remove()
    }

    function destination(app) {
      if (app.kind === 'app') return track
      // A widget the catalog could not place - no free cell, or a built-in tile now
      // claims its cell - waits in the desktop status instead of painting into it.
      if (app.placementError) return null
      const page = layout.pages.find(page => page.id === app.placement?.pageId && page.kind === 'grid')
      if (!page) return null
      return [...track.children].find(section => section.dataset.pageId === page.id)?.querySelector('.widget-grid')
    }

    function add(app, parent, key) {
      const widget = app.kind === 'widget'
      const host = document.createElement(widget ? 'div' : 'section')
      host.className = widget ? 'widget widget-display-only installed-widget' : 'page page-app installed-app flex flex-col'
      host.dataset.userAppId = app.id
      host.dataset.state = 'loading'
      host.setAttribute('aria-label', app.name)
      if (widget) {
        host.dataset.interaction = 'display-only'
        host.style.gridColumn = app.placement.col
        host.style.gridRow = app.placement.row
      } else {
        host.dataset.pageId = `installed:${app.id}`
        host.dataset.surface = 'app'
      }
      const note = document.createElement('p')
      note.className = 'installed-app-message'
      note.textContent = `Loading ${app.name}.`
      host.append(note)
      parent.append(host)
      const entry = { host, key, mounted: null }
      entries.set(app.id, entry)
      const fail = () => {
        if (entries.get(app.id) !== entry) return
        host.dataset.state = 'unavailable'
        note.hidden = false
        note.textContent = `Unable to open ${app.name}.`
      }
      try {
        entry.mounted = root.odkUserAppFrame.mount(host, {
          ...app, url: `odk-user-app://app/${encodeURIComponent(app.id)}/${encodeURIComponent(app.revision)}`, onError: fail,
        })
        if (widget) {
          entry.mounted.frame.setAttribute('tabindex', '-1')
          entry.mounted.frame.inert = true
        }
        entry.mounted.ready.then(() => {
          if (entries.get(app.id) !== entry) return
          host.dataset.state = 'ready'
          note.hidden = true
        }, fail)
      } catch { fail() }
    }

    function reconcile(apps) {
      const desired = new Map(apps.map(app => [app.id, app]))
      let pagesChanged = false
      for (const [id, entry] of entries) {
        const app = desired.get(id)
        const key = app && JSON.stringify([app.kind, app.revision, app.name, app.placement])
        if (key === entry.key) continue
        pagesChanged ||= entry.host.dataset.surface === 'app'
        remove(id)
      }
      for (const app of apps) {
        if (entries.has(app.id)) continue
        const parent = destination(app)
        if (!parent) continue
        add(app, parent, JSON.stringify([app.kind, app.revision, app.name, app.placement]))
        pagesChanged ||= app.kind === 'app'
      }
      if (pagesChanged) onPagesChanged?.()
      onCatalogChanged?.()
    }

    async function refresh() {
      const token = ++generation
      status.hidden = false
      status.dataset.state = 'loading'
      status.textContent = 'Loading installed applications.'
      try {
        const result = await root.odkUserApps?.list()
        if (disposed || token !== generation) return
        if (!result?.ok || !Array.isArray(result.apps)) throw new Error(result?.error || 'catalog unavailable')
        reconcile(result.apps)
        hasCatalog = true
        const unplaced = result.apps.filter(app => app.kind === 'widget' && !destination(app))
        status.dataset.state = unplaced.length ? 'placement-error' : 'ready'
        // Name the reason when the catalog has one: "its cell is taken" and "the desk is
        // full" lead to the same action but read very differently to the person seeing it.
        const reasons = {
          'occupied-placement': 'its desktop cell is now a built-in tile',
          'desktop-full': 'there is no free desktop cell',
        }
        const reason = unplaced.map(app => reasons[app.placementError]).find(Boolean)
        status.textContent = unplaced.length
          ? `${unplaced.map(app => app.name).join(', ')}: ${reason || 'desktop placement unavailable'}. Ask the Agent to move or remove the widget.`
          : ''
        status.hidden = unplaced.length === 0
      } catch {
        if (disposed || token !== generation) return
        status.dataset.state = 'unavailable'
        status.textContent = hasCatalog ? 'Installed applications unavailable; displayed catalog is stale. Try refreshing.' : 'Installed applications unavailable. Try refreshing.'
      }
    }

    const unsubscribe = root.odkUserApps?.subscribe(() => { void refresh() })
    void refresh()
    return {
      refresh,
      dispose() {
        disposed = true
        generation++
        unsubscribe?.()
        for (const id of entries.keys()) remove(id)
      },
    }
  }

  root.odkUserAppDesktop = { mount }
})(typeof window !== 'undefined' ? window : globalThis)
