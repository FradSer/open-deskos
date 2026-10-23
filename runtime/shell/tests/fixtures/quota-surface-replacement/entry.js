;(function (root) {
  'use strict'

  // Static provider artwork, stylesheet, and fonts share the Shell contract.
  const artwork = {"antigravity": "<svg data-tabler=\"brand-google\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M20.945 11a9 9 0 1 1 -3.284 -5.997l-2.655 2.392a5.4 5.4 0 1 0 1.967 5.605h-4.973v-3h8.837c.072 .328 .108 .665 .108 1z\"/></svg>", "codex": "<svg data-tabler=\"terminal-2\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M8 9l3 3l-3 3\"/><path d=\"M13 15l3 0\"/><path d=\"M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z\"/></svg>", "xai": "<svg data-tabler=\"sparkles\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M16 18a2 2 0 0 0 2 2a2 2 0 0 0 2 -2a2 2 0 0 0 -2 -2a2 2 0 0 0 -2 2\"/><path d=\"M5 6a2 2 0 0 0 2 2a2 2 0 0 0 2 -2a2 2 0 0 0 -2 -2a2 2 0 0 0 -2 2\"/><path d=\"M8 15a4 4 0 0 0 4 4a4 4 0 0 0 4 -4a4 4 0 0 0 -4 -4a4 4 0 0 0 -4 4\"/></svg>"}
  const providers = { codex: 'Codex', antigravity: 'Antigravity', xai: 'xAI' }
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
  const percent = value => valid(value) ? `${Math.round(value)}%` : 'Unavailable'
  function reset(value) {
    if (!value) return 'Reset time unavailable'
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) return String(value)
    const label = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const minutes = Math.ceil((date.valueOf() - Date.now()) / 60000)
    if (minutes <= 0) return `Reset due · ${label}`
    const hours = Math.ceil(minutes / 60)
    return `${label} · in ${minutes < 60 ? `${minutes}m` : hours < 48 ? `${hours}h` : `${Math.ceil(hours / 24)}d`}`
  }
  const make = (tag, className, text, attributes = {}) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = String(text ?? '')
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    return node
  }
  function quota(value) {
    const row = make('div', 'provider-quota-row')
    const header = make('div', 'provider-quota-row-head')
    const reading = make('span', 'provider-quota-reading')
    const known = valid(value.remainingPct)
    reading.append(make('span', `provider-quota-value${known ? '' : ' is-unknown'}`, percent(value.remainingPct)))
    if (known) reading.append(make('span', 'provider-quota-unit', 'remaining'))
    header.append(make('span', 'provider-quota-label', value.label), reading)
    row.append(header)
    if (known) {
      const meter = make('div', 'provider-quota-meter', undefined, { role: 'meter', 'aria-label': String(value.label ?? ''),
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': value.remainingPct,
        'aria-valuetext': `${percent(value.remainingPct)} remaining` })
      const fill = make('span', `provider-quota-fill is-${value.remainingPct < 25 ? 'low' : 'normal'}`)
      fill.style.width = `${value.remainingPct}%`
      meter.append(fill); row.append(meter)
    } else row.append(make('div', 'provider-quota-unknown-rule', undefined, { 'aria-hidden': 'true' }))
    row.append(make('div', 'provider-quota-reset', value.description || (value.resetAt ? `Resets ${reset(value.resetAt)}` : 'Reset time unavailable')))
    return row
  }
  function card(account) {
    const title = account.fileName || 'Authentication file'
    const provider = providers[account.provider] || 'AI provider'
    const windows = account.error ? [] : account.groups.flatMap(group => group.quotas)
    const readings = windows.map(window => window.remainingPct).filter(valid)
    let state = ['available', 'Available']
    if (account.error) state = ['unavailable', 'Unavailable']
    else if (readings.includes(0)) state = ['low', 'Exhausted window']
    else if (readings.some(value => value < 25)) state = ['low', 'Running low']
    else if (!readings.length || readings.length !== windows.length) state = ['unknown', 'Quota unknown']
    const article = make('article', `provider-quota-card is-${state[0]}`, undefined, { 'aria-label': title })
    const head = make('header', 'provider-quota-card-head')
    const icon = make('span', 'provider-quota-icon'); icon.innerHTML = artwork[account.provider] || artwork.codex
    const identity = make('div', 'provider-quota-identity'); identity.append(make('strong', '', provider), make('p', 'provider-quota-account', account.account || 'Account identity unavailable'))
    head.append(icon, identity)
    const body = make('div', 'provider-quota-card-body')
    const context = make('div', 'provider-quota-context')
    if (account.plan) context.append(make('p', 'provider-plan', `${provider} · ${account.plan}`))
    context.append(make('p', 'provider-quota-availability', state[1]))
    body.append(context)
    if (account.error) body.append(make('p', 'provider-quota-error', account.error))
    else if (!account.groups.length) body.append(make('p', 'provider-quota-error', 'No quota windows were returned.'))
    else for (const source of account.groups) {
      const kind = value => value.horizon || (/5\s*(hour|h)\b/i.test(value.label || '') ? 'short' : /week/i.test(value.label || '') ? 'long' : null)
      const pro = account.provider === 'codex' && /\bpro\b/i.test(account.plan || '')
      const group = { ...source, quotas: source.quotas.filter(value => !pro || kind(value) !== 'short') }
      if (account.provider === 'antigravity') {
        for (const [horizon, label] of [['short', '5 hour limit'], ['long', 'Weekly limit']]) {
          if (!group.quotas.some(value => kind(value) === horizon)) group.quotas.push({ label, horizon, remainingPct: null })
        }
      }
      if (!group.quotas.length) continue
      const section = make('section', 'provider-quota-group')
      const heading = make('header', 'provider-quota-group-head'); heading.append(make('h3', '', group.title))
      if (group.description) heading.append(make('p', '', group.description))
      section.append(heading, ...group.quotas.map(quota)); body.append(section)
    }
    const details = make('details', 'provider-details', undefined, { 'data-account': account.id || `${account.provider}:${title}` })
    const credits = account.resetCredits
    details.append(make('summary', '', credits ? `Reset credits · ${credits.available} / Account details` : 'Account details'))
    if (credits) {
      const section = make('section', 'provider-reset-credits')
      section.append(make('span', '', 'Rate-limit reset credits'), make('strong', '', credits.available))
      if (credits.expiresAt.length) {
        const expiry = make('div', 'provider-reset-expiry')
        credits.expiresAt.forEach((date, index) => {
          const line = make('span', '', `Credit ${index + 1}`); line.append(make('b', '', `Expires ${reset(date)}`)); expiry.append(line)
        })
        section.append(expiry)
      }
      details.append(section)
    }
    details.append(make('p', 'provider-quota-file', title)); body.append(details); article.append(head, body)
    return article
  }
  root.odkRendererDevelopment.define({
    id: 'odk.page.quota', manifest: { schemaVersion: 1, version: '2.0.0' }, kind: 'page', surface: 'app', css: 'plugins/quota-page.css',
    mount(element, context) {
      const surface = make('div', 'card quota-card app-surface-card odk-stack')
      const head = make('header', 'quota-page-head')
      const heading = make('div', 'quota-heading')
      const count = make('span', '', 'Subscriptions unavailable', { id: 'quota-count' })
      heading.append(make('h1', 'quota-title', 'AI usage & quotas'), count)
      const controls = make('div', 'quota-header-controls')
      const checked = make('div', 'quota-checked', undefined, { id: 'quota-checked' })
      const button = make('button', 'button-pill button-primary', 'Refresh quotas', { id: 'quota-refresh', 'data-remote-initial-focus': '', type: 'button' })
      controls.append(checked, button); head.append(heading, controls)
      const service = make('div', 'quota-service-row')
      const feedback = make('p', '', undefined, { id: 'quota-feedback', role: 'status', 'aria-live': 'polite' })
      service.append(feedback, make('span', 'quota-source', 'Source: CLIProxyAPI'))
      const metrics = make('div', 'provider-quota-grid', undefined, { id: 'quota-metrics' })
      surface.append(head, service, metrics); element.replaceChildren(surface)
      let released = false, busy = false, failed = false, signature = ''
      function render(status = context.subscription.status()) {
        if (released) return
        checked.textContent = context.subscription.lastCheck()
        const accounts = status.snapshot?.accounts
        const list = Array.isArray(accounts) ? accounts : []
        count.textContent = Array.isArray(accounts) ? `${list.length} subscription${list.length === 1 ? '' : 's'}` : 'Subscriptions unavailable'
        let recovery = 'Quotas unavailable. Check the connection and refresh.'
        if (status.state === 'unauthorized') recovery = 'Check the CM5 quota-service credential, then refresh.'
        else if (status.state === 'unconfigured') recovery = 'Configure the quota service on CM5, then refresh.'
        else if (status.state === 'available') recovery = list.length
          ? `${list.filter(account => !account.error).length} of ${list.length} accounts available`
          : 'No connected accounts. Check the quota-service configuration.'
        feedback.textContent = busy ? 'Refreshing quotas…' : failed
          ? 'Refresh failed. Check the connection and try again. Displayed quotas are from the previous response.'
          : recovery + (list.length && status.state !== 'available' ? ' Showing the previous response; quotas may be out of date.' : '')
        if (!list.length) {
          signature = ''
          const message = status.state === 'unauthorized' ? 'Quota service rejected the management key. Check the CM5 device credential.'
            : status.reason || 'Actual quotas have not been retrieved.'
          metrics.replaceChildren(make('div', 'provider-quota-empty', message)); return
        }
        const cards = list.map(card)
        const next = cards.map(node => node.outerHTML).join('')
        if (signature === next) return
        const disclosures = [...metrics.querySelectorAll('.provider-details')]
        const expanded = new Set(disclosures.filter(node => node.open).map(node => node.dataset.account))
        const focus = disclosures.find(node => node.contains(document.activeElement))?.dataset.account
        metrics.replaceChildren(...cards); signature = next
        for (const node of metrics.querySelectorAll('.provider-details')) {
          node.open = expanded.has(node.dataset.account)
          if (node.dataset.account === focus) node.querySelector('summary').focus({ preventScroll: true })
        }
      }
      context.trackCleanup(context.subscription.subscribe(render))
      async function refresh() {
        if (button.disabled) return
        busy = true; failed = false; button.disabled = true; button.setAttribute('aria-busy', 'true'); render()
        try { await context.subscription.refresh() } catch { failed = true }
        finally {
          busy = false
          if (!released) { button.disabled = false; button.removeAttribute('aria-busy'); render() }
        }
      }
      void refresh()
      button.addEventListener('click', refresh)
      context.trackCleanup(() => { released = true; button.removeEventListener('click', refresh) })
    },
  })
})(window)
