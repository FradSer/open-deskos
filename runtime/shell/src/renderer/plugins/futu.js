;
(function (root) {
  'use strict'

  const REFRESH_EVERY_TICKS = 30

  function formatRatio(value) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '--'
    const pct = Number(value) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
  }

  function direction(value) {
    const number = Number(value)
    if (Number.isNaN(number) || number === 0) return 'flat'
    return number > 0 ? 'gain' : 'loss'
  }

  function writeText(node, text) {
    if (node && node.textContent !== text) node.textContent = text
  }

  function fitValue(node) {
    if (!node) return
    const chars = Math.max(1, (node.textContent || '').length)
    const avail = node.clientWidth || 0
    let size = Math.min(96, Math.floor(avail / (chars * 0.62)))
    size = Math.max(14, size)
    node.style.fontSize = `${size}px`
    let guard = 30
    while (guard-- > 0 && size > 14 && node.scrollWidth > node.clientWidth + 1) {
      size -= 4
      node.style.fontSize = `${size}px`
    }
    // One extra step down: measured metrics shift as fallback, Montserrat,
    // and Zpix faces settle at different times, and the fit must hold for
    // all of them without remeasuring on every font load.
    if (size > 14) {
      size -= 4
      node.style.fontSize = `${size}px`
    }
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function shortCode(code) {
    const parts = String(code || '').split('.')
    return parts.length > 1 ? parts.slice(1).join('.') : String(code || '')
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') return '--'
    const price = Number(value)
    return Number.isFinite(price) && price > 0 ? price.toFixed(2) : '--'
  }

  function holdingRow(position) {
    const ratio = Number(position.dayRatio)
    const trend = direction(ratio)
    const symbol = shortCode(position.code)
    const price = formatPrice(position.price)
    const change = formatRatio(position.dayRatio)
    // A narrow cell drops the price from the row to keep the symbol whole, so the
    // row states all three values in its accessible name: nothing is dropped
    // silently.
    return `<li class="futu-holding" aria-label="${escapeAttr(`${symbol}, price ${price}, today ${change}`)}">`
      + `<span class="futu-sym">${escapeAttr(symbol)}</span>`
      + `<span class="futu-price">${escapeAttr(price)}</span>`
      + `<span class="futu-pill is-${trend}">${escapeAttr(change)}</span></li>`
  }

  function formatTime(value) {
    if (!value) return ''
    const at = new Date(value)
    if (Number.isNaN(at.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  }

  function maxRows(el) {
    return el.dataset?.expanded === 'true' ? Infinity : 3
  }

  // A tile that draws a subset says so. A shortened list that looks like the whole
  // list is the one way a glanceable instrument can be quietly wrong, so the count
  // of what it is not showing belongs in the tile's own text.
  function shownCountLabel(reading, shown) {
    const held = Array.isArray(reading?.snapshot?.positions) ? reading.snapshot.positions.length : 0
    return held <= shown ? '' : ` · ${held - shown} more`
  }

  const DATA_FONT_FLOOR = 14

  function isClipped(node) {
    return node.scrollWidth > node.clientWidth + 1
  }

  // The natural width of a row with every value at its own size, measured by
  // letting the three columns size to their content.
  function naturalRowWidth(row) {
    const previous = row.style.gridTemplateColumns
    row.style.gridTemplateColumns = 'max-content max-content max-content'
    const natural = row.scrollWidth
    row.style.gridTemplateColumns = previous
    return natural
  }

  function fontSizeOf(row) {
    if (typeof root.getComputedStyle !== 'function') return null
    const size = parseFloat(root.getComputedStyle(row).fontSize)
    return Number.isFinite(size) ? size : null
  }

  // Symbol, price, and change share one line wherever the cell can hold them, and
  // collapse to symbol and change where it cannot. The choice is measured from the
  // rendered row, so it follows the cell it is drawn in rather than any host
  // identity, and it holds for a narrow font as well as a wide one.
  function fitRows(list) {
    const rows = [...list.querySelectorAll('.futu-holding')]
    for (const row of rows) row.style.fontSize = ''
    if (!rows.length) {
      list.classList.remove('is-compact')
      return
    }
    const available = list.parentElement ? list.parentElement.clientWidth : 0
    if (!available) return
    const expanded = rows.every((row) => naturalRowWidth(row) <= available)
    list.classList.toggle('is-compact', !expanded)
    if (expanded) return
    // A font wider than the collapsed row expects still steps the type down to the
    // readable data floor instead of clipping a symbol into an ellipsis. The symbol
    // is the row's only flexible column, so it is where a shortage shows up.
    for (const row of rows) {
      const symbol = row.querySelector('.futu-sym')
      if (!symbol || !isClipped(symbol)) continue
      let size = fontSizeOf(row)
      if (size === null) continue
      let guard = 20
      while (size > DATA_FONT_FLOOR && isClipped(symbol) && guard-- > 0) {
        size -= 1
        row.style.fontSize = `${size}px`
      }
    }
  }

  function writeRows(list, positions) {
    const html = positions.map(holdingRow).join('')
    if (list.innerHTML === html) return
    const scroll = list.scrollTop
    list.innerHTML = html
    list.scrollTop = scroll
  }

  function render(el, refs, reading) {
    const positions = Array.isArray(reading?.snapshot?.positions) ? reading.snapshot.positions.filter(position => position && typeof position.code === 'string') : []
    const state = reading?.state || 'syncing'
    if (state === 'live' && reading.snapshot && !Array.isArray(reading.snapshot.positions)) {
      writeText(refs.value, '--')
      refs.value.className = 'w-state futu-ratio'
      refs.value.setAttribute('aria-label', 'Holdings unavailable')
      writeText(refs.detail, 'Malformed holdings')
      refs.rows.innerHTML = ''
      return
    }
    if (state === 'live' && reading.snapshot) {
      const leaders = positions.slice(0, maxRows(el))
      if (!leaders.length) {
        writeText(refs.value, '--')
        refs.value.className = 'w-state futu-ratio'
        refs.value.setAttribute('aria-label', 'No positions')
        writeText(refs.detail, 'No positions')
        refs.rows.innerHTML = ''
        return
      }
      const plRatio = reading.snapshot.totals?.plRatio
      writeText(refs.value, formatRatio(plRatio))
      refs.value.className = `w-state futu-ratio is-${direction(plRatio)}`
      refs.value.setAttribute('aria-label', `Today ${formatRatio(plRatio)}`)
      refs.rows.className = 'futu-holdings'
      writeRows(refs.rows, leaders)
      writeText(refs.detail, el.dataset?.expanded === 'true' ? (formatTime(reading.updatedAt) ? `Updated ${formatTime(reading.updatedAt)}` : '') : `Today${shownCountLabel(reading, leaders.length)}`)
      if (el.dataset?.expanded !== 'true') fitRows(refs.rows)
      fitValue(refs.value)
      return
    }
    writeText(refs.value, '--')
    refs.value.className = 'w-state futu-ratio'
    refs.value.setAttribute('aria-label', 'Holdings unavailable')
    refs.rows.className = 'futu-holdings'
    if (positions.length) {
      const stale = reading.snapshot
      const plRatio = stale.totals?.plRatio
      writeText(refs.value, formatRatio(plRatio))
      refs.value.className = `w-state futu-ratio is-stale is-${direction(plRatio)}`
      refs.value.setAttribute('aria-label', `Stale holdings ${formatRatio(plRatio)}`)
      refs.rows.className = 'futu-holdings is-stale'
      const staleRows = positions.slice(0, maxRows(el))
      writeRows(refs.rows, staleRows)
      writeText(refs.detail, `Stale · ${formatTime(reading.updatedAt)}${shownCountLabel({ snapshot: stale }, staleRows.length)}`)
      if (el.dataset?.expanded !== 'true') fitRows(refs.rows)
      fitValue(refs.value)
      return
    }
    refs.rows.innerHTML = ''
    // Captions stay short enough to render whole in the narrowest cell the Shell
    // computes, so a state is never announced as an ellipsis.
    if (state === 'unconfigured') writeText(refs.detail, 'Not configured')
    else if (state === 'needs-auth') writeText(refs.detail, 'Unlock trade')
    else if (state === 'unavailable' || state === 'live') writeText(refs.detail, 'Unavailable')
    else writeText(refs.detail, 'Syncing')
  }

  function mountHoldings(el, ctx, expanded = false) {
      el.dataset.expanded = String(expanded)
      el.innerHTML = `
        <div class="widget-signal futu-body odk-col ${expanded ? 'runtime-app futu-app' : ''}">
          ${expanded ? '<header class="reading-head"><h2>Daily return</h2><button class="button-pill button-secondary reading-refresh" type="button">Refresh</button></header>' : '<div class="futu-name" id="futu-name">Holdings</div>'}
          <div class="w-state futu-ratio" id="futu-value" aria-label="Holdings unavailable">--</div>
          ${expanded ? '<div class="futu-columns" aria-hidden="true"><span>Symbol</span><span>Price</span><span>Today</span></div>' : ''}
          <ul class="futu-holdings" id="futu-rows" ${expanded ? 'tabindex="0" aria-label="All holdings"' : ''}></ul>
          <div class="futu-note" id="futu-detail" ${expanded ? 'role="status"' : ''}>Syncing holdings</div>
        </div>`
      const refs = { value: el.querySelector('#futu-value'), detail: el.querySelector('#futu-detail'), rows: el.querySelector('#futu-rows') }
      let active = true
      ctx.trackCleanup?.(() => { active = false })
      const refreshButton = expanded ? el.querySelector('.reading-refresh') : null
      let pending = false
      let lastReading = null
      render(el, refs, null)
      const refresh = async () => {
        if (!active || pending) return
        pending = true
        if (refreshButton) refreshButton.disabled = true
        try {
          const reading = root.odkPlatform?.getFutuHoldings
            ? await root.odkPlatform.getFutuHoldings({ service: 'futu-poller' }) : { state: 'unconfigured' }
          if (!active) return
          lastReading = reading
          render(el, refs, reading)
        } catch {
          if (!active) return
          lastReading = { ...lastReading, state: 'unavailable' }
          render(el, refs, lastReading)
        } finally {
          pending = false
          if (active && refreshButton) refreshButton.disabled = false
        }
      }
      refreshButton?.addEventListener('click', refresh)
      refresh()
      const refit = () => { if (active) fitValue(el.querySelector('#futu-value')) }
      let refitQueued = false
      const relayout = () => { if (!active) return; if (lastReading) render(el, refs, lastReading); else refit() }
      const queueRefit = () => {
        if (refitQueued || typeof requestAnimationFrame !== 'function') { relayout(); return }
        refitQueued = true
        requestAnimationFrame(() => { refitQueued = false; relayout() })
      }
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(queueRefit)
        observer.observe(el)
        ctx.trackCleanup?.(() => observer.disconnect())
      }
      if (typeof document !== 'undefined' && document.fonts?.ready?.then) {
        document.fonts.ready.then(refit).catch(() => {})
      }
      let tickCount = 0
      ctx.onTick(() => {
        tickCount = (tickCount + 1) % REFRESH_EVERY_TICKS
        if (tickCount === 1) refresh()
      })
  }

  root.odkPlugins.register({
    id: 'odk.tile.futu',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    css: 'plugins/futu.css',
    app: 'Futu holdings',
    state: 'Syncing',
    interaction: 'display-only',
    opensApp: 'futu',
    mount: mountHoldings,
  })
  root.odkPlugins.register({
    id: 'odk.app.futu', manifest: { schemaVersion: 1 }, kind: 'app', appId: 'futu',
    app: 'Futu holdings', name: 'Futu holdings', appKind: 'ui', source: 'builtin', capabilities: [],
    css: 'plugins/futu.css',
    mount(el, ctx) { mountHoldings(el, ctx, true) },
  })
})(typeof window !== 'undefined' ? window : globalThis)
