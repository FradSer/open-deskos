;
(function (root) {
  'use strict'

  // Native Pi's own working indicator: ten braille frames at 80ms, taken from
  // its Loader component. The desk reproduces the animation it can observe,
  // never a state Pi did not report.
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const SPINNER_INTERVAL_MS = 80
  const SCROLL_STEP_PX = 140
  const SCAN_TICK_INTERVAL = 5
  const LIVE_STATUSES = new Set(['running', 'settled'])
  // The filter belongs to the Session Overview, not to the Session Detail: the
  // page lands on the live set, and history is one deliberate press away.
  const FILTERS = ['live', 'working', 'idle', 'exited', 'all']
  const FILTER_LABELS = { live: 'Live', working: 'Working', idle: 'Idle', exited: 'Exited', all: 'All' }
  const DEFAULT_FILTER = 'live'
  const ACTION_FILTER = 'pi-session-filter'

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
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
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
        if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1
        if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
        return workspaces.get(a.cwd || a.workspaceName || 'Default') - workspaces.get(b.cwd || b.workspaceName || 'Default') ||
          sessions.get(sessionKey(a)) - sessions.get(sessionKey(b))
      })
    }
  }

  // Only a Pi process that is still running is live; an exited session is
  // history, and history is not what the page shows as current work.
  function isLive(session) {
    return LIVE_STATUSES.has(session.status)
  }

  function matchesFilter(session, filter) {
    if (filter === 'all') return true
    if (filter === 'live') return isLive(session)
    if (filter === 'exited') return !isLive(session)
    return session.status === (filter === 'working' ? 'running' : filter === 'idle' ? 'settled' : filter)
  }

  function filterTitle(filter) {
    return FILTER_LABELS[filter] || 'Pi'
  }

  function nextFilter(filter) {
    return FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length] || DEFAULT_FILTER
  }

  function sessionSet(scan, filter = DEFAULT_FILTER) {
    const sessions = scan?.ok !== false && Array.isArray(scan?.sessions) ? scan.sessions : []
    return sessions.filter((session) => matchesFilter(session, filter))
  }

  function statusLabel(status) {
    if (status === 'running') return 'Working...'
    if (status === 'settled') return 'Idle'
    return String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1)
  }

  function workspaceLabel(session) {
    return session.workspaceName || session.cwd || 'Unknown workspace'
  }

  function sessionPath(session) {
    return session.cwd || session.workspaceName || 'Unknown directory'
  }

  function overviewGoal(session) {
    const text = normalizeInline(session.latestGoal)
    const skill = parseSkillTag(text)
    return skill ? `[skill] ${skill.skillName}${skill.prompt ? ` ${skill.prompt}` : ''}` : text || 'No goal stated'
  }

  // The state Pi is reporting right now, rendered with Pi's own indicator.
  function stateMarkup(session) {
    const working = session.status === 'running'
    const spinner = working
      ? `<span class="pi-spinner" data-pi-spinner aria-hidden="true">${SPINNER_FRAMES[0]}</span>`
      : ''
    return `${spinner}<span class="pi-state-text">${escapeHtml(statusLabel(session.status))}</span>`
  }

  function validScan(response) {
    return response && typeof response === 'object' && response.ok !== false &&
      Array.isArray(response.sessions) && response.sessions.every((session) =>
        session && typeof session === 'object' && ['running', 'settled', 'exited'].includes(session.status))
  }

  const EVENT_NOTE = {
    'no-reported-events': 'This session has not reported any events yet.',
    'session-log-missing': 'No session log is available for this session.',
    'session-log-unreadable': 'This session log could not be read.',
    'session-log-tail-limit': 'Recent output exceeds the 2 MiB log-reading limit. Read the full result in Pi.',
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
          const live = sessionSet(res, 'live').length
          const wsCount = res?.summary?.workspacesCount ?? 0

          countEl.textContent = String(running)
          summaryEl.textContent = `${res.source?.label ? `${res.source.label} · ` : ''}${wsCount} workspace${wsCount !== 1 ? 's' : ''} · ${live} live`

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
            if (stateEl) stateEl.textContent = live > 0 ? `${live} idle` : 'Idle'
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
   * Session Overview (the page) + Session Detail (one session)
   * --------------------------------------------------------- */

  // The page carries no title and no controls: it states the live Pi state and
  // nothing else. The Overview is the page's landing view, and Back, Escape, or
  // any primary input returns to it.
  function surfaceMarkup() {
    return `
      <div class="runtime-app pi-app-wrapper">
        <header class="app-surface-header pi-app-header">
          <div class="app-surface-heading">
            <h1 id="pi-title"><span class="pi-spinner" data-pi-spinner aria-hidden="true" hidden>${SPINNER_FRAMES[0]}</span><span id="pi-title-text">Pi Sessions</span></h1>
            <p class="pi-view-subtitle" id="pi-view-subtitle"></p>
          </div>
          <p class="pi-view-facts" id="pi-view-facts"></p>
        </header>

        <p class="sr-only" id="pi-status" role="status" aria-live="polite"></p>

        <div class="pi-main">
          <section class="pi-detail" id="pi-detail" role="region" aria-label="Session detail" tabindex="0" data-page-focus>
            <div class="pi-detail-body" id="pi-detail-body"></div>
            <div class="pi-events-host" id="pi-events-host"></div>
          </section>

          <section class="pi-overview" id="pi-overview" role="region" aria-label="Session overview">
            <div class="pi-overview-filters" id="pi-overview-filters" role="group" aria-label="Session status filter">
              ${FILTERS.map((value) => `<button type="button" class="pi-filter-btn" data-filter="${value}"><span>${FILTER_LABELS[value]}</span><span class="pi-filter-count" aria-hidden="true">--</span></button>`).join('')}
            </div>
            <div class="pi-overview-list" id="pi-overview-list"></div>
          </section>
        </div>
      </div>`
  }

  // The detail states what Pi is doing now. Its state and directory are the
  // page title; this is the session's own reading.
  function renderIdentity(session) {
    return `<p class="pi-goal-text">${renderGoalHtml(session.latestGoal || 'No goal stated')}</p>
      <p class="pi-activity-text">${renderActivityHtml(session.activity || (session.status === 'running' ? 'Working...' : statusLabel(session.status)))}</p>`
  }

  // Pi highlights fenced code with highlight.js. Its scopes are mapped to Pi's
  // own palette in CSS, so a fence reads here the way it reads in the terminal.
  function highlightCode(code, language) {
    const highlighter = root.hljs
    if (!highlighter || typeof highlighter.getLanguage !== 'function' || typeof highlighter.highlight !== 'function') return ''
    const name = String(language || '').trim().toLowerCase()
    if (!name || !highlighter.getLanguage(name)) return ''
    try {
      // highlight.js escapes its own output, so this stays inert HTML.
      return highlighter.highlight(code, { language: name, ignoreIllegals: true }).value
    } catch {
      return ''
    }
  }

  let messageMarkdown = null
  function renderMessageMarkdown(text) {
    if (!messageMarkdown && typeof root.markdownit === 'function') {
      messageMarkdown = root.markdownit({ html: false, linkify: false, breaks: true, highlight: highlightCode })
      const escape = messageMarkdown.utils.escapeHtml
      // This remains an inspection surface: no remote assets or navigation.
      messageMarkdown.renderer.rules.link_open = (tokens, index, _options, env) => {
        env.urls.push(tokens[index].attrGet('href') || '')
        return ''
      }
      messageMarkdown.renderer.rules.link_close = (_tokens, _index, _options, env) => ` (${escape(env.urls.pop())})`
      messageMarkdown.renderer.rules.image = (tokens, index, options, env, renderer) => escape(renderer.renderInlineAsText(tokens[index].children || [], options, env))
      messageMarkdown.renderer.rules.table_open = () => '<div class="pi-result-table-scroll" role="region" aria-label="Result table" tabindex="0"><table>'
      messageMarkdown.renderer.rules.table_close = () => '</table></div>'
      // Headings belong below the page title, not parallel h1s.
      messageMarkdown.renderer.rules.heading_open = () => '<h3>'
      messageMarkdown.renderer.rules.heading_close = () => '</h3>'
    }
    if (!messageMarkdown) return `<pre class="pi-diff-block">${escapeHtml(text)}</pre>`
    return `<div class="pi-message-markdown pi-markdown">${messageMarkdown.render(text, { urls: [] })}</div>`
  }

  // A unified diff is read by line, the way Pi's own diff view colours it.
  // Detection stays conservative: a fenced body is Markdown, and a plain list
  // of "- item" lines is not a diff.
  function diffLines(text) {
    const lines = String(text || '').split('\n')
    if (lines.some((line) => /^\s*```/.test(line))) return null
    const first = lines.find((line) => line.trim().length > 0) || ''
    const opens = /^(diff --git |index |--- |\+\+\+ |@@ )/.test(first)
    const hunked = lines.some((line) => /^@@ .+ @@/.test(line))
    const added = lines.some((line) => /^\+/.test(line))
    const removed = lines.some((line) => /^-/.test(line))
    if (!hunked && !opens) return null
    return added || removed ? lines : null
  }

  function diffKind(line) {
    if (/^@@ /.test(line) || /^diff --git /.test(line) || /^index /.test(line)) return 'hunk'
    if (/^(--- |\+\+\+ )/.test(line)) return 'header'
    if (/^\+/.test(line)) return 'added'
    if (/^-/.test(line)) return 'removed'
    return 'context'
  }

  function renderDiff(text) {
    return `<pre class="pi-diff-block pi-diff">${diffLines(text).map((line) => (line.length === 0
      ? '\n'
      : `<span class="pi-diff-line pi-diff-${diffKind(line)}">${escapeHtml(line)}</span>\n`)).join('')}</pre>`
  }

  // A body is rendered the way Pi reads it: a diff by line, anything else as
  // Markdown.
  function renderBody(text) {
    return diffLines(text) ? renderDiff(text) : renderMessageMarkdown(text)
  }

  // Rendering a Markdown body is the expensive part of this page, and a scan
  // re-renders the whole stream whenever one event is appended. The rendered
  // markup depends only on the event, so it is memoized: a 300-event stream
  // parses only the events that actually changed.
  const EVENT_HTML_CACHE = new Map()
  const EVENT_HTML_CACHE_MAX = 512
  const EVENT_HTML_CACHE_MAX_BYTES = 2 * 1024 * 1024
  let eventHtmlCacheBytes = 0
  const BODY_LIMITS = { result: '64 KiB', assistant: '16 KiB', user: '8 KiB', thinking: '4 KiB', tool: '4 KiB' }

  // Every event keeps the body Pi produced, so a command, a prompt, or a result
  // reads in full within its own limit.
  function renderEvent(event) {
    const key = `${event.kind}\u0000${event.toolName || ''}\u0000${event.truncated ? 1 : 0}\u0000${event.text}`
    const cached = EVENT_HTML_CACHE.get(key)
    if (cached !== undefined) return cached.html
    const label = event.toolName
      ? `<span class="pi-result-tool">${escapeHtml(event.toolName)}</span>`
      : `<span class="pi-event-kind sr-only">${escapeHtml(event.kind)}: </span>`
    const html = `<li class="pi-event pi-event-${escapeHtml(event.kind)}">
      ${label}
      <div class="pi-event-text pi-event-body">${renderBody(event.text)}</div>
      ${event.truncated ? `<p class="pi-result-truncated">Message truncated at the ${BODY_LIMITS[event.kind] || '64 KiB'} safety limit.</p>` : ''}
    </li>`
    const bytes = new Blob([key, html]).size
    while (EVENT_HTML_CACHE.size > 0 && (EVENT_HTML_CACHE.size >= EVENT_HTML_CACHE_MAX || eventHtmlCacheBytes + bytes > EVENT_HTML_CACHE_MAX_BYTES)) {
      const oldestKey = EVENT_HTML_CACHE.keys().next().value
      const oldest = EVENT_HTML_CACHE.get(oldestKey)
      EVENT_HTML_CACHE.delete(oldestKey)
      eventHtmlCacheBytes -= oldest.bytes
    }
    if (bytes <= EVENT_HTML_CACHE_MAX_BYTES) {
      EVENT_HTML_CACHE.set(key, { html, bytes })
      eventHtmlCacheBytes += bytes
    }
    return html
  }

  function renderEventList(state, sourceLabel) {
    if (state.reason === 'loading') return '<p class="pi-detail-note">Reading session events...</p>'
    if (!state.ok) return `<p class="pi-detail-note">${escapeHtml(eventNote(state.reason, sourceLabel))}</p>`
    if (state.events.length === 0) return '<p class="pi-detail-note">No session events recorded yet.</p>'
    const truncatedNote = state.truncated
      ? '<p class="pi-detail-note">Some session events are not shown here. Read the session log on the desk for the full history.</p>'
      : ''
    return `<p class="pi-stream-label">Recent session events</p>${truncatedNote}<ol class="pi-events" id="pi-events" aria-label="Recent session events">${state.events.map(renderEvent).join('')}</ol>`
  }

  /* ---------------------------------------------------------
   * Selection arithmetic (pure)
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
  // routing is a decision rather than a cascade. The live list is the page's
  // home: Back and primary leave a session for it, and inside the list Back
  // still belongs to the Shell.
  const PAGE_INPUT = {
    list: { primary: 'select-cell', left: 'cell-left', right: 'cell-right', up: 'cell-up', down: 'cell-down' },
    detail: { primary: 'show-list', back: 'show-list', left: 'previous-session', right: 'next-session', up: 'scroll-up', down: 'scroll-down' },
  }

  function pageInputAction(input, listIsOpen) {
    return PAGE_INPUT[listIsOpen ? 'list' : 'detail'][input] || 'ignore'
  }

  // The Pi Sessions page's own copy for the states it can be in.
  function emptyCopy({ scan, filter, setSize, sourceLabel }) {
    if (scan === null) return 'Loading Pi sessions...'
    if (scan.ok === false) return `${sourceLabel || 'Pi sessions'} unavailable. Retrying automatically.`
    if (setSize === 0) return `No session matches ${filterTitle(filter)}.`
    return 'No session selected.'
  }

  function announcement(session, filter, setSize, fallback) {
    return session
      ? `Session ${statusLabel(session.status)} in ${sessionPath(session)}. ${setSize} ${filterTitle(filter).toLowerCase()} session${setSize === 1 ? '' : 's'}.`
      : fallback
  }

  function detailView({ detailEl, bodyEl, eventsHostEl }) {
    let paintedHtml = null
    let hasSession = false
    let following = false
    const followLatest = () => {
      if (following) detailEl.scrollTop = detailEl.scrollHeight
    }
    detailEl.addEventListener('scroll', followLatest, { passive: true })
    const observer = new ResizeObserver(followLatest)
    observer.observe(detailEl)
    observer.observe(bodyEl)
    observer.observe(eventsHostEl)

    // A reading position is a place in the stream, not a pixel offset: the
    // identity block above the stream can grow between updates, and keeping
    // scrollTop would slide the reader to a different line.
    const readingAnchor = () => {
      if (!hasSession || following) return null
      const viewTop = detailEl.getBoundingClientRect().top
      const row = [...eventsHostEl.querySelectorAll('.pi-event')].find((node) => node.getBoundingClientRect().bottom > viewTop)
      if (!row) return null
      return { text: row.querySelector('.pi-event-text')?.textContent ?? '', top: row.getBoundingClientRect().top - viewTop }
    }

    const restoreReadingAnchor = (anchor) => {
      if (anchor === null) return
      const viewTop = detailEl.getBoundingClientRect().top
      const row = [...eventsHostEl.querySelectorAll('.pi-event')].find((node) => (node.querySelector('.pi-event-text')?.textContent ?? '') === anchor.text)
      if (row === undefined) return
      detailEl.scrollTop += (row.getBoundingClientRect().top - viewTop) - anchor.top
    }

    const paint = (state, sourceLabel) => {
      const anchor = readingAnchor()
      const html = hasSession ? renderEventList(state, sourceLabel) : ''
      if (html === paintedHtml) {
        followLatest()
        return
      }
      const scrollTop = detailEl.scrollTop
      const tableIdentity = (table) => {
        const result = table.closest('.pi-event-result')
        return JSON.stringify([result.textContent, [...result.querySelectorAll('.pi-result-table-scroll')].indexOf(table)])
      }
      const tableState = [...eventsHostEl.querySelectorAll('.pi-result-table-scroll')].map((table) => ({
        identity: tableIdentity(table),
        left: table.scrollLeft,
        focused: table === document.activeElement,
      }))
      eventsHostEl.innerHTML = html
      paintedHtml = html
      const tables = [...eventsHostEl.querySelectorAll('.pi-result-table-scroll')]
      for (const state of tableState) {
        const index = tables.findIndex((table) => tableIdentity(table) === state.identity)
        if (index === -1) continue
        const [table] = tables.splice(index, 1)
        table.scrollLeft = state.left
        if (state.focused) table.focus({ preventScroll: true })
      }
      detailEl.scrollTop = scrollTop
      restoreReadingAnchor(anchor)
      followLatest()
    }

    return {
      render(session, state, sourceLabel) {
        const anchor = readingAnchor()
        hasSession = Boolean(session)
        following = session?.status === 'running'
        detailEl.classList.toggle('is-following', following)
        if (!session) {
          paintedHtml = null
          bodyEl.innerHTML = ''
          eventsHostEl.innerHTML = ''
          return
        }
        bodyEl.innerHTML = renderIdentity(session)
        paint(state, sourceLabel)
        restoreReadingAnchor(anchor)
        followLatest()
      },
      paint,
      restart() {
        paintedHtml = null
        hasSession = false
        following = false
        detailEl.scrollTop = 0
      },
      scroll(input) {
        detailEl.scrollTop += input === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX
      },
      focus() {
        detailEl.focus({ preventScroll: true })
      },
      destroy() {
        observer.disconnect()
        detailEl.removeEventListener('scroll', followLatest)
      },
    }
  }

  function overviewView({ overviewEl, listEl }) {
    // Cells are keyed by position, not only by identity: two reports of one
    // session must never share a node, and a stable order keeps a focused cell.
    const cellFor = (session, index, onChoose) => {
      const key = sessionKey(session)
      const existing = listEl.children[index]
      if (existing && existing.dataset.sessionKey === key) return existing
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'pi-overview-cell'
      cell.dataset.sessionKey = key
      cell.innerHTML = '<span class="pi-overview-cursor" aria-hidden="true">›</span><span class="pi-overview-copy"><span class="pi-overview-state"></span><span class="pi-overview-goal"></span><span class="pi-overview-path"></span><span class="pi-overview-activity"></span></span>'
      cell.addEventListener('click', () => onChoose(cell.dataset.sessionKey))
      return cell
    }

    return {
      render({ set, selectedKey, emptyCopy, onChoose }) {
        const focused = listEl.contains(document.activeElement) ? document.activeElement : null
        const scrollTop = overviewEl.scrollTop
        listEl.querySelector('.pi-empty-state')?.remove()
        // Selection is one row: duplicate reports of one session must not mark
        // every copy of it as the chosen session.
        const selectedAt = set.findIndex((session) => sessionKey(session) === selectedKey)
        for (const cell of listEl.children) cell.removeAttribute('data-page-focus')
        set.forEach((session, index) => {
          const key = sessionKey(session)
          const cell = cellFor(session, index, onChoose)
          if (listEl.children[index] !== cell) listEl.insertBefore(cell, listEl.children[index] || null)
          cell.dataset.sessionKey = key
          const isSelected = index === selectedAt
          cell.classList.toggle('is-selected', isSelected)
          cell.setAttribute('aria-pressed', String(isSelected))
          cell.querySelector('.pi-overview-state').innerHTML = stateMarkup(session)
          cell.querySelector('.pi-overview-goal').textContent = overviewGoal(session)
          cell.querySelector('.pi-overview-path').textContent = session.hostedPi ? `Hosted Pi · ${sessionPath(session)}` : sessionPath(session)
          const activity = cell.querySelector('.pi-overview-activity')
          activity.textContent = normalizeInline(session.activity)
          activity.hidden = !activity.textContent
        })
        while (listEl.children.length > set.length) listEl.lastElementChild.remove()
        // Only the visible view may own the Shell's focus entry point.
        if (!overviewEl.hidden) {
          const focusTarget = this.cells()[Math.max(selectedAt, 0)]
          if (focusTarget) focusTarget.setAttribute('data-page-focus', '')
        }
        if (set.length === 0) {
          const note = document.createElement('p')
          note.className = 'pi-empty-state'
          note.textContent = emptyCopy
          listEl.append(note)
        }
        if (focused) {
          const target = focused.isConnected ? focused : this.cells().find((cell) => cell.dataset.sessionKey === selectedKey)
          ;(target || listEl).focus?.({ preventScroll: true })
        }
        overviewEl.scrollTop = scrollTop
      },
      cells() {
        return [...listEl.querySelectorAll('.pi-overview-cell')]
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
        // A hidden view may not keep the Shell's focus entry point.
        if (!visible) for (const cell of this.cells()) cell.removeAttribute('data-page-focus')
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
      const titleTextEl = el.querySelector('#pi-title-text')
      const titleSpinnerEl = el.querySelector('#pi-title .pi-spinner')
      const subtitleEl = el.querySelector('#pi-view-subtitle')
      const factsEl = el.querySelector('#pi-view-facts')
      const statusEl = el.querySelector('#pi-status')
      const filterButtons = [...el.querySelectorAll('.pi-filter-btn')]
      const detail = detailView({ detailEl, bodyEl, eventsHostEl: el.querySelector('#pi-events-host') })
      const overview = overviewView({
        overviewEl: el.querySelector('#pi-overview'),
        listEl: el.querySelector('#pi-overview-list'),
      })

      let scan = null
      let filter = DEFAULT_FILTER
      let selectedKey = null
      let selectedIndex = 0
      let lastDirection = 'right'
      let eventsState = { reason: 'loading', ok: false, events: [] }
      let scanToken = 0
      let eventToken = 0
      let disposed = false
      let tickCount = 0
      const orderSessions = createSessionOrder()

      const currentSet = () => sessionSet(scan, filter)
      const selected = () => currentSet().find((session) => sessionKey(session) === selectedKey) || null
      const sourceLabel = () => scan?.source?.label || ''
      const remoteSource = () => scan?.source?.kind === 'ssh'

      function pageCopy() {
        return emptyCopy({ scan, filter, setSize: currentSet().length, sourceLabel: sourceLabel() })
      }

      // This page is one App page in a shell of pages, so its spinner only runs
      // while the shell is showing it. ctx.onTick is a one-second cadence and
      // cannot drive an 80ms indicator, so the interval is page-owned and
      // registered with the plugin's cleanup. Reduced motion stops the frames
      // instead of removing the indicator: the state is information.
      const motionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
      const pageIsCurrent = () => {
        const page = el.closest('.page')
        if (!page) return true
        const active = [...document.querySelectorAll('#dots .dot')].findIndex((dot) => dot.getAttribute('aria-current') === 'page')
        return Number(page.dataset.page) === active
      }
      let frameIndex = 0
      let appliedFrame = -1
      const spinnerTimer = setInterval(() => {
        if (disposed || document.hidden || !pageIsCurrent()) return
        if (motionQuery?.matches !== true) frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
        if (frameIndex === appliedFrame) return
        appliedFrame = frameIndex
        for (const node of el.querySelectorAll('[data-pi-spinner]')) node.textContent = SPINNER_FRAMES[frameIndex]
      }, SPINNER_INTERVAL_MS)

      function publishRemote() {
        // The page owns directional input in both views: a session by session,
        // or a row by row. The only page-owned Strip control is the Session
        // Filter, whose label is the filter the overview is showing.
        ctx?.publishPageRemote?.(el, {
          actions: [{ id: ACTION_FILTER, label: filterTitle(filter).toUpperCase() }],
          focus: 'items',
        })
      }

      function announce() {
        const text = announcement(selected(), filter, currentSet().length, pageCopy())
        if (statusEl.textContent !== text) statusEl.textContent = text
      }

      // The title states the view: the session's own Pi state while one is
      // shown, and the live set while the Overview is open.
      function renderTitle() {
        const showing = overview.isOpen()
        const session = selected()
        factsEl.textContent = ''
        if (showing) {
          titleTextEl.textContent = 'Pi Sessions'
          titleSpinnerEl.hidden = true
          const drivers = [...new Set((Array.isArray(scan?.sessions) ? scan.sessions : [])
            .filter((item) => item.hostedPi && item.controlAttribution)
            .map((item) => `${item.controlAttribution.machine} · ${item.controlAttribution.sessionId}`))]
          const attribution = drivers.length > 0 ? ` · Driven by ${drivers.slice(0, 2).join(', ')}${drivers.length > 2 ? ` +${drivers.length - 2}` : ''}` : ''
          const size = currentSet().length
          subtitleEl.textContent = scan === null
            ? 'Loading Pi sessions...'
            : scan.ok === false
              ? `${sourceLabel() || 'Pi sessions'} unavailable. Retrying automatically.`
              : `${size} ${filterTitle(filter).toLowerCase()} session${size === 1 ? '' : 's'} · ${sourceLabel() || 'Pi sessions'}${attribution}`
          return
        }
        if (!session) {
          titleTextEl.textContent = 'Pi Sessions'
          titleSpinnerEl.hidden = true
          subtitleEl.textContent = pageCopy()
          return
        }
        const working = session.status === 'running'
        titleTextEl.textContent = statusLabel(session.status)
        titleSpinnerEl.hidden = !working
        subtitleEl.textContent = sessionPath(session)
        factsEl.textContent = formatElapsed(session.startedAt)
      }

      function renderDetail() {
        const session = selected()
        detail.render(session, eventsState, sourceLabel())
        if (!session) {
          bodyEl.innerHTML = ''
          const note = document.createElement('p')
          note.className = 'pi-empty-state'
          note.textContent = pageCopy()
          bodyEl.append(note)
        }
      }

      function renderFilters() {
        for (const button of filterButtons) {
          const value = button.dataset.filter
          const active = value === filter
          button.classList.toggle('active', active)
          button.setAttribute('aria-pressed', String(active))
          const count = scan && scan.ok !== false ? sessionSet(scan, value).length : null
          button.querySelector('.pi-filter-count').textContent = count === null ? '--' : String(count)
          button.setAttribute('aria-label', `${FILTER_LABELS[value]} sessions${count === null ? ', count unavailable' : `, ${count}`}`)
        }
      }

      function renderOverview() {
        renderFilters()
        overview.render({ set: currentSet(), selectedKey, emptyCopy: pageCopy(), onChoose: chooseCell })
      }

      function renderAll() {
        renderTitle()
        renderDetail()
        renderOverview()
        announce()
      }

      function setFilter(value) {
        if (!FILTERS.includes(value) || value === filter) return
        filter = value
        reconcileSelection()
        eventsState = { reason: 'loading', ok: false, events: [] }
        detail.restart()
        renderAll()
        publishRemote()
        loadEvents()
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
        renderAll()
        loadEvents()
      }

      function moveSelection(step) {
        const set = currentSet()
        if (set.length === 0) return
        setSelection(steppedIndex(selectedIndex, step, set.length), step < 0 ? 'left' : 'right')
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
        // This is a page-local cover, not replacement navigation or a modal
        // over the Shell. Preserve the covered detail's layout and reading.
        detailEl.inert = next
        if (next) {
          detailEl.removeAttribute('data-page-focus')
          renderOverview()
          overview.focusSelected(selectedKey)
        } else {
          detailEl.setAttribute('data-page-focus', '')
          detail.focus()
        }
        renderTitle()
        publishRemote()
      }

      async function loadEvents() {
        const session = selected()
        const token = ++eventToken
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
            ? await root.odkPlatform.getPiSessionEvents({ cwd: session.cwd, sessionId: session.sessionId || session.uuid, hostedPi: session.hostedPi === true })
            : null
          if (disposed || token !== eventToken) return
          const valid = res?.ok && Array.isArray(res.events) && res.events.every((event) => event && typeof event.kind === 'string' && typeof event.text === 'string')
          eventsState = valid
            ? { reason: '', ok: true, events: res.events, truncated: res.truncated === true }
            : { reason: res?.reason || 'session-log-missing', ok: false, events: [] }
        } catch {
          if (disposed || token !== eventToken) return
          eventsState = { reason: 'session-log-unreadable', ok: false, events: [] }
        }
        detail.paint(eventsState, sourceLabel())
      }

      async function load() {
        const token = ++scanToken
        let response
        try {
          response = typeof root.odkPlatform?.getPiSessions === 'function'
            ? await root.odkPlatform.getPiSessions()
            : null
        } catch {
          response = null
        }
        if (disposed || token !== scanToken) return
        const previousKey = selectedKey
        const previousSource = JSON.stringify(scan?.source)
        scan = validScan(response)
          ? { ...response, sessions: orderSessions(response.sessions) }
          : { ok: false, source: response?.source || scan?.source || null, sessions: [] }
        reconcileSelection()
        if (selectedKey !== previousKey || JSON.stringify(scan.source) !== previousSource) {
          eventsState = { reason: 'loading', ok: false, events: [] }
          detail.restart()
        }
        renderAll()
        loadEvents()
      }

      function onRemoteAction(event) {
        if (event?.detail === ACTION_FILTER) setFilter(nextFilter(filter))
      }

      function onRemotePageInput(event) {
        const action = pageInputAction(event?.detail?.input, overview.isOpen())
        if (action === 'show-list') setOverview(true)
        else if (action === 'select-cell') {
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
        const page = el.closest('.page')
        if (page) {
          const activeIndex = [...document.querySelectorAll('#dots .dot')].findIndex((dot) => dot.getAttribute('aria-current') === 'page')
          if (Number(page.dataset.page) !== activeIndex) return
        }
        if (event.key === 'Escape' && overview.isOpen()) {
          event.preventDefault()
          event.stopPropagation()
          setOverview(false)
          return
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        // A focused overview control owns its own activation keys.
        if (overview.isOpen() && (event.key === 'Enter' || event.key === ' ')) {
          const cell = overview.cells().find((candidate) => candidate === document.activeElement)
          if (cell) {
            event.preventDefault()
            chooseCell(cell.dataset.sessionKey)
            return
          }
        }
        const input = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]
        if (!input || !event.target.closest('.pi-detail, .pi-overview-cell')) return
        event.stopPropagation()
        // A focused Markdown table owns native horizontal scrolling.
        if (event.target.closest('.pi-result-table-scroll')) return
        // Native vertical scrolling remains available in the detail.
        if (!overview.isOpen() && (input === 'up' || input === 'down')) return
        event.preventDefault()
        onRemotePageInput({ detail: { input } })
      }

      function onPageShown() {
        load()
      }

      el.addEventListener('odk-remote-action', onRemoteAction)
      el.addEventListener('odk-remote-page-input', onRemotePageInput)
      el.addEventListener('odk-page-shown', onPageShown)
      el.addEventListener('keydown', onKeydown)
      ctx?.trackCleanup?.(() => {
        disposed = true
        clearInterval(spinnerTimer)
        detail.destroy()
        scanToken += 1
        eventToken += 1
        el.removeEventListener('odk-remote-action', onRemoteAction)
        el.removeEventListener('odk-remote-page-input', onRemotePageInput)
        el.removeEventListener('odk-page-shown', onPageShown)
        el.removeEventListener('keydown', onKeydown)
        ctx?.publishPageRemote?.(el, null)
      })

      for (const button of filterButtons) {
        button.addEventListener('click', () => setFilter(button.dataset.filter))
      }

      // The page lands on the live session list: the overview is where a
      // session is chosen, and the detail is what a choice opens.
      overview.show(true)
      detailEl.inert = true
      detailEl.removeAttribute('data-page-focus')
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