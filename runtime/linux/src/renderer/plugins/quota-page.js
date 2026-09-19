;
(function (root) {
  'use strict'

  const ICONS = {
    antigravity: '<svg data-tabler="brand-google" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M20.945 11a9 9 0 1 1 -3.284 -5.997l-2.655 2.392a5.4 5.4 0 1 0 1.967 5.605h-4.973v-3h8.837c.072 .328 .108 .665 .108 1z"/></svg>',
    codex: '<svg data-tabler="terminal-2" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 9l3 3l-3 3"/><path d="M13 15l3 0"/><path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/></svg>',
    xai: '<svg data-tabler="sparkles" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M16 18a2 2 0 0 0 2 2a2 2 0 0 0 2 -2a2 2 0 0 0 -2 -2a2 2 0 0 0 -2 2"/><path d="M5 6a2 2 0 0 0 2 2a2 2 0 0 0 2 -2a2 2 0 0 0 -2 -2a2 2 0 0 0 -2 2"/><path d="M8 15a4 4 0 0 0 4 4a4 4 0 0 0 4 -4a4 4 0 0 0 -4 -4a4 4 0 0 0 -4 4"/></svg>',
  }

  function escapeHtml(value) {
    const div = document.createElement('div')
    div.textContent = String(value ?? '')
    return div.innerHTML
  }

  const PROVIDERS = { codex: 'Codex', antigravity: 'Antigravity', xai: 'xAI' }

  function isPercent(value) {
    return Number.isFinite(value) && value >= 0 && value <= 100
  }

  function formatPercent(value) {
    return isPercent(value) ? `${Math.round(value)}%` : 'Unavailable'
  }

  function formatReset(value) {
    if (!value) return 'Reset time unavailable'
    const reset = new Date(value)
    if (Number.isNaN(reset.getTime())) return String(value)
    const diff = reset.getTime() - Date.now()
    const absolute = reset.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    if (diff <= 0) return `Reset due · ${absolute}`
    const minutes = Math.ceil(diff / 60000)
    if (minutes < 60) return `${absolute} · in ${minutes}m`
    const hours = Math.ceil(minutes / 60)
    if (hours < 48) return `${absolute} · in ${hours}h`
    return `${absolute} · in ${Math.ceil(hours / 24)}d`
  }

  function quotaRow(quota) {
    const remaining = quota.remainingPct
    const known = isPercent(remaining)
    const level = remaining < 25 ? 'low' : 'normal'
    return `<div class="provider-quota-row">
      <div class="provider-quota-row-head">
        <span class="provider-quota-label">${escapeHtml(quota.label)}</span>
        <span class="provider-quota-reading"><span class="provider-quota-value${known ? '' : ' is-unknown'}">${formatPercent(remaining)}</span>
          ${known ? '<span class="provider-quota-unit">remaining</span>' : ''}</span>
      </div>
      ${known ? `<div class="provider-quota-meter" role="meter" aria-label="${escapeHtml(quota.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}" aria-valuetext="${formatPercent(remaining)} remaining">
        <span class="provider-quota-fill is-${level}" style="width:${remaining}%"></span>
      </div>` : '<div class="provider-quota-unknown-rule" aria-hidden="true"></div>'}
      <div class="provider-quota-reset">${escapeHtml(quota.description || (quota.resetAt ? `Resets ${formatReset(quota.resetAt)}` : 'Reset time unavailable'))}</div>
    </div>`
  }

  function quotaGroup(group) {
    return `<section class="provider-quota-group">
      <header class="provider-quota-group-head">
        <h3>${escapeHtml(group.title)}</h3>
        ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
      </header>
      ${group.quotas.map(quotaRow).join('')}
    </section>`
  }

  function resetCredits(credits) {
    if (!credits) return ''
    const expiry = credits.expiresAt.length
      ? `<div class="provider-reset-expiry">${credits.expiresAt.map((value, index) => `<span>Credit ${index + 1}<b>Expires ${escapeHtml(formatReset(value))}</b></span>`).join('')}</div>`
      : ''
    return `<section class="provider-reset-credits">
      <span>Rate-limit reset credits</span><strong>${credits.available}</strong>${expiry}
    </section>`
  }

  function accountState(account) {
    if (account.error) return ['unavailable', 'Unavailable']
    const quotas = account.groups.flatMap((group) => group.quotas)
    const known = quotas.filter((quota) => isPercent(quota.remainingPct))
    if (known.some((quota) => quota.remainingPct === 0)) return ['low', 'Exhausted window']
    if (known.some((quota) => quota.remainingPct < 25)) return ['low', 'Running low']
    if (!known.length || known.length !== quotas.length) return ['unknown', 'Quota unknown']
    return ['available', 'Available']
  }

  function accountCard(account) {
    const provider = account.provider
    const providerName = PROVIDERS[provider] || 'AI provider'
    const title = account.fileName || 'Authentication file'
    const [state, label] = accountState(account)
    const plan = account.plan ? `<span class="provider-plan-name">${escapeHtml(account.plan)}</span>` : ''
    return `<article class="provider-quota-card is-${state}" aria-label="${escapeHtml(title)}">
      <header class="provider-quota-card-head">
        <span class="provider-quota-icon">${ICONS[provider] || ICONS.codex}</span>
        <div class="provider-quota-identity">
          <div class="provider-quota-title-row"><h2>${escapeHtml(providerName)}</h2>${plan}</div>
          <span class="provider-quota-account">${escapeHtml(account.account || title)}</span>
          <span class="provider-quota-availability">${escapeHtml(label)}</span>
        </div>
      </header>
      <div class="provider-quota-card-body">
        ${account.error
          ? `<p class="provider-quota-error">${escapeHtml(account.error)}</p>`
          : `${account.groups.map(quotaGroup).join('') || '<p class="provider-quota-error">No quota windows were returned.</p>'}`}
        <details class="provider-details" data-account="${escapeHtml(account.id || `${provider}:${title}`)}">
          <summary>${account.resetCredits ? `Reset credits · ${escapeHtml(account.resetCredits.available)} / Account details` : 'Account details'}</summary>
          ${resetCredits(account.resetCredits)}
          <p class="provider-quota-file">${escapeHtml(title)}</p>
        </details>
      </div>
    </article>`
  }

  root.odkPlugins.register({
    id: 'odk.page.quota',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'app',
    css: 'plugins/quota-page.css',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="card quota-card app-surface-card odk-stack">
          <header class="quota-page-head">
            <div class="quota-heading"><h1 class="quota-title">AI usage &amp; quotas</h1>
              <p class="quota-description" id="quota-count">Subscriptions unavailable</p></div>
            <div class="quota-header-controls">
              <div class="quota-checked" id="quota-checked"></div>
              <button class="button-pill button-primary" id="quota-refresh" data-remote-initial-focus type="button">Refresh quotas</button>
            </div>
          </header>
          <div class="quota-service-row"><p id="quota-feedback" role="status" aria-live="polite"></p>
            <span class="quota-source">Source: CLIProxyAPI</span></div>
          <div class="provider-quota-grid" id="quota-metrics"></div>
        </div>`

      const metrics = el.querySelector('#quota-metrics')
      const checked = el.querySelector('#quota-checked')
      const feedback = el.querySelector('#quota-feedback')
      const count = el.querySelector('#quota-count')
      let refreshing = false
      let refreshFailed = false
      let disposed = false
      let previousMarkup = ''
      const showAccounts = (accounts) => {
        const markup = accounts.map(accountCard).join('')
        if (markup === previousMarkup) return
        const details = [...(metrics.querySelectorAll?.('.provider-details') || [])]
        const expanded = new Set(details.filter((node) => node.open).map((node) => node.dataset.account))
        const focused = details.find((node) => node.contains(document.activeElement))?.dataset.account
        metrics.innerHTML = markup
        previousMarkup = markup
        for (const node of metrics.querySelectorAll?.('.provider-details') || []) {
          node.open = expanded.has(node.dataset.account)
          if (node.dataset.account === focused) node.querySelector('summary').focus({ preventScroll: true })
        }
      }
      const render = (status = ctx.subscription.status()) => {
        if (disposed) return
        checked.textContent = ctx.subscription.lastCheck()
        const accounts = status.snapshot?.accounts
        const total = Array.isArray(accounts) ? accounts.length : 0
        const available = total ? accounts.filter((account) => !account.error).length : 0
        count.textContent = Array.isArray(accounts)
          ? `${total} subscription${total === 1 ? '' : 's'}`
          : 'Subscriptions unavailable'
        const recovery = status.state === 'unauthorized'
          ? 'Check the CM5 quota-service credential, then refresh.'
          : status.state === 'unconfigured'
            ? 'Configure the quota service on CM5, then refresh.'
            : status.state === 'available'
              ? (total ? `${available} of ${total} accounts available` : 'No connected accounts. Check the quota-service configuration.')
              : 'Quotas unavailable. Check the connection and refresh.'
        feedback.textContent = refreshing ? 'Refreshing quotas…'
          : refreshFailed ? 'Refresh failed. Check the connection and try again. Displayed quotas are from the previous response.'
            : `${recovery}${total && status.state !== 'available' ? ' Showing the previous response; quotas may be out of date.' : ''}`
        if (Array.isArray(accounts) && accounts.length) {
          showAccounts(accounts)
          return
        }
        const unavailable = status.state === 'unauthorized'
          ? 'Quota service rejected the management key. Check the CM5 device credential.'
          : status.reason || 'Actual quotas have not been retrieved.'
        previousMarkup = ''
        metrics.innerHTML = `<div class="provider-quota-empty">${escapeHtml(unavailable)}</div>`
      }
      ctx.trackCleanup?.(ctx.subscription.subscribe(render))
      const refreshButton = el.querySelector('#quota-refresh')
      const refresh = async () => {
        if (refreshButton.disabled) return
        refreshing = true
        refreshFailed = false
        refreshButton.disabled = true
        refreshButton.setAttribute('aria-busy', 'true')
        render()
        try {
          await ctx.subscription.refresh()
        } catch {
          refreshFailed = true
        } finally {
          refreshing = false
          if (!disposed) {
            refreshButton.disabled = false
            refreshButton.removeAttribute('aria-busy')
            render()
          }
        }
      }
      void refresh()
      refreshButton.addEventListener('click', refresh)
      ctx.trackCleanup?.(() => {
        disposed = true
        refreshButton.removeEventListener('click', refresh)
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
