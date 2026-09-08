;
(function (root) {
  'use strict'

  function escapeHtml(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

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

  function setFilesExpanded(button, expanded) {
    button.setAttribute('aria-expanded', String(expanded))
    button.classList.toggle('expanded', expanded)
    button.nextElementSibling.hidden = !expanded
  }

  function captureFeedState(feed) {
    return new Map([...feed.querySelectorAll('[data-session-key]')].map(card => {
      const focused = card.contains(document.activeElement) ? document.activeElement : null
      return [card.dataset.sessionKey, {
        focus: focused && !focused.matches('article') ? '.' + focused.className.split(' ')[0] : null,
      }]
    }))
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

  function captureFeedAnchor(feed, surface) {
    const top = Math.max(feed.getBoundingClientRect().top, surface.getBoundingClientRect().top)
    const bottom = Math.min(feed.getBoundingClientRect().bottom, surface.getBoundingClientRect().bottom)
    const card = [...feed.querySelectorAll('[data-session-key]')].find(node => {
      const rect = node.getBoundingClientRect()
      return rect.bottom > top && rect.top < bottom
    })
    return card ? { key: card.dataset.sessionKey, top: card.getBoundingClientRect().top } : null
  }

  function createFeedUpdater(feed) {
    let previousHtml = null
    return (html) => {
      if (html === previousHtml) return
      const state = captureFeedState(feed)
      const surface = feed.closest('.pi-app-wrapper')
      const scrollTop = surface.scrollTop
      const feedScrollTop = feed.scrollTop
      const anchor = captureFeedAnchor(feed, surface)
      feed.innerHTML = html
      previousHtml = html
      for (const card of feed.querySelectorAll('[data-session-key]')) {
        const saved = state.get(card.dataset.sessionKey)
        if (!saved) continue
        if (saved.focus) card.querySelector(saved.focus)?.focus({ preventScroll: true })
      }
      surface.scrollTop = scrollTop
      feed.scrollTop = feedScrollTop
      if (anchor) {
        const card = [...feed.querySelectorAll('[data-session-key]')].find(node => node.dataset.sessionKey === anchor.key)
        if (card) {
          const scroller = feed.scrollHeight > feed.clientHeight ? feed : surface
          scroller.scrollTop += card.getBoundingClientRect().top - anchor.top
        }
      }
    }
  }

  function normalizeInline(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : ''
  }

  function renderMarkdownInline(text) {
    if (!text || typeof text !== 'string') return ''
    let escaped = escapeHtml(text)
    // Inline code `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="pi-inline-code">$1</code>')
    // Bold **text** or __text__
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italic *text*
    escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3')
    return escaped
  }

  function parseSkillTag(text) {
    if (!text || typeof text !== 'string') return null
    const match = text.match(/<skill\s+name="([^"]+)"[^>]*>/)
    if (!match) return null
    const skillName = match[1]
    const endTag = '</skill>'
    const endIndex = text.indexOf(endTag)
    const prompt = endIndex !== -1 ? text.slice(endIndex + endTag.length).trim() : ''
    return { skillName, prompt }
  }

  function renderGoalHtml(text) {
    const skill = parseSkillTag(text)
    if (skill) {
      return `<span class="pi-skill-tag"><strong class="pi-skill-bracket">[skill]</strong> <span class="pi-skill-name">${escapeHtml(skill.skillName)}</span></span>${skill.prompt ? ` <span class="pi-skill-prompt">${renderMarkdownInline(skill.prompt)}</span>` : ''}`
    }
    return renderMarkdownInline(text)
  }

  function renderActivityHtml(text) {
    const normalized = normalizeInline(text)
    const skill = parseSkillTag(normalized)
    if (skill) {
      return `<span class="pi-skill-tag"><strong class="pi-skill-bracket">[skill]</strong> <span class="pi-skill-name">${escapeHtml(skill.skillName)}</span></span>${skill.prompt ? ` <span class="pi-skill-prompt">${renderMarkdownInline(skill.prompt)}</span>` : ''}`
    }
    return renderMarkdownInline(normalized)
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
            <span class="pi-widget-unit">WORKING</span>
          </div>
          <div class="pi-widget-live-tag odk-row items-center gap-1">
            <span class="pi-indicator-dot pi-indicator-idle"></span>
            <span class="pi-widget-tag-label">IDLE</span>
          </div>
          <div class="pi-widget-context odk-col items-center">
            <span class="w-state">Pi Sessions</span>
            <span class="pi-widget-summary">0 workspaces</span>
          </div>
        </div>`

      const countEl = el.querySelector('.pi-widget-count')
      const dotEl = el.querySelector('.pi-indicator-dot')
      const tagLabelEl = el.querySelector('.pi-widget-tag-label')
      const summaryEl = el.querySelector('.pi-widget-summary')
      const stateEl = el.querySelector('.w-state')

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
            return
          }
          const running = res?.summary?.running ?? 0
          const total = res?.summary?.total ?? 0
          const wsCount = res?.summary?.workspacesCount ?? 0

          countEl.textContent = String(running)
          summaryEl.textContent = `${res.source?.label ? `${res.source.label} · ` : ''}${wsCount} workspace${wsCount !== 1 ? 's' : ''} · ${total} total`

          if (running > 0) {
            dotEl.className = 'pi-indicator-dot pi-indicator-running'
            tagLabelEl.textContent = 'ACTIVE'
            tagLabelEl.className = 'pi-widget-tag-label text-odk-green'

            if (stateEl) stateEl.textContent = `${running} working`
          } else {
            dotEl.className = 'pi-indicator-dot pi-indicator-idle'
            tagLabelEl.textContent = 'IDLE'
            tagLabelEl.className = 'pi-widget-tag-label'

            if (total > 0 && res.sessions.length > 0) {
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
   * Fullscreen App: odk.app.pi-sessions
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
      el.innerHTML = `
        <div class="runtime-app pi-app-wrapper">
          <header class="app-surface-header pi-app-header">
            <div class="app-surface-heading">
              <h1>Pi Sessions</h1>
              <p id="pi-source-label">All sessions across folders.</p>
            </div>
            <div class="pi-header-actions">
              <div class="pi-search-box">
                <label class="app-search-label" for="pi-search-input">Search sessions</label>
                <input type="search" class="pi-search-input" id="pi-search-input" data-remote-initial-focus placeholder="Workspace, goal, or PID" aria-label="Search sessions" />
              </div>
              <button type="button" class="button-pill button-secondary pi-refresh-btn" id="pi-refresh-btn" aria-label="Refresh">
                <svg data-tabler="refresh" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
              </button>
            </div>
          </header>
          <div class="pi-app-toolbar">
            <div class="pi-app-metrics odk-row items-center gap-2">
              <span class="pi-metric-pill pi-metric-running"><strong id="pi-metric-running">0</strong> working</span>
              <span class="pi-metric-pill"><strong id="pi-metric-settled">0</strong> settled</span>
              <span class="pi-metric-pill"><strong id="pi-metric-workspaces">0</strong> workspaces</span>
            </div>
            <div class="pi-app-actions odk-row items-center gap-2">
              <button type="button" class="pi-view-toggle" id="pi-view-toggle" aria-pressed="true">By workspace</button>
              <div class="pi-filter-group odk-row items-center" role="group" aria-label="Session status filter">
                <button type="button" class="pi-filter-btn active" data-filter="all" aria-pressed="true">All</button>
                <button type="button" class="pi-filter-btn" data-filter="running" aria-pressed="false">Working</button>
                <button type="button" class="pi-filter-btn" data-filter="settled" aria-pressed="false">Settled</button>
                <button type="button" class="pi-filter-btn" data-filter="exited" aria-pressed="false">Exited</button>
              </div>
            </div>
          </div>

          <p class="sr-only" id="pi-sessions-status" role="status" aria-live="polite"></p>
          <div class="pi-sessions-feed w-full" id="pi-sessions-feed" role="region" aria-label="Sessions list">
            <p class="pi-loading-hint">Loading Pi sessions...</p>
          </div>
        </div>`

      const runningMetric = el.querySelector('#pi-metric-running')
      const settledMetric = el.querySelector('#pi-metric-settled')
      const wsMetric = el.querySelector('#pi-metric-workspaces')
      const feedEl = el.querySelector('#pi-sessions-feed')
      const statusEl = el.querySelector('#pi-sessions-status')
      const sourceEl = el.querySelector('#pi-source-label')
      const searchInput = el.querySelector('#pi-search-input')
      const refreshBtn = el.querySelector('#pi-refresh-btn')
      const filterBtns = el.querySelectorAll('.pi-filter-btn')
      const viewToggle = el.querySelector('#pi-view-toggle')

      let currentFilter = 'all'
      let currentQuery = ''
      let groupedView = false
      let sessionData = null
      let tickCount = 0
      const updateFeed = createFeedUpdater(feedEl)
      const orderSessions = createSessionOrder()

      function renderFeed() {
        if (sessionData?.ok === false) {
          const message = `${sourceEl.textContent} unavailable. Select Refresh to try again.`
          updateFeed(`<div class="pi-empty-state"><p>${escapeHtml(message)}</p></div>`)
          statusEl.textContent = message
          return
        }
        if (!sessionData || !sessionData.sessions || sessionData.sessions.length === 0) {
          updateFeed('<div class="pi-empty-state"><p>No running or recorded Pi processes found.</p><small>Checked source process state and <code>~/.pi/agent/directory-sessions/</code>.</small></div>')
          statusEl.textContent = 'No Pi sessions found.'
          return
        }

        const query = currentQuery.trim().toLowerCase()
        const filtered = sessionData.sessions.filter((s) => {
          if (currentFilter !== 'all' && s.status !== currentFilter) return false
          if (!query) return true
          return (
            (s.workspaceName && s.workspaceName.toLowerCase().includes(query)) ||
            (s.cwd && s.cwd.toLowerCase().includes(query)) ||
            (s.latestGoal && s.latestGoal.toLowerCase().includes(query)) ||
            (s.activity && s.activity.toLowerCase().includes(query)) ||
            (s.recap && s.recap.toLowerCase().includes(query)) ||
            (s.pid && String(s.pid).includes(query)) ||
            (s.uuid && s.uuid.toLowerCase().includes(query))
          )
        })

        if (filtered.length === 0) {
          updateFeed('<div class="pi-empty-state"><p>No matching Pi sessions found.</p></div>')
          statusEl.textContent = 'No matching Pi sessions found.'
          return
        }

        // Group filtered sessions by workspace
        const wsGroups = new Map()
        for (const s of filtered) {
          const key = s.cwd || s.workspaceName || 'Default'
          if (!wsGroups.has(key)) {
            wsGroups.set(key, {
              name: s.workspaceName,
              cwd: s.cwd,
              sessions: [],
            })
          }
          wsGroups.get(key).sessions.push(s)
        }

        const sessionCard = (s) => {
          const statusClass = `pi-status-${s.status}`
          const statusDisplay = s.status === 'running' ? 'WORKING' : s.status.toUpperCase()
          return `
            <article class="pi-session-card pi-card-${s.status}" data-session-key="${escapeHtml(sessionKey(s))}">
              <div class="pi-card-header odk-row items-center justify-between">
                <div class="odk-row items-center gap-2">
                  <span class="pi-status-badge ${statusClass}">
                    ${s.status === 'running' ? '<span class="pi-pulse-dot"></span>' : ''}
                    ${statusDisplay}
                  </span>
                  ${groupedView ? '' : `<span class="pi-card-workspace" title="${escapeHtml(s.cwd || '')}"><svg data-tabler="folder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>${escapeHtml(s.workspaceName || s.cwd || 'Unknown workspace')}</span>`}
                </div>
                <div class="pi-card-meta odk-row items-center gap-2">
                  <span class="pi-card-time">${formatElapsed(s.startedAt)}</span>
                </div>
              </div>

              <div class="pi-card-goal">
                <span class="pi-goal-label">Goal:</span>
                <p class="pi-goal-text">${renderGoalHtml(s.latestGoal || (s.source === 'process' ? 'Live Pi process; session metadata unavailable.' : 'No goal stated'))}</p>
              </div>

              ${(s.activity || s.recap || s.status === 'running') ? `
                <div class="pi-card-activity">
                  <span class="pi-activity-label">Model:</span>
                  <p class="pi-activity-text">${s.status === 'running' ? '<span class="pi-pulse-dot"></span>' : ''}${renderActivityHtml(s.activity || (s.status === 'running' ? 'Working...' : (s.recap || 'Settled')))}</p>
                </div>` : ''}
            </article>`
        }

        let html = ''
        if (groupedView) {
          for (const ws of wsGroups.values()) {
            const wsRunning = ws.sessions.filter(s => s.status === 'running').length
            html += `
            <div class="pi-workspace-section">
              <div class="pi-workspace-header odk-row items-center justify-between">
                <div class="odk-row items-center gap-2">
                  <svg data-tabler="folder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>
                  <span class="pi-ws-title">${escapeHtml(ws.name)}</span>
                  <span class="pi-ws-path" title="${escapeHtml(ws.cwd)}">${escapeHtml(ws.cwd)}</span>
                </div>
                <span class="pi-ws-badge">${wsRunning > 0 ? `<span class="pi-badge-dot"></span>${wsRunning} working · ` : ''}${ws.sessions.length} session${ws.sessions.length > 1 ? 's' : ''}</span>
              </div>
              <div class="pi-ws-cards odk-col gap-2">${ws.sessions.map(sessionCard).join('')}
              </div>
            </div>`
          }
        } else {
          html = `<div class="pi-ws-cards odk-col gap-2">${filtered.map(sessionCard).join('')}</div>`
        }

        updateFeed(html)
        statusEl.textContent = `${filtered.length} Pi session${filtered.length === 1 ? '' : 's'} shown${groupedView ? ' by workspace' : ' across all folders'}.`
      }

      const load = async () => {
        try {
          sessionData = typeof root.odkPlatform?.getPiSessions === 'function'
            ? await root.odkPlatform.getPiSessions()
            : null
          sourceEl.textContent = sessionData?.source?.label || 'Local'
          if (!sessionData || sessionData.ok === false) {
            runningMetric.textContent = '--'
            settledMetric.textContent = '--'
            wsMetric.textContent = '--'
            const message = `${sessionData?.source?.label || 'Platform service'} unavailable. Select Refresh to try again.`
            updateFeed(`<div class="pi-empty-state"><p>${escapeHtml(message)}</p></div>`)
            statusEl.textContent = message
            return
          }
          sessionData = { ...sessionData, sessions: orderSessions(sessionData.sessions || []) }
          runningMetric.textContent = String(sessionData?.summary?.running ?? 0)
          settledMetric.textContent = String(sessionData?.summary?.settled ?? 0)
          wsMetric.textContent = String(sessionData?.summary?.workspacesCount ?? 0)
          renderFeed()
        } catch (err) {
          sessionData = { ok: false }
          runningMetric.textContent = '--'
          settledMetric.textContent = '--'
          wsMetric.textContent = '--'
          const message = `Unable to scan sessions: ${err.message}. Select Refresh to try again.`
          updateFeed(`<div class="pi-empty-state"><p>${escapeHtml(message)}</p></div>`)
          statusEl.textContent = message
        }
      }

      filterBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          filterBtns.forEach((filterBtn) => {
            filterBtn.classList.remove('active')
            filterBtn.setAttribute('aria-pressed', 'false')
          })
          btn.classList.add('active')
          btn.setAttribute('aria-pressed', 'true')
          currentFilter = btn.dataset.filter || 'all'
          renderFeed()
        })
      })

      searchInput.addEventListener('input', (e) => {
        currentQuery = e.target.value
        renderFeed()
      })

      viewToggle.addEventListener('click', () => {
        groupedView = !groupedView
        viewToggle.setAttribute('aria-pressed', String(!groupedView))
        viewToggle.textContent = groupedView ? 'All folders' : 'By workspace'
        sourceEl.textContent = groupedView ? 'Processes grouped by workspace.' : 'All sessions across folders.'
        renderFeed()
      })

      refreshBtn.addEventListener('click', load)

      if (ctx?.onTick) {
        ctx.onTick(() => {
          tickCount += 1
          if (tickCount % 5 === 0) {
            load()
          }
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
