const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APPS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'apps.js'), 'utf8')

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
  assert.match(clock, /<p class="runtime-value">--:--<\/p>/)
  assert.match(clock, /class="runtime-state app-detail"/)

  const pomodoro = markupFor('pomodoro')
  assert.match(pomodoro, /class="runtime-state app-detail">Not started<\/p>/)
  assert.match(pomodoro, /class="button-pill button-primary" type="button">Start timer<\/button>/)
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
