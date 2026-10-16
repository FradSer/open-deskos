const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APPS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'apps.js'), 'utf8')
const QUOTA_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'quota-page.js'), 'utf8')

function markupFor(appId) {
  const marker = `app('${appId}'`
  const start = APPS_SOURCE.indexOf(marker)
  assert.notEqual(start, -1, `missing ${appId} built-in view`)
  const end = APPS_SOURCE.indexOf("root.odkPlugins.register(app('", start + marker.length)
  return APPS_SOURCE.slice(start, end === -1 ? undefined : end)
}

test('simple built-in App interiors use the shared semantic anatomy', () => {
  for (const appId of ['calendar', 'clock', 'pomodoro', 'year']) {
    const markup = markupFor(appId)
    assert.match(markup, /class="runtime-app"/)
    assert.match(markup, /class="app-surface-header"/)
    assert.match(markup, /class="app-surface-heading"/)
    assert.match(markup, /class="[^"]*\bapp-detail\b[^"]*"/)
  }

  const calendar = markupFor('calendar')
  assert.match(calendar, /class="runtime-state app-detail"/)

  const clock = markupFor('clock')
  assert.match(clock, /<time class="runtime-value">--:--<\/time>/)
  assert.match(clock, /class="runtime-state app-detail"/)

  const pomodoro = markupFor('pomodoro')
  assert.match(pomodoro, /class="runtime-state app-detail"/)
  assert.match(pomodoro, /class="button-pill button-primary pomodoro-toggle"/)
})

test('Built-in views provides a visible associated search label and shared list anatomy', () => {
  const markup = markupFor('app-manager')

  assert.match(markup, /class="runtime-app app-manager"/)
  assert.match(markup, /class="app-surface-header"/)
  assert.match(markup, /class="app-surface-heading"/)
  assert.match(markup, /<label class="app-search-label" for="app-search">Search built-in views<\/label>/)
  assert.match(markup, /<input id="app-search" class="app-search" type="search" aria-label="Search built-in views"/)
  assert.match(markup, /class="app-manager-status runtime-state app-detail" role="status" aria-live="polite"/)
  assert.match(markup, /<ul class="app-list"><\/ul>/)
})

test('the AI usage App interior uses the same semantic anatomy', () => {
  // The surface is mounted by a shared function, so the App wrapper and the
  // card it hosts are asserted where that function and its registration live.
  assert.match(QUOTA_SOURCE, /id: 'odk\.app\.quota'/)
  assert.match(QUOTA_SOURCE, /class="runtime-app quota-app" data-view="quota"/)
  assert.match(QUOTA_SOURCE, /class="app-surface-header"><h2 class="app-surface-heading">AI usage &amp; quotas<\/h2>/)
  assert.match(QUOTA_SOURCE, /class="\$\{rootClass\}"/)
  assert.match(QUOTA_SOURCE, /<h1 class="quota-title">AI usage &amp; quotas<\/h1>/)
  assert.match(QUOTA_SOURCE, /id="quota-refresh"/)
  assert.match(QUOTA_SOURCE, /class="provider-quota-grid" id="quota-metrics"/)
})
