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

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Recently'
    const diff = Math.max(0, Date.now() - timestamp)
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
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
    interaction: 'open-app',
    appId: 'pi-sessions',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-header odk-row items-center justify-between w-full">
          <span class="w-name">Pi Sessions</span>
          <span class="widget-action-cue" aria-hidden="true">
            <svg data-tabler="chevron-right" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 6l6 6l-6 6" /></svg>
          </span>
        </div>
        <div class="pi-widget-body odk-col justify-between w-full">
          <div class="pi-widget-metric-row odk-row items-baseline justify-between w-full">
            <div class="odk-row items-baseline gap-2">
              <span class="pi-widget-count">--</span>
              <span class="pi-widget-unit">RUNNING</span>
            </div>
            <div class="pi-widget-live-tag odk-row items-center gap-1">
              <span class="pi-indicator-dot pi-indicator-idle"></span>
              <span class="pi-widget-tag-label">IDLE</span>
            </div>
          </div>
          
          <div class="pi-widget-glance-box odk-col justify-center">
            <div class="pi-glance-ws odk-row items-center gap-1">
              <svg data-tabler="folder" class="pi-glance-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>
              <span class="pi-glance-ws-name">Scanning...</span>
            </div>
            <p class="pi-glance-goal">Checking local sessions in background...</p>
          </div>

          <div class="pi-widget-footer-meta odk-row items-center justify-between w-full">
            <span class="pi-widget-summary">0 workspaces</span>
            <span class="w-state">${this.state}</span>
          </div>
        </div>`

      const countEl = el.querySelector('.pi-widget-count')
      const dotEl = el.querySelector('.pi-indicator-dot')
      const tagLabelEl = el.querySelector('.pi-widget-tag-label')
      const wsNameEl = el.querySelector('.pi-glance-ws-name')
      const goalEl = el.querySelector('.pi-glance-goal')
      const summaryEl = el.querySelector('.pi-widget-summary')
      const stateEl = el.querySelector('.w-state')

      let tickCount = 0

      const refresh = async () => {
        try {
          const res = typeof ctx.callBackend === 'function'
            ? await ctx.callBackend('scanSessions')
            : (typeof root.odkPlatform?.getPiSessions === 'function' ? await root.odkPlatform.getPiSessions() : null)
          if (!res) {
            countEl.textContent = '0'
            tagLabelEl.textContent = 'OFFLINE'
            wsNameEl.textContent = 'Platform offline'
            goalEl.textContent = 'Pi session scanning unavailable.'
            return
          }
          const running = res?.summary?.running ?? 0
          const total = res?.summary?.total ?? 0
          const wsCount = res?.summary?.workspacesCount ?? 0

          countEl.textContent = String(running)
          summaryEl.textContent = `${wsCount} workspace${wsCount !== 1 ? 's' : ''} · ${total} total`

          if (running > 0) {
            dotEl.className = 'pi-indicator-dot pi-indicator-running'
            tagLabelEl.textContent = 'ACTIVE'
            tagLabelEl.className = 'pi-widget-tag-label text-odk-green'

            // Find top running session to show in glance preview
            const topRunning = res.sessions.find(s => s.status === 'running')
            if (topRunning) {
              wsNameEl.textContent = topRunning.workspaceName || 'Active Workspace'
              goalEl.textContent = topRunning.latestGoal || 'Active task in progress...'
            }
            if (stateEl) stateEl.textContent = `${running} running`
          } else {
            dotEl.className = 'pi-indicator-dot pi-indicator-idle'
            tagLabelEl.textContent = 'IDLE'
            tagLabelEl.className = 'pi-widget-tag-label'

            if (total > 0 && res.sessions.length > 0) {
              const latest = res.sessions[0]
              wsNameEl.textContent = latest.workspaceName || 'Recent Workspace'
              goalEl.textContent = latest.latestGoal || 'No active goal'
              if (stateEl) stateEl.textContent = `${total} recent`
            } else {
              wsNameEl.textContent = 'No Sessions'
              goalEl.textContent = 'No local Pi sessions detected.'
              if (stateEl) stateEl.textContent = 'Idle'
            }
          }
        } catch {
          countEl.textContent = '0'
          wsNameEl.textContent = 'Error'
          goalEl.textContent = 'Unable to scan sessions.'
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
          <div class="pi-app-toolbar odk-row items-center justify-between w-full">
            <div class="pi-app-metrics odk-row items-center gap-2">
              <span class="pi-metric-pill pi-metric-running"><strong id="pi-metric-running">0</strong> running</span>
              <span class="pi-metric-pill"><strong id="pi-metric-settled">0</strong> settled</span>
              <span class="pi-metric-pill"><strong id="pi-metric-workspaces">0</strong> workspaces</span>
            </div>
            <div class="pi-app-actions odk-row items-center gap-2">
              <div class="pi-filter-group odk-row items-center">
                <button type="button" class="pi-filter-btn active" data-filter="all">All</button>
                <button type="button" class="pi-filter-btn" data-filter="running">Running</button>
                <button type="button" class="pi-filter-btn" data-filter="settled">Settled</button>
                <button type="button" class="pi-filter-btn" data-filter="exited">Exited</button>
              </div>
              <button type="button" class="button-pill button-secondary pi-refresh-btn" id="pi-refresh-btn">
                Refresh
              </button>
            </div>
          </div>

          <div class="pi-search-box w-full">
            <input type="search" class="pi-search-input w-full" id="pi-search-input" placeholder="Search sessions by workspace, goal, or PID..." aria-label="Search sessions" />
          </div>

          <div class="pi-sessions-feed w-full" id="pi-sessions-feed" role="region" aria-label="Sessions list">
            <p class="pi-loading-hint">Loading Pi sessions...</p>
          </div>
        </div>`

      const runningMetric = el.querySelector('#pi-metric-running')
      const settledMetric = el.querySelector('#pi-metric-settled')
      const wsMetric = el.querySelector('#pi-metric-workspaces')
      const feedEl = el.querySelector('#pi-sessions-feed')
      const searchInput = el.querySelector('#pi-search-input')
      const refreshBtn = el.querySelector('#pi-refresh-btn')
      const filterBtns = el.querySelectorAll('.pi-filter-btn')

      let currentFilter = 'all'
      let currentQuery = ''
      let sessionData = null
      let tickCount = 0

      function renderFeed() {
        if (!sessionData || !sessionData.sessions || sessionData.sessions.length === 0) {
          feedEl.innerHTML = '<div class="pi-empty-state"><p>No Pi sessions found in <code>~/.pi/agent/directory-sessions/</code>.</p></div>'
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
            (s.pid && String(s.pid).includes(query)) ||
            (s.uuid && s.uuid.toLowerCase().includes(query))
          )
        })

        if (filtered.length === 0) {
          feedEl.innerHTML = '<div class="pi-empty-state"><p>No matching Pi sessions found.</p></div>'
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

        let html = ''
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
                <span class="pi-ws-badge">${wsRunning > 0 ? `<span class="pi-badge-dot"></span>${wsRunning} running · ` : ''}${ws.sessions.length} session${ws.sessions.length > 1 ? 's' : ''}</span>
              </div>
              <div class="pi-ws-cards odk-col gap-2">`

          for (const s of ws.sessions) {
            const statusClass = `pi-status-${s.status}`
            const modifiedCount = s.modifiedFiles ? s.modifiedFiles.length : 0
            html += `
              <article class="pi-session-card pi-card-${s.status}">
                <div class="pi-card-header odk-row items-center justify-between">
                  <div class="odk-row items-center gap-2">
                    <span class="pi-status-badge ${statusClass}">
                      ${s.status === 'running' ? '<span class="pi-pulse-dot"></span>' : ''}
                      ${s.status.toUpperCase()}
                    </span>
                    <span class="pi-card-pid">PID ${s.pid || '-'}</span>
                    <span class="pi-card-uuid" title="${escapeHtml(s.sessionId)}">${escapeHtml(s.uuid ? s.uuid.slice(0, 8) : 'session')}</span>
                  </div>
                  <div class="pi-card-meta odk-row items-center gap-2">
                    <span class="pi-card-time">${formatTimeAgo(s.updatedAt)}</span>
                  </div>
                </div>

                <div class="pi-card-goal">
                  <span class="pi-goal-label">Goal:</span>
                  <p class="pi-goal-text">${escapeHtml(s.latestGoal || 'No goal stated')}</p>
                </div>

                ${modifiedCount > 0 ? `
                  <div class="pi-card-files">
                    <button type="button" class="pi-files-toggle odk-row items-center gap-1" aria-expanded="false">
                      <svg data-tabler="file-code" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M10 13l-1 2l1 2" /><path d="M14 13l1 2l-1 2" /></svg>
                      <span>${modifiedCount} modified file${modifiedCount > 1 ? 's' : ''}</span>
                      <svg data-tabler="chevron-down" class="pi-chevron-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 9l6 6l6 -6" /></svg>
                    </button>
                    <div class="pi-files-list" hidden>
                      ${s.modifiedFiles.map(f => `<div class="pi-file-item"><code>${escapeHtml(f)}</code></div>`).join('')}
                    </div>
                  </div>
                ` : ''}
              </article>`
          }

          html += `
              </div>
            </div>`
        }

        feedEl.innerHTML = html

        // Wire up accordion file toggles
        const toggles = feedEl.querySelectorAll('.pi-files-toggle')
        toggles.forEach((btn) => {
          btn.addEventListener('click', () => {
            const list = btn.nextElementSibling
            const isExpanded = btn.getAttribute('aria-expanded') === 'true'
            btn.setAttribute('aria-expanded', String(!isExpanded))
            if (list) list.hidden = isExpanded
            btn.classList.toggle('expanded', !isExpanded)
          })
        })
      }

      const load = async () => {
        try {
          sessionData = typeof ctx.callBackend === 'function'
            ? await ctx.callBackend('scanSessions')
            : (typeof root.odkPlatform?.getPiSessions === 'function' ? await root.odkPlatform.getPiSessions() : null)
          if (!sessionData) {
            feedEl.innerHTML = '<div class="pi-empty-state"><p>Platform service is unavailable.</p></div>'
            return
          }
          runningMetric.textContent = String(sessionData?.summary?.running ?? 0)
          settledMetric.textContent = String(sessionData?.summary?.settled ?? 0)
          wsMetric.textContent = String(sessionData?.summary?.workspacesCount ?? 0)
          renderFeed()
        } catch (err) {
          feedEl.innerHTML = `<div class="pi-empty-state"><p>Error scanning sessions: ${escapeHtml(err.message)}</p></div>`
        }
      }

      filterBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
          currentFilter = btn.dataset.filter || 'all'
          renderFeed()
        })
      })

      searchInput.addEventListener('input', (e) => {
        currentQuery = e.target.value
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
})(typeof window !== 'undefined' ? window : globalThis)
