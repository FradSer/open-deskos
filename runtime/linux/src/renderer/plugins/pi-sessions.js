;
(function (root) {
  'use strict'

  const FILTERS = ['working', 'all', 'settled', 'exited']
  const FILTER_DISPLAY_ORDER = ['all', 'working', 'settled', 'exited']
  const FILTER_LABELS = { working: 'WORKING', all: 'ALL', settled: 'SETTLED', exited: 'EXITED' }
  const FILTER_TITLES = { working: 'Working', all: 'All', settled: 'Settled', exited: 'Exited' }
  const DEFAULT_FILTER = 'working'
  const ACTION_FILTER = 'pi-session-filter'
  const ACTION_OVERVIEW = 'pi-session-overview'
  const SCROLL_STEP_PX = 140
  const SCAN_TICK_INTERVAL = 5

  function escapeHtml(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function normalizeInline(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : ''
  }

  function renderMarkdownInline(text) {
    if (!text || typeof text !== 'string') return ''
    let escaped = escapeHtml(text)
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="pi-inline-code">$1</code>')
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>')
    escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]*|$)/g, '$1<em>$2</em>$3')
    return escaped
  }

  function parseSkillTag(text) {
    if (!text || typeof text !== 'string') return null
    const match = text.match(/<skill\s+name="([^"]+)"[^>]*>/)
    if (!match) return null
    const endTag = '</skill>'
    const endIndex = text.indexOf(endTag)
    const prompt = endIndex !== -1 ? text.slice(endIndex + endTag.length).trim() : ''
    return { skillName: match[1], prompt }
  }

  // A goal that invoked a skill reads as the default TUI reads it: a bracketed
  // skill name instead of the raw tag.
  function renderSkillTaggedText(text) {
    const normalized = normalizeInline(text)
    const skill = parseSkillTag(normalized)
    if (!skill) return renderMarkdownInline(normalized)
    const prompt = skill.prompt ? ` <span class="pi-skill-prompt">${renderMarkdownInline(skill.prompt)}</span>` : ''
    return `<span class="pi-skill-tag"><strong class="pi-skill-bracket">[skill]</strong> <span class="pi-skill-name">${escapeHtml(skill.skillName)}</span></span>${prompt}`
  }

  const renderGoalHtml = renderSkillTaggedText
  const renderActivityHtml = renderSkillTaggedText

  function formatElapsed(timestamp, now = Date.now()) {
    const startedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp)
    if (!Number.isFinite(startedAt) || startedAt <= 0) return 'Elapsed unavailable'
    const totalMinutes = Math.floor(Math.max(0, now - startedAt) / 60000)
    if (totalMinutes < 1) return '<1m elapsed'
    if (totalMinutes < 60) return `${totalMinutes}m elapsed`
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}h ${minutes}m elapsed` : `${hours}h elapsed`
  }

  function sessionKey(session) {
    return JSON.stringify([session.uuid || session.sessionId || session.id || '', session.pid || '', session.startedAt || ''])
  }

  function createSessionOrder() {
    const workspaces = new Map()
    const sessions = new Map()
    return (items) => {
      for (const session of items) {
        const workspace = session.cwd || session.workspaceName || 'Default'
        if (!workspaces.has(workspace)) workspaces.set(workspace, workspaces.size)
        const key = sessionKey(session)
        if (!sessions.has(key)) sessions.set(key, sessions.size)
      }
      return [...items].sort((a, b) => {
        if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
        return workspaces.get(a.cwd || a.workspaceName || 'Default') - workspaces.get(b.cwd || b.workspaceName || 'Default') ||
          sessions.get(sessionKey(a)) - sessions.get(sessionKey(b))
      })
    }
  }

  function matchesFilter(session, filter) {
    if (filter === 'all') return true
    return session.status === (filter === 'working' ? 'running' : filter)
  }

  function sessionSet(scan, filter) {
    const sessions = Array.isArray(scan?.sessions) ? scan.sessions : []
    return sessions.filter((session) => matchesFilter(session, filter))
  }

  function nextFilter(filter) {
    return FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]
  }

  function statusLabel(status) {
    return status === 'running' ? 'Working' : String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1)
  }

  function workspaceLabel(session) {
    return session.workspaceName || session.cwd || 'Unknown workspace'
  }

  function overviewCellHtml(session, selectedKey) {
    const key = sessionKey(session)
    const isSelected = key === selectedKey
    return `<button type="button" class="pi-overview-cell${isSelected ? ' is-selected' : ''}" data-session-key="${escapeHtml(key)}" aria-pressed="${isSelected}">
      <span class="pi-overview-name">${escapeHtml(workspaceLabel(session))}</span>
      <span class="pi-overview-state">${escapeHtml(statusLabel(session.status))}</span>
      <span class="pi-overview-activity">${escapeHtml(session.activity || session.latestGoal || 'No activity reported')}</span>
    </button>`
  }

  const EVENT_NOTE = {
    'session-log-missing': 'No session log is available for this session.',
    'session-log-unreadable': 'This session log could not be read.',
    'session-identity-required': 'This session has no readable identity.',
  }

  // Session Events are read from this machine's own session logs, so a source
  // that keeps them elsewhere states that instead of showing nothing.
  function eventNote(reason, sourceLabel) {
    if (reason === 'source-unsupported') return `Session events are unavailable for ${sourceLabel}.`
    return EVENT_NOTE[reason] || 'Session events are unavailable.'
  }

  function lifecycleFor(mount) {
    return {
      install() {}, enable() {}, mount, start() {}, pause() {}, resume() {},
      stop() {}, unmount(el) { el.replaceChildren() }, disable() {}, uninstall() {},
    }
  }

  /* ---------------------------------------------------------
   * Tile Widget: odk.tile.pi-sessions
   * --------------------------------------------------------- */
  root.odkPlugins.register({
    id: 'odk.tile.pi-sessions',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Pi Sessions',
    state: 'Live',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="pi-widget-body odk-col items-center justify-center w-full">
          <div class="pi-widget-metric-row odk-row items-baseline justify-center w-full">
            <span class="pi-widget-count">--</span>
            <span class="pi-widget-unit" hidden></span>
          </div>
          <div class="pi-widget-live-tag odk-row items-center gap-1">
            <span class="pi-indicator-dot pi-indicator-idle"></span>
            <span class="pi-widget-tag-label">IDLE</span>
          </div>
          <div class="pi-widget-context odk-col items-center w-full">
            <div class="w-state">Pi Sessions</div>
            <div class="pi-widget-activity" hidden></div>
            <span class="pi-widget-summary">0 workspaces</span>
          </div>
        </div>`

      const countEl = el.querySelector('.pi-widget-count')
      const dotEl = el.querySelector('.pi-indicator-dot')
      const tagLabelEl = el.querySelector('.pi-widget-tag-label')
      const summaryEl = el.querySelector('.pi-widget-summary')
      const stateEl = el.querySelector('.w-state')
      const activityEl = el.querySelector('.pi-widget-activity')

      let tickCount = 0

      const refresh = async () => {
        try {
          const res = typeof root.odkPlatform?.getPiSessions === 'function'
            ? await root.odkPlatform.getPiSessions()
            : null
          if (!res || res.ok === false) {
            countEl.textContent = '--'
            dotEl.className = 'pi-indicator-dot pi-indicator-idle'
            tagLabelEl.textContent = 'OFFLINE'
            tagLabelEl.className = 'pi-widget-tag-label'
            summaryEl.textContent = res?.source?.label || 'Scanner unavailable'
            stateEl.textContent = 'Unavailable'
            if (activityEl) {
              activityEl.hidden = true
              activityEl.textContent = ''
            }
            return
          }
          const running = res?.summary?.running ?? 0
          const total = res?.summary?.total ?? 0
          const wsCount = res?.summary?.workspacesCount ?? 0

          countEl.textContent = String(running)
          summaryEl.textContent = `${res.source?.label ? `${res.source.label} · ` : ''}${wsCount} workspace${wsCount !== 1 ? 's' : ''} · ${total} total`

          const activeSession = res.sessions?.find((session) => session.status === 'running')

          if (running > 0) {
            dotEl.className = 'pi-indicator-dot pi-indicator-running'
            tagLabelEl.textContent = 'Working...'
            tagLabelEl.className = 'pi-widget-tag-label text-odk-green'

            if (activeSession && (activeSession.latestGoal || activeSession.activity)) {
              if (stateEl) stateEl.innerHTML = renderGoalHtml(activeSession.latestGoal || `${running} working`)
              if (activityEl) {
                activityEl.hidden = false
                activityEl.innerHTML = `<span class="pi-pulse-dot"></span>${renderActivityHtml(activeSession.activity || 'Working...')}`
              }
            } else {
              if (stateEl) stateEl.textContent = `${running} working`
              if (activityEl) {
                activityEl.hidden = true
                activityEl.textContent = ''
              }
            }
          } else {
            dotEl.className = 'pi-indicator-dot pi-indicator-idle'
            tagLabelEl.textContent = 'IDLE'
            tagLabelEl.className = 'pi-widget-tag-label'
            if (activityEl) {
              activityEl.hidden = true
              activityEl.textContent = ''
            }

            if (total > 0 && res.sessions && res.sessions.length > 0) {
              if (stateEl) stateEl.textContent = `${total} recent`
            } else {
              if (stateEl) stateEl.textContent = 'Idle'
            }
          }
        } catch {
          countEl.textContent = '--'
          dotEl.className = 'pi-indicator-dot pi-indicator-idle'
          tagLabelEl.textContent = 'ERROR'
          tagLabelEl.className = 'pi-widget-tag-label'
          summaryEl.textContent = 'Scan failed'
          stateEl.textContent = 'Unavailable'
          if (activityEl) {
            activityEl.hidden = true
            activityEl.textContent = ''
          }
        }
      }

      refresh()

      if (ctx?.onTick) {
        ctx.onTick(() => {
          tickCount += 1
          if (tickCount % 3 === 0) {
            refresh()
          }
        })
      }
    },
  })

  /* ---------------------------------------------------------
   * Session Detail + Session Overview
   * --------------------------------------------------------- */
  function surfaceMarkup() {
    return `
      <div class="runtime-app pi-app-wrapper">
        <header class="app-surface-header pi-app-header">
          <div class="app-surface-heading">
            <h1 id="pi-title">Pi Sessions</h1>
          </div>
        </header>

        <p class="sr-only" id="pi-status" role="status" aria-live="polite"></p>

        <section class="pi-detail" id="pi-detail" role="region" aria-label="Session detail" tabindex="0" data-page-focus>
          <div class="pi-detail-body" id="pi-detail-body"></div>
          <div class="pi-events-host" id="pi-events-host"></div>
        </section>

        <section class="pi-overview" id="pi-overview" aria-label="Session overview" hidden>
          <div class="pi-overview-header">
            <p class="pi-overview-summary" id="pi-overview-summary"></p>
            <div class="pi-filter-group" role="group" aria-label="Session filter">
              ${FILTER_DISPLAY_ORDER.map((value) => `<button type="button" class="pi-filter-btn" data-filter="${value}">${FILTER_TITLES[value]}</button>`).join('')}
            </div>
          </div>
          <div class="pi-overview-grid" id="pi-overview-grid"></div>
        </section>
      </div>`
  }

  function renderIdentity(session, selectedIndex, count) {
    return `
      <div class="pi-detail-header">
        <div class="pi-detail-identity">
          <span class="pi-status-badge pi-status-${escapeHtml(session.status)}">
            ${session.status === 'running' ? '<span class="pi-pulse-dot"></span>' : ''}${statusLabel(session.status)}
          </span>
          <span class="pi-ws-title">${escapeHtml(workspaceLabel(session))}</span>
          <span class="pi-card-time">${formatElapsed(session.startedAt)}</span>
          <span class="pi-detail-position">${selectedIndex + 1} / ${count}</span>
        </div>
        <button type="button" class="pi-detail-overview-btn" id="pi-overview-open">All sessions</button>
      </div>
      <p class="pi-goal-text">${renderGoalHtml(session.latestGoal || 'No goal stated')}</p>
      <p class="pi-activity-text">${session.status === 'running' ? '<span class="pi-pulse-dot"></span>' : ''}${renderActivityHtml(session.activity || (session.status === 'running' ? 'Working...' : session.recap || 'Settled'))}</p>`
  }

  function renderEvent(event) {
    return `<li class="pi-event pi-event-${escapeHtml(event.kind)}">
      <span class="pi-event-kind">${escapeHtml(event.kind)}</span>
      <span class="pi-event-text">${escapeHtml(event.text)}</span>
    </li>`
  }

  function renderEventList(state, sourceLabel) {
    if (state.reason === 'loading') return '<p class="pi-detail-note">Reading session events...</p>'
    if (!state.ok) return `<p class="pi-detail-note">${escapeHtml(eventNote(state.reason, sourceLabel))}</p>`
    if (state.events.length === 0) return '<p class="pi-detail-note">No session events recorded yet.</p>'
    return `<ol class="pi-events" id="pi-events">${state.events.map(renderEvent).join('')}</ol>`
  }

  /* ---------------------------------------------------------
   * Selection and grid arithmetic (pure)
   * --------------------------------------------------------- */

  // Selection is remembered by session identity: a new session never takes the
  // selection, and a selection that leaves the set hands over to the neighbour
  // in the direction last requested.
  function selectionIndex(set, selectedKey, hintedIndex, direction) {
    const found = set.findIndex((session) => sessionKey(session) === selectedKey)
    if (found >= 0) return found
    const hinted = direction === 'left' ? hintedIndex - 1 : hintedIndex
    return steppedIndex(hinted, 0, set.length)
  }

  function steppedIndex(index, step, length) {
    return Math.min(Math.max(index + step, 0), Math.max(length - 1, 0))
  }

  function gridColumnsOf(cells) {
    if (cells.length < 2) return 1
    const firstTop = cells[0].offsetTop
    const nextRow = cells.findIndex((cell) => cell.offsetTop !== firstTop)
    return nextRow === -1 ? cells.length : nextRow
  }

  // One explicit mapping from Remote input to the page's own action, so the
  // routing is a decision rather than a cascade.
  const PAGE_INPUT = {
    closed: { primary: 'open-overview', up: 'scroll-up', down: 'scroll-down', left: 'previous-session', right: 'next-session' },
    open: { back: 'close-overview', primary: 'choose-cell', left: 'cell-left', right: 'cell-right', up: 'cell-up', down: 'cell-down' },
  }

  function pageInputAction(input, overviewIsOpen) {
    return PAGE_INPUT[overviewIsOpen ? 'open' : 'closed'][input] || 'ignore'
  }

  // The Pi Sessions page's own copy for the states it can be in.
  function emptyCopy({ scan, filterTitle, setSize, sourceLabel }) {
    if (scan === null) return 'Loading Pi sessions...'
    if (scan.ok === false) return `${sourceLabel || 'Pi sessions'} unavailable. Retrying automatically.`
    if (setSize === 0) return `No session matches ${filterTitle}.`
    return 'No session selected.'
  }

  function announcement(session, selectedIndex, setSize, fallback) {
    return session
      ? `Session ${selectedIndex + 1} of ${setSize}: ${workspaceLabel(session)}, ${statusLabel(session.status).toLowerCase()}.`
      : fallback
  }

  function detailView({ detailEl, bodyEl, eventsHostEl }) {
    let paintedHtml = null
    let hasSession = false

    const paint = (state, sourceLabel) => {
      const html = hasSession ? renderEventList(state, sourceLabel) : ''
      if (html === paintedHtml) return
      const scrollTop = detailEl.scrollTop
      eventsHostEl.innerHTML = html
      paintedHtml = html
      detailEl.scrollTop = scrollTop
    }

    return {
      render(session, selectedIndex, count, state, sourceLabel, onOpenOverview) {
        hasSession = Boolean(session)
        paintedHtml = null
        if (!session) {
          bodyEl.innerHTML = ''
          eventsHostEl.innerHTML = ''
          return
        }
        bodyEl.innerHTML = renderIdentity(session, selectedIndex, count)
        bodyEl.querySelector('#pi-overview-open')?.addEventListener('click', onOpenOverview)
        paint(state, sourceLabel)
      },
      paint,
      restart() {
        paintedHtml = null
        detailEl.scrollTop = 0
      },
      scroll(input) {
        detailEl.scrollTop += input === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX
      },
      focus() {
        detailEl.focus({ preventScroll: true })
      },
    }
  }

  function overviewView({ overviewEl, summaryEl, gridEl }) {
    return {
      render({ set, filterTitle, sourceLabel, unavailable, selectedKey, emptyCopy, onChoose }) {
        summaryEl.textContent = unavailable
          ? `${sourceLabel || 'Pi sessions'} unavailable`
          : `${set.length} ${filterTitle.toLowerCase()} · ${sourceLabel || 'Pi sessions'}`
        gridEl.innerHTML = set.length === 0
          ? `<p class="pi-empty-state">${escapeHtml(emptyCopy)}</p>`
          : set.map((session) => overviewCellHtml(session, selectedKey)).join('')
        for (const cell of gridEl.querySelectorAll('.pi-overview-cell')) {
          cell.addEventListener('click', () => onChoose(cell.dataset.sessionKey))
        }
      },
      cells() {
        return [...gridEl.querySelectorAll('.pi-overview-cell')]
      },
      columns() {
        return gridColumnsOf(this.cells())
      },
      focusSelected(selectedKey) {
        this.cells().find((cell) => cell.dataset.sessionKey === selectedKey)?.focus()
      },
      focusOffset(selectedKey, offset) {
        const cells = this.cells()
        if (cells.length === 0) return
        const active = cells.findIndex((cell) => cell === document.activeElement)
        const selected = cells.findIndex((cell) => cell.dataset.sessionKey === selectedKey)
        const from = active === -1 ? Math.max(selected, 0) : active
        cells[steppedIndex(from, offset, cells.length)]?.focus()
      },
      show(visible) {
        overviewEl.hidden = !visible
      },
      isOpen() {
        return !overviewEl.hidden
      },
    }
  }

  /* ---------------------------------------------------------
   * Fullscreen App / Page: odk.app.pi-sessions
   * --------------------------------------------------------- */
  root.odkPlugins.register({
    id: 'odk.app.pi-sessions',
    manifest: { schemaVersion: 1 },
    kind: 'app',
    appId: 'pi-sessions',
    app: 'Pi Sessions',
    name: 'Pi Sessions',
    appKind: 'ui',
    source: 'builtin',
    capabilities: [],
    lifecycle: lifecycleFor((el, ctx) => {
      el.innerHTML = surfaceMarkup()

      const detailEl = el.querySelector('#pi-detail')
      const bodyEl = el.querySelector('#pi-detail-body')
      const statusEl = el.querySelector('#pi-status')
      const filterBtns = [...el.querySelectorAll('.pi-filter-btn')]
      const detail = detailView({ detailEl, bodyEl, eventsHostEl: el.querySelector('#pi-events-host') })
      const overview = overviewView({
        overviewEl: el.querySelector('#pi-overview'),
        summaryEl: el.querySelector('#pi-overview-summary'),
        gridEl: el.querySelector('#pi-overview-grid'),
      })

      let scan = null
      let filter = DEFAULT_FILTER
      let selectedKey = null
      let selectedIndex = 0
      let lastDirection = 'right'
      let eventsState = { reason: 'loading', ok: false, events: [] }
      let renderToken = 0
      let tickCount = 0
      const orderSessions = createSessionOrder()

      const currentSet = () => sessionSet(scan, filter)
      const selected = () => currentSet().find((session) => sessionKey(session) === selectedKey) || null
      const sourceLabel = () => scan?.source?.label || ''
      const remoteSource = () => scan?.source?.kind === 'ssh'

      function pageCopy() {
        return emptyCopy({
          scan,
          filterTitle: FILTER_TITLES[filter],
          setSize: currentSet().length,
          sourceLabel: sourceLabel(),
        })
      }

      function publishRemote() {
        ctx?.publishPageRemote?.(el, {
          actions: [
            { id: ACTION_FILTER, label: FILTER_LABELS[filter] },
            { id: ACTION_OVERVIEW, label: 'OVERVIEW' },
          ],
          focus: 'items',
        })
      }

      function announce() {
        statusEl.textContent = announcement(selected(), selectedIndex, currentSet().length, pageCopy())
      }

      function renderFilterButtons() {
        for (const button of filterBtns) {
          const active = button.dataset.filter === filter
          button.classList.toggle('active', active)
          button.setAttribute('aria-pressed', String(active))
        }
      }

      function renderDetail() {
        const session = selected()
        detail.render(session, selectedIndex, currentSet().length, eventsState, sourceLabel(), () => setOverview(true))
        if (!session) bodyEl.innerHTML = `<p class="pi-empty-state">${escapeHtml(pageCopy())}</p>`
      }

      function renderOverview() {
        overview.render({
          set: currentSet(),
          filterTitle: FILTER_TITLES[filter],
          sourceLabel: sourceLabel(),
          unavailable: scan?.ok === false,
          selectedKey,
          emptyCopy: pageCopy(),
          onChoose: chooseCell,
        })
      }

      function renderAll() {
        renderFilterButtons()
        renderDetail()
        renderOverview()
        announce()
      }

      function reconcileSelection() {
        const set = currentSet()
        if (set.length === 0) {
          selectedKey = null
          selectedIndex = 0
          return
        }
        selectedIndex = selectionIndex(set, selectedKey, selectedIndex, lastDirection)
        selectedKey = sessionKey(set[selectedIndex])
      }

      function setSelection(index, direction = lastDirection) {
        const set = currentSet()
        const target = set[steppedIndex(index, 0, set.length)]
        if (!target) return
        const nextKey = sessionKey(target)
        if (nextKey === selectedKey) return
        lastDirection = direction
        selectedIndex = steppedIndex(index, 0, set.length)
        selectedKey = nextKey
        eventsState = { reason: 'loading', ok: false, events: [] }
        detail.restart()
        renderDetail()
        renderOverview()
        announce()
        loadEvents()
      }

      function moveSelection(step) {
        const set = currentSet()
        if (set.length === 0) return
        setSelection(steppedIndex(selectedIndex, step, set.length), step < 0 ? 'left' : 'right')
        overview.focusSelected(selectedKey)
      }

      function chooseCell(key) {
        const index = currentSet().findIndex((session) => sessionKey(session) === key)
        if (index < 0) return
        setSelection(index)
        setOverview(false)
      }

      function setOverview(open) {
        const next = typeof open === 'boolean' ? open : !overview.isOpen()
        if (next === overview.isOpen()) return
        overview.show(next)
        detailEl.hidden = next
        if (next) {
          renderOverview()
          overview.focusSelected(selectedKey)
        } else {
          detail.focus()
        }
      }

      function setFilter(value) {
        if (!FILTERS.includes(value)) return
        filter = value
        reconcileSelection()
        eventsState = { reason: 'loading', ok: false, events: [] }
        detail.restart()
        renderAll()
        publishRemote()
        loadEvents()
      }

      async function loadEvents() {
        const session = selected()
        const token = ++renderToken
        if (!session) {
          eventsState = { reason: 'loading', ok: false, events: [] }
          detail.paint(eventsState, sourceLabel())
          return
        }
        if (remoteSource()) {
          eventsState = { reason: 'source-unsupported', ok: false, events: [] }
          detail.paint(eventsState, sourceLabel())
          return
        }
        try {
          const res = typeof root.odkPlatform?.getPiSessionEvents === 'function'
            ? await root.odkPlatform.getPiSessionEvents({ cwd: session.cwd, sessionId: session.sessionId || session.uuid })
            : null
          if (token !== renderToken) return
          eventsState = res?.ok
            ? { reason: '', ok: true, events: res.events || [] }
            : { reason: res?.reason || 'session-log-missing', ok: false, events: [] }
        } catch {
          if (token !== renderToken) return
          eventsState = { reason: 'session-log-unreadable', ok: false, events: [] }
        }
        detail.paint(eventsState, sourceLabel())
      }

      async function load() {
        const token = ++renderToken
        try {
          const response = typeof root.odkPlatform?.getPiSessions === 'function'
            ? await root.odkPlatform.getPiSessions()
            : null
          // A missing or non-object answer is unavailable, never an empty
          // successful scan.
          scan = response && typeof response === 'object' ? response : { ok: false, source: scan?.source || null }
        } catch {
          scan = { ok: false, source: scan?.source || null }
        }
        if (token !== renderToken) return
        if (scan?.ok !== false && Array.isArray(scan?.sessions)) {
          scan = { ...scan, sessions: orderSessions(scan.sessions) }
        }
        reconcileSelection()
        renderAll()
        // Every completed scan re-reads the selected session's events, so a
        // changed source, a changed session, or new activity is never stale.
        loadEvents()
      }

      function onRemoteAction(event) {
        const actionId = event?.detail
        if (actionId === ACTION_FILTER) setFilter(nextFilter(filter))
        else if (actionId === ACTION_OVERVIEW) setOverview()
      }

      function onRemotePageInput(event) {
        const action = pageInputAction(event?.detail?.input, overview.isOpen())
        if (action === 'close-overview') setOverview(false)
        else if (action === 'open-overview') setOverview(true)
        else if (action === 'choose-cell') {
          const cell = overview.cells().find((candidate) => candidate === document.activeElement)
          if (cell) chooseCell(cell.dataset.sessionKey)
        } else if (action === 'cell-left') overview.focusOffset(selectedKey, -1)
        else if (action === 'cell-right') overview.focusOffset(selectedKey, 1)
        else if (action === 'cell-up') overview.focusOffset(selectedKey, -overview.columns())
        else if (action === 'cell-down') overview.focusOffset(selectedKey, overview.columns())
        else if (action === 'scroll-up') detail.scroll('up')
        else if (action === 'scroll-down') detail.scroll('down')
        else if (action === 'previous-session') moveSelection(-1)
        else if (action === 'next-session') moveSelection(1)
      }

      function onKeydown(event) {
        if (event.key !== 'Escape' || !overview.isOpen()) return
        event.stopPropagation()
        setOverview(false)
      }

      function onPageShown() {
        load()
      }

      for (const button of filterBtns) {
        button.addEventListener('click', () => setFilter(button.dataset.filter))
      }

      el.addEventListener('odk-remote-action', onRemoteAction)
      el.addEventListener('odk-remote-page-input', onRemotePageInput)
      el.addEventListener('odk-page-shown', onPageShown)
      el.addEventListener('keydown', onKeydown)
      ctx?.trackCleanup?.(() => {
        el.removeEventListener('odk-remote-action', onRemoteAction)
        el.removeEventListener('odk-remote-page-input', onRemotePageInput)
        el.removeEventListener('odk-page-shown', onPageShown)
        el.removeEventListener('keydown', onKeydown)
        ctx?.publishPageRemote?.(el, null)
      })

      publishRemote()
      renderAll()

      if (ctx?.onTick) {
        ctx.onTick(() => {
          tickCount += 1
          if (tickCount % SCAN_TICK_INTERVAL === 0) load()
        })
      }

      load()
    }),
  })
  // The page is the direct interactive surface; the Home tile remains a
  // display-only summary and never opens an App.
  root.odkPlugins.register({
    id: 'odk.page.pi-sessions',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'app',
    mount(el, ctx) {
      const app = root.odkPlugins.get('odk.app.pi-sessions')
      app.lifecycle.mount.call(app, el, ctx)
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
