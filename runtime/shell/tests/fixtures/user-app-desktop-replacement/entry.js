;(function (root) {
  'use strict'
  const definition = {
    manifest: { schemaVersion: 1, id: 'odk.system.user-app-desktop', name: 'Independent installed desktop',
      version: '2.0.0', kind: 'system', host: 'electron-renderer',
      provides: [{ interface: 'odk:system/user-app-desktop/v1' }], requires: [], permissions: [] },
    create() {
      return { ports: { 'odk:system/user-app-desktop/v1': { mount(options) {
        const { track, layout, status, onPagesChanged, onCatalogChanged } = options
        let records = []
        let sequence = 0, released = false, received = false
        const destination = app => {
          if (app.kind === 'app') return track
          if (app.placementError) return null
          const page = layout.pages.find(page => page.id === app.placement?.pageId && page.kind === 'grid')
          return page && [...track.children].find(section => section.dataset.pageId === page.id)?.querySelector('.widget-grid')
        }
        const key = app => JSON.stringify([app.kind, app.revision, app.name, app.placement])
        function retire(record) {
          record.surface?.dispose()
          record.element.remove()
          records = records.filter(candidate => candidate !== record)
        }
        function insert(app, parent) {
          const widget = app.kind === 'widget', doc = track.ownerDocument || root.document
          const element = doc.createElement(widget ? 'div' : 'section')
          element.className = widget ? 'widget widget-display-only installed-widget' : 'page page-app installed-app flex flex-col'
          Object.assign(element.dataset, { userAppId: app.id, state: 'loading' })
          element.setAttribute('aria-label', app.name)
          if (widget) {
            Object.assign(element.dataset, { interaction: 'display-only', col: app.placement.col, row: app.placement.row })
            element.style.gridColumn = app.placement.col; element.style.gridRow = app.placement.row
          } else Object.assign(element.dataset, { pageId: 'installed:' + app.id, surface: 'app' })
          const note = doc.createElement('p'); note.className = 'installed-app-message'; note.textContent = 'Loading ' + app.name + '.'
          element.append(note); parent.append(element)
          const record = { id: app.id, element, key: key(app), surface: null }; records.push(record)
          const current = () => !released && records.includes(record)
          const fail = () => {
            if (!current()) return
            element.dataset.state = 'unavailable'; note.hidden = false; note.textContent = 'Unable to open ' + app.name + '.'
          }
          try {
            record.surface = root.odkUserAppFrame.mount(element, { ...app,
              url: 'odk-user-app://app/' + encodeURIComponent(app.id) + '/' + encodeURIComponent(app.revision), onError: fail })
            if (widget) { record.surface.frame.inert = true; record.surface.frame.setAttribute('tabindex', '-1') }
            record.surface.ready.then(() => {
              if (current()) { element.dataset.state = 'ready'; note.hidden = true }
            }, fail)
          } catch { fail() }
        }
        function present(apps) {
          const desired = apps.map(app => ({ app, parent: destination(app), key: key(app) }))
          const obsolete = records.filter(record => !desired.some(candidate => candidate.app.id === record.id && candidate.key === record.key))
          const additions = desired.filter(candidate => candidate.parent && !records.some(record =>
            record.id === candidate.app.id && record.key === candidate.key))
          const changed = obsolete.some(record => record.element.dataset.surface === 'app')
            || additions.some(candidate => candidate.app.kind === 'app')
          obsolete.forEach(retire)
          additions.forEach(candidate => insert(candidate.app, candidate.parent))
          root.odkComposer?.placeGridTiles(track)
          if (changed) onPagesChanged?.()
          onCatalogChanged?.()
        }
        async function refresh() {
          if (released) return
          const request = ++sequence
          status.hidden = false; status.dataset.state = 'loading'; status.textContent = 'Loading installed applications.'
          try {
            const result = await root.odkUserApps.list()
            if (released || request !== sequence) return
            if (!result?.ok || !Array.isArray(result.apps)) throw Error('catalog unavailable')
            present(result.apps); received = true
            const missing = result.apps.filter(app => app.kind === 'widget' && !destination(app))
            status.dataset.state = missing.length ? 'placement-error' : 'ready'
            const reasons = new Map([['occupied-placement', 'its desktop cell is now a built-in tile'], ['desktop-full', 'there is no free desktop cell']])
            const reason = missing.map(app => reasons.get(app.placementError)).find(Boolean) || 'desktop placement unavailable'
            status.textContent = missing.length ? missing.map(app => app.name).join(', ') + ': ' + reason + '. Ask the Agent to move or remove the widget.' : ''
            status.hidden = missing.length === 0
          } catch {
            if (released || request !== sequence) return
            status.dataset.state = 'unavailable'
            status.textContent = received ? 'Installed applications unavailable; displayed catalog is stale. Try refreshing.' : 'Installed applications unavailable. Try refreshing.'
          }
        }
        let cancel = root.odkUserApps.subscribe(() => { void refresh() })
        void refresh()
        return { refresh, dispose() {
          released = true; sequence++
          cancel?.(); cancel = null
          records.slice().forEach(retire)
        } }
      } } } }
    },
  }
  if (root.odkUserAppDesktopLoading) root.odkUserAppDesktopLoading.define({ id: definition.manifest.id, create: definition.create })
  else root.odkUserAppDesktopReplacements = [definition]
})(typeof window !== 'undefined' ? window : globalThis)
