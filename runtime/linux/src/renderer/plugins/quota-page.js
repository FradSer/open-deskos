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

  function formatPercent(value) {
    return value === null || value === undefined ? 'Unavailable' : `${Math.round(value)}%`
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
    const width = remaining === null || remaining === undefined ? 0 : Math.max(0, Math.min(100, remaining))
    const level = width >= 60 ? 'high' : width >= 25 ? 'medium' : 'low'
    return `<div class="provider-quota-row">
      <div class="provider-quota-row-head">
        <span class="provider-quota-label">${escapeHtml(quota.label)}</span>
        <span class="provider-quota-value">${formatPercent(remaining)}</span>
      </div>
      <div class="provider-quota-reset">${escapeHtml(quota.description || formatReset(quota.resetAt))}</div>
      <div class="provider-quota-meter" role="meter" aria-label="${escapeHtml(quota.label)}" aria-valuemin="0" aria-valuemax="100" ${remaining === null || remaining === undefined ? '' : `aria-valuenow="${width}"`}>
        <span class="provider-quota-fill is-${level}" style="width:${width}%"></span>
      </div>
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
      ? `<div class="provider-reset-expiry">${credits.expiresAt.map((value, index) => `<span>Credit ${index + 1}<b>${escapeHtml(formatReset(value))}</b></span>`).join('')}</div>`
      : ''
    return `<section class="provider-reset-credits">
      <span>Rate-limit reset credits</span><strong>${credits.available}</strong>${expiry}
    </section>`
  }

  function accountCard(account) {
    const provider = account.provider || 'codex'
    const title = account.fileName || 'Authentication file'
    const plan = account.plan ? `<div class="provider-plan"><span>Plan</span><strong>${escapeHtml(account.plan)}</strong></div>` : ''
    return `<article class="provider-quota-card ${account.error ? 'is-unavailable' : ''}" aria-label="${escapeHtml(title)}">
      <header class="provider-quota-card-head">
        <span class="provider-quota-icon">${ICONS[provider] || ICONS.codex}</span>
        <span class="provider-quota-identity">
          <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
        </span>
      </header>
      <div class="provider-quota-card-body">
        ${account.error
          ? `<p class="provider-quota-error">${escapeHtml(account.error)}</p>`
          : `${plan}${resetCredits(account.resetCredits)}${account.groups.map(quotaGroup).join('') || '<p class="provider-quota-error">No quota windows were returned.</p>'}`}
      </div>
    </article>`
  }

  root.odkPlugins.register({
    id: 'odk.page.quota',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'app',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="card quota-card app-surface-card odk-stack">
          <header class="quota-page-head">
            <h1 class="quota-title">AI usage &amp; quotas</h1>
            <div class="quota-header-controls">
              <div class="quota-checked" id="quota-checked"></div>
              <button class="button-pill button-primary" id="quota-refresh" data-remote-initial-focus type="button">Refresh quotas</button>
            </div>
          </header>
          <div class="provider-quota-grid" id="quota-metrics" role="status" aria-live="polite"></div>
        </div>`

      const metrics = el.querySelector('#quota-metrics')
      const checked = el.querySelector('#quota-checked')
      const render = (status = ctx.subscription.status()) => {
        checked.textContent = ctx.subscription.lastCheck()
        const accounts = status.snapshot?.accounts
        if (Array.isArray(accounts) && accounts.length) {
          metrics.innerHTML = accounts.map(accountCard).join('')
          return
        }
        const unavailable = status.state === 'unauthorized'
          ? 'Quota service rejected the management key. Check the CM5 device credential.'
          : status.reason || 'Actual quotas have not been retrieved.'
        metrics.innerHTML = `<div class="provider-quota-empty">${escapeHtml(unavailable)}</div>`
      }
      ctx.trackCleanup?.(ctx.subscription.subscribe(render))
      const refreshButton = el.querySelector('#quota-refresh')
      const refresh = async () => {
        if (refreshButton.disabled) return
        refreshButton.disabled = true
        refreshButton.setAttribute('aria-busy', 'true')
        try {
          await ctx.subscription.refresh()
        } finally {
          refreshButton.disabled = false
          refreshButton.removeAttribute('aria-busy')
        }
      }
      void refresh()
      refreshButton.addEventListener('click', refresh)
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
