;
(function (root) {
  'use strict'

  /*
   * Desktop composer: turns the declarative DESKTOP_LAYOUT config into pages
   * inside #pages-track. Grid pages use the config's explicit tile placement;
   * page plugins own their markup.
   */
  function validGridLine(value) {
    return typeof value === 'string' && /^\d+(?:\s*\/\s*\d+)?$/.test(value)
  }

  function validateSurface(page, plugin) {
    const surface = page.surface || plugin?.surface || 'display'
    if (!['display', 'app'].includes(surface)) {
      throw new Error(`page "${page.id}" has unsupported surface: ${surface}`)
    }
    if (page.kind === 'grid' && surface !== 'display') {
      throw new Error(`grid page "${page.id}" must use the display surface`)
    }
    if (plugin?.surface && plugin.surface !== surface) {
      throw new Error(`page "${page.id}" surface does not match plugin "${plugin.id}"`)
    }
    return surface
  }

  function validate(layout) {
    if (!layout || !Array.isArray(layout.pages) || layout.pages.length === 0) {
      throw new Error('desktop layout requires a non-empty pages array')
    }
    const pageIds = new Set()
    for (const page of layout.pages) {
      if (!page.id || !page.name || pageIds.has(page.id)) throw new Error(`page has missing or duplicate id/name: ${JSON.stringify(page)}`)
      pageIds.add(page.id)
      if (page.kind === 'grid') {
        validateSurface(page)
        if (!Array.isArray(page.widgets)) throw new Error(`grid page "${page.id}" requires widgets`)
        const widgetIds = new Set()
        for (const widget of page.widgets) {
          if (!root.odkPlugins.has(widget.id)) throw new Error(`unknown widget plugin "${widget.id}"`)
          const plugin = root.odkPlugins.get(widget.id)
          if (plugin.kind !== 'tile') throw new Error(`grid page "${page.id}" must reference a tile plugin`)
          if (widget.col && widget.row) {
            if (!validGridLine(widget.col) || !validGridLine(widget.row)) throw new Error(`tile "${widget.id}" has invalid grid placement`)
          }
          if (widgetIds.has(widget.id)) throw new Error(`tile "${widget.id}" appears more than once on page "${page.id}"`)
          widgetIds.add(widget.id)
          if (plugin.interaction && plugin.interaction !== 'display-only') {
            throw new Error(`display grid tile "${widget.id}" cannot expose an App interaction`)
          }
        }
      } else if (page.kind === 'page') {
        if (!root.odkPlugins.has(page.plugin)) throw new Error(`unknown page plugin "${page.plugin}"`)
        const plugin = root.odkPlugins.get(page.plugin)
        if (plugin.kind !== 'page') throw new Error(`page "${page.id}" must reference a page plugin`)
        validateSurface(page, plugin)
      } else {
        throw new Error(`page "${page.id}" has unsupported kind: ${page.kind}`)
      }
    }
    return true
  }

  function widgetClass(plugin) {
    return `w-${plugin.id.replace(/^odk\.tile\./, '')}`
  }

  function filterLayout(layout, disabled) {
    if (!disabled || disabled.size === 0) return layout
    const kept = []
    for (const page of layout.pages) {
      if (page.kind === 'page' && disabled.has(page.plugin)) continue
      if (page.kind === 'grid' && page.widgets.some((widget) => disabled.has(widget.id))) {
        kept.push({ ...page, widgets: page.widgets.filter((widget) => !disabled.has(widget.id)) })
      } else {
        kept.push(page)
      }
    }
    return { ...layout, pages: kept }
  }

  function markActivationError(container, def) {
    container.dataset.state = 'Error'
    const note = document.createElement('span')
    note.className = 'widget-error'
    note.textContent = 'Widget error'
    note.title = def.id
    container.append(note)
  }

  function buildTile(page, widgetDef, uiCtx) {
    const plugin = root.odkPlugins.get(widgetDef.id)
    const tile = document.createElement('div')
    tile.className = `widget widget-display-only ${widgetClass(plugin)} flex flex-col`
    tile.dataset.widget = plugin.id
    tile.dataset.app = plugin.app
    tile.dataset.state = plugin.state
    tile.dataset.interaction = plugin.interaction || 'display-only'
    // The declared floor is published on the tile so the geometry gates can hold
    // the desk to it instead of trusting a comment.
    if (Number.isFinite(Number(plugin.manifest?.minCell))) tile.dataset.minCell = String(plugin.manifest.minCell)
    placeTile(page, tile, widgetDef, plugin)
    if (!root.odkPlugins.activate(plugin, tile, uiCtx)) markActivationError(tile, plugin)
    attachTileLauncher(tile, widgetDef, plugin, uiCtx)
    return tile
  }

  function attachTileLauncher(tile, widgetDef, plugin, uiCtx) {
    const appId = widgetDef.opensApp || tile.dataset.openApp || plugin.opensApp
    if (appId && !tile.querySelector('.widget-launch')) {
      const launch = document.createElement('button')
      launch.type = 'button'
      launch.className = 'widget-launch'
      launch.setAttribute('aria-label', `Open ${plugin.app}`)
      launch.title = `Open ${plugin.app}`
      tile.dataset.openApp = appId
      launch.addEventListener('click', () => {
        Promise.resolve(uiCtx.platform.openApp({ appId, widgetId: plugin.id, route: 'home' }))
          .catch(error => console.error('Widget App failed:', error))
      })
      tile.append(launch)
    }
  }

  // The geometry the layout model has just produced: the cell every tile is given,
  // and the lines of the grid they are placed in. Spans are decided from this, so a
  // page keeps its composition whenever the grid can satisfy it and the resulting
  // cell is large enough for the instrument it holds.
  function gridMetrics() {
    const style = root.getComputedStyle ? root.getComputedStyle(document.documentElement) : null
    const pixels = (name) => Number.parseFloat(style?.getPropertyValue(name) || '') || 0
    const count = (name) => Number.parseInt(style?.getPropertyValue(name) || '', 10) || 0
    return {
      cellWidth: pixels('--cell-w'),
      cellHeight: pixels('--cell-h'),
      columns: count('--cols'),
      rows: count('--rows'),
    }
  }

  function placeTile(page, tile, widgetDef, plugin) {
    if (!widgetDef.col) return
    if (!widgetDef.row) return
    const { spanCells, honorsSpan, gridHasLines, pageFitsGrid } = root.odkGridPlacement
    const { cellWidth, cellHeight, columns, rows: defaultRows } = gridMetrics()
    const rows = page.gridRows || defaultRows
    // The grid has to be able to give the span its lines, the page has to be a
    // grid its composition was drawn for, and the cell the span produces has to
    // reach what the instrument declared it reads at. Failing any of those leaves
    // the tile unplaced, and the grid then gives it one cell, which is always
    // somewhere an instrument can be drawn.
    const placeable = columns > 0 && rows > 0
      && pageFitsGrid(page.widgets, columns, rows)
      && gridHasLines(widgetDef.col, columns)
      && gridHasLines(widgetDef.row, rows)
    const honored = placeable && honorsSpan({
      columns: spanCells(widgetDef.col),
      rows: spanCells(widgetDef.row),
    }, cellWidth, cellHeight, plugin.manifest?.minCell)
    if (honored) {
      tile.style.gridColumn = widgetDef.col
      tile.style.gridRow = widgetDef.row
      tile.dataset.span = 'kept'
    } else {
      // Left unplaced, the grid gives the instrument a single cell, which is
      // always enough for it to be drawn.
      tile.style.gridColumn = ''
      tile.style.gridRow = ''
      tile.dataset.span = 'dropped'
    }
  }

  function placeGridTiles(track) {
    const layout = root.DESKTOP_LAYOUT
    if (!layout?.pages) return
    for (const page of layout.pages) {
      if (page.kind !== 'grid') continue
      const grid = track.querySelector(`.page[data-page-id="${page.id}"] .widget-grid`)
      if (!grid) continue
      grid.style.gridTemplateRows = `repeat(${page.gridRows || 'var(--rows)'}, var(--cell-h))`
      for (const widgetDef of page.widgets) {
        const tile = grid.querySelector(`[data-widget="${widgetDef.id}"]`)
        if (!tile) continue
        placeTile(page, tile, widgetDef, root.odkPlugins.get(widgetDef.id))
      }
      for (const tile of grid.querySelectorAll('[data-user-app-id]')) {
        placeTile({ ...page, widgets: [] }, tile, { col: tile.dataset.col, row: tile.dataset.row }, {})
      }
    }
    reportDesktopGeometry(track)
  }

  function reportDesktopGeometry(track) {
    if (!root.odkUserApps?.reportGeometry || !root.DESKTOP_LAYOUT?.pages) return
    const { columns, rows: defaultRows, cellWidth, cellHeight } = gridMetrics()
    if (!columns || !cellWidth || !cellHeight) return
    const gap = Number.parseFloat(root.getComputedStyle(document.documentElement).getPropertyValue('--widget-gap')) || 0
    const pages = [...track.children].map((section, index) => {
      const id = section.dataset.pageId
      const page = root.DESKTOP_LAYOUT.pages.find(page => page.id === id)
      if (!page || page.kind !== 'grid') return { id, index: index + 1, columns: 0, rows: 0, occupied: [] }
      const grid = track.querySelector(`.page[data-page-id="${page.id}"] .widget-grid`)
      const rows = page.gridRows || defaultRows
      const occupied = []
      if (!grid) return { id: page.id, index: index + 1, columns: 0, rows: 0, occupied }
      const origin = grid.getBoundingClientRect()
      for (const widget of page.widgets) {
        const tile = grid.querySelector(`[data-widget="${widget.id}"]`)
        // Disabled built-ins retain their reservation. Unmeasured pages fail closed.
        if (!tile) { occupied.push(widget); continue }
        const box = tile.getBoundingClientRect()
        const col = Math.round((box.left - origin.left) / (cellWidth + gap)) + 1
        const row = Math.round((box.top - origin.top) / (cellHeight + gap)) + 1
        const width = Math.round((box.width + gap) / (cellWidth + gap))
        const height = Math.round((box.height + gap) / (cellHeight + gap))
        occupied.push({ id: widget.id, col: `${col} / ${col + width}`, row: `${row} / ${row + height}` })
      }
      return { id: page.id, index: index + 1, columns, rows, occupied }
    })
    void root.odkUserApps.reportGeometry(pages).catch(() => {})
  }

  // A resized panel changes the cell, and so changes which spans fit. The
  // placement is re-decided from the cell the model has just produced. The
  // deferral is a timer rather than an animation frame on purpose: a frame never
  // runs in a window that is not painting, and a window the owner has behind
  // another one is still a window whose layout is live.
  // A rebuild replaces the observer rather than stacking a second one behind it.
  let cellWatcher = null
  function watchCellSize(track) {
    if (typeof ResizeObserver === 'undefined') return
    if (cellWatcher) cellWatcher.disconnect()
    let queued = false
    cellWatcher = new ResizeObserver(() => {
      if (queued) return
      queued = true
      setTimeout(() => {
        queued = false
        placeGridTiles(track)
      }, 0)
    })
    cellWatcher.observe(document.documentElement)
  }

  function buildPage(page, index, track, uiCtx, before = null) {
    const section = document.createElement('section')
    const surface = page.surface || (page.kind === 'page' ? root.odkPlugins.get(page.plugin).surface : 'display') || 'display'
    section.className = `page page-${surface} flex flex-col`
    section.dataset.page = page.persistent ? page.persistent : String(track.children.length)
    section.dataset.pageId = page.id
    section.dataset.surface = surface
    section.dataset.builtBy = 'composer'
    if (page.kind === 'page') section.dataset.plugin = page.plugin
    section.setAttribute('aria-label', page.name)
    const host = page.persistent ? document.getElementById(page.persistent) : track
    if (!host) throw Error('Persistent page host unavailable')
    if (page.persistent) section.dataset.persistent = page.persistent
    if (before) host.insertBefore(section, before)
    else host.append(section)
    if (page.kind === 'grid') {
      const grid = document.createElement('div')
      grid.className = 'widget-grid grid'
      grid.style.gridTemplateRows = `repeat(${page.gridRows || 'var(--rows)'}, var(--cell-h))`
      for (const widget of page.widgets) grid.append(buildTile(page, widget, uiCtx))
      section.append(grid)
    } else {
      const plugin = root.odkPlugins.get(page.plugin)
      if (!root.odkPlugins.activate(plugin, section, uiCtx)) markActivationError(section, plugin)
    }
    return section
  }

  function build(layout, track, uiCtx) {
    validate(layout)
    track.replaceChildren()
    layout.pages.forEach((page, index) => buildPage(page, index, track, uiCtx))
    // The cell changes when the window does, and the cell is what decides a span.
    watchCellSize(track)
  }

  function statusSlots() {
    const slots = new Map(['left', 'right'].map(name => [name, document.querySelector(`[data-slot="status-${name}"]`)]))
    if ([...slots.values()].some(slot => !slot)) throw Error('State Bar slots unavailable')
    return slots
  }

  function markStatusError(host, def) {
    host.dataset.statusError = 'true'
    host.className += ' status-plugin-error'
    host.textContent = 'Plugin error'
    host.title = def.id
  }

  function clearStatusError(host, def) {
    if (host.dataset.statusError !== 'true') return
    host.classList.remove('status-plugin-error')
    if (host.title === def.id) host.removeAttribute('title')
    delete host.dataset.statusError
  }

  function buildStatusHost(def, slot, uiCtx, before = null) {
    const host = document.createElement('span')
    host.className = `status-plugin status-${def.id.replace(/^odk\.status\./, '')}`
    host.dataset.statusPlugin = def.id
    host.dataset.builtBy = 'composer-status'
    if (before) slot.insertBefore(host, before)
    else slot.append(host)
    if (!root.odkPlugins.activate(def, host, uiCtx)) markStatusError(host, def)
    return host
  }

  function buildStatus(uiCtx, disabled = new Set()) {
    const slots = statusSlots()
    for (const def of root.odkPlugins.byKind('status')) {
      if (!disabled.has(def.id)) buildStatusHost(def, slots.get(def.slot), uiCtx)
    }
  }

  let reconciliation = Promise.resolve()
  function reconcile(layout, track, uiCtx, disabled) {
    const request = reconciliation.then(async () => {
      validate(layout)
      const exclusions = disabled || new Set(root.odkPlugins.catalog()
        .filter(plugin => ['disabled', 'blocked'].includes(plugin.state)).map(plugin => plugin.manifest.id))
      const selected = filterLayout(layout, exclusions)
      const wantedPages = new Set(selected.pages.map(page => page.id))
      const ownedPages = new Map([...track.children, ...(document.querySelectorAll?.('#home-summary > .page, #personal-agent > .page') || [])].filter(section => section.dataset.builtBy === 'composer')
        .map(section => [section.dataset.pageId, section]))
      const declarations = new Map(layout.pages.map(page => [page.id, page]))
      for (const [id, section] of ownedPages) {
        const page = declarations.get(id)
        const kind = section.dataset.plugin ? 'page' : 'grid'
        if ((!page && kind === 'grid') || (page && (page.kind !== kind
          || (kind === 'page' && page.plugin !== section.dataset.plugin)
          || validateSurface(page, kind === 'page' ? root.odkPlugins.get(page.plugin) : null) !== section.dataset.surface))) {
          throw Error('runtime reconciliation cannot change page ownership or remove a base grid')
        }
      }
      for (const [id, section] of ownedPages) {
        if (wantedPages.has(id)) continue
        if (section.dataset.plugin) {
          await root.odkPlugins.deactivate(root.odkPlugins.get(section.dataset.plugin), section, uiCtx)
        } else {
          const grid = section.querySelector('.widget-grid')
          if ([...grid.children].some(child => child.dataset.userAppId)) throw Error('installed package placement must remain available')
          for (const tile of [...grid.children].filter(child => child.dataset.widget)) {
            await root.odkPlugins.deactivate(root.odkPlugins.get(tile.dataset.widget), tile, uiCtx)
          }
        }
        section.remove()
        ownedPages.delete(id)
      }
      const cursors = new Map()
      for (const [index, page] of selected.pages.entries()) {
        const host = page.persistent ? document.getElementById(page.persistent) : track
        const cursor = cursors.has(host) ? cursors.get(host) : host.firstChild
        let section = ownedPages.get(page.id)
        const created = !section
        if (!section) section = buildPage(page, index, track, uiCtx, cursor)
        else if (section !== cursor) host.insertBefore(section, cursor)
        cursors.set(host, section.nextSibling)
        if (created) continue
        if (page.kind !== 'grid') {
          const plugin = root.odkPlugins.get(page.plugin)
          if (!root.odkPlugins.isActive(plugin, section)) {
            await root.odkPlugins.deactivate(plugin, section, uiCtx)
            section.replaceChildren()
            if (!root.odkPlugins.activate(plugin, section, uiCtx)) markActivationError(section, plugin)
          }
          continue
        }
        const grid = section.querySelector('.widget-grid')
        grid.style.gridTemplateRows = `repeat(${page.gridRows || 'var(--rows)'}, var(--cell-h))`
        const wantedTiles = new Set(page.widgets.map(widget => widget.id))
        const tiles = new Map([...grid.children].filter(tile => tile.dataset.widget).map(tile => [tile.dataset.widget, tile]))
        for (const [id, tile] of tiles) {
          if (wantedTiles.has(id)) continue
          await root.odkPlugins.deactivate(root.odkPlugins.get(id), tile, uiCtx)
          tile.remove()
          tiles.delete(id)
        }
        let tileCursor = grid.firstChild
        for (const widget of page.widgets) {
          let tile = tiles.get(widget.id)
          const created = !tile
          if (!tile) { tile = buildTile(page, widget, uiCtx); grid.insertBefore(tile, tileCursor) }
          else if (tile !== tileCursor) grid.insertBefore(tile, tileCursor)
          const plugin = root.odkPlugins.get(widget.id)
          if (!created && !root.odkPlugins.isActive(plugin, tile)) {
            await root.odkPlugins.deactivate(plugin, tile, uiCtx)
            tile.replaceChildren()
            if (!root.odkPlugins.activate(plugin, tile, uiCtx)) markActivationError(tile, plugin)
          }
          attachTileLauncher(tile, widget, plugin, uiCtx)
          placeTile(page, tile, widget, plugin)
          tileCursor = tile.nextSibling
        }
      }
      for (const [index, section] of [...track.children].entries()) section.dataset.page = String(index)
      return selected
    })
    reconciliation = request.catch(() => {})
    return request
  }

  function reconcileStatus(uiCtx, disabled) {
    const request = reconciliation.then(async () => {
      const slots = statusSlots()
      const exclusions = disabled || new Set(root.odkPlugins.catalog()
        .filter(plugin => ['disabled', 'blocked'].includes(plugin.state)).map(plugin => plugin.manifest.id))
      const definitions = root.odkPlugins.byKind('status')
      for (const [name, slot] of slots) {
        const selected = definitions.filter(def => def.slot === name && !exclusions.has(def.id))
        const wanted = new Set(selected.map(def => def.id))
        const owned = new Map([...slot.children].filter(host => host.dataset.builtBy === 'composer-status')
          .map(host => [host.dataset.statusPlugin, host]))
        for (const [id, host] of owned) {
          if (wanted.has(id)) continue
          await root.odkPlugins.deactivate(root.odkPlugins.get(id), host, uiCtx)
          host.remove()
          owned.delete(id)
        }
        let cursor = slot.firstChild
        for (const def of selected) {
          let host = owned.get(def.id)
          const created = !host
          if (!host) host = buildStatusHost(def, slot, uiCtx, cursor)
          else if (host !== cursor) slot.insertBefore(host, cursor)
          if (!created && !root.odkPlugins.isActive(def, host)) {
            await root.odkPlugins.deactivate(def, host, uiCtx)
            host.replaceChildren()
            clearStatusError(host, def)
            host.className = `status-plugin status-${def.id.replace(/^odk\.status\./, '')}`
            host.removeAttribute?.('title')
            if (!root.odkPlugins.activate(def, host, uiCtx)) markStatusError(host, def)
          }
          if (root.odkPlugins.isActive(def, host)) clearStatusError(host, def)
          cursor = host.nextSibling
        }
      }
    })
    reconciliation = request.catch(() => {})
    return request
  }

  root.odkComposer = { validate, build, buildStatus, reconcile, reconcileStatus, filterLayout, placeGridTiles }
})(typeof window !== 'undefined' ? window : globalThis)
