'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const layoutContext = {}
vm.runInNewContext(read('src/renderer/config/desktop_layout.js'), layoutContext)
const pages = layoutContext.DESKTOP_LAYOUT.pages
const byId = id => pages.find(page => page.id === id)

test('Home, Hydra, and Reading share the three by two Widget area', () => {
  for (const id of ['home', 'desk', 'reading']) {
    const page = byId(id)
    assert.ok(page, `${id} page exists`)
    assert.equal(page.kind, 'grid', `${id} is a grid page`)
    assert.equal(page.gridRows, 2, `${id} uses the shared two Widget rows`)
  }
  const home = byId('home')
  assert.equal(home.widgets.length, 6, 'Home fills three columns by two rows')
  for (const widget of home.widgets) {
    assert.match(widget.col, /^[1-3]$/, `${widget.id} stays inside three columns`)
    assert.match(widget.row, /^[1-2]$/, `${widget.id} stays inside two rows`)
  }
})

test('Hydra and WeRead occupy one reachable paging page each', () => {
  const desk = byId('desk')
  const reading = byId('reading')
  assert.deepEqual(JSON.parse(JSON.stringify(desk.widgets.map(widget => widget.id))), ['odk.tile.hydra'])
  assert.deepEqual(JSON.parse(JSON.stringify(reading.widgets.map(widget => widget.id))), ['odk.tile.weread'])
  for (const widget of [...desk.widgets, ...reading.widgets]) {
    assert.equal(widget.col, '1 / 4', `${widget.id} spans the shared area`)
    assert.equal(widget.row, '1 / 3', `${widget.id} spans the shared two rows`)
    assert.ok(widget.opensApp, `${widget.id} keeps its App entry`)
  }
  assert.equal(pages.filter(page => !page.persistent && page.kind === 'grid').length, 3,
    'Home, Hydra, and Reading are the paging pages')
})

test('the Overview is a persistent host outside the paging pages', () => {
  const html = read('src/renderer/index.html')
  assert.match(html, /id="home-summary"/)
  assert.ok(!pages.some(page => page.widgets?.some(widget => widget.id === 'home-summary')),
    'Overview is not a Widget in any paging page')
  const shell = read('src/renderer/shell.js')
  assert.doesNotMatch(shell, /homePage\.prepend\(/,
    'Overview is not moved into one paging page')
})

test('the Agent avatar sits closer to the State Bar', () => {
  const css = read('src/renderer/home-desk.css')
  const lift = /--agent-head-lift:\s*(-?\d+)px/.exec(css)
  assert.ok(lift, 'the header lift is declared')
  assert.ok(Number(lift[1]) < 0, 'the avatar and identity move above the panel edge')
  assert.match(css, /\.agent-head\s*\{[^}]*translateY\(var\(--agent-head-lift\)\)/,
    'only the header moves, not the conversation or composer')
  assert.match(css, /\.agent-identity \.agent-capsule\s*\{[^}]*border-radius:\s*var\(--agent-radius-surface\)/,
    'the framed capsule keeps its radius')
  assert.match(css, /\.agent-identity \.agent-capsule\s*\{[^}]*border:\s*1px solid/,
    'the framed capsule keeps its border')
})

test('the Agent pane is opaque and clips a scrolling right pane', () => {
  const css = read('src/renderer/home-desk.css')
  assert.match(css, /#personal-agent\s*\{[^}]*overflow:\s*hidden/, 'the left pane clips its content')
  assert.match(css, /#personal-agent\s*\{[^}]*background:\s*var\(--odk-bg\)/, 'the left pane has an opaque surface')
  assert.match(css, /#personal-agent\s*\{[^}]*z-index:\s*[1-9]/, 'the left pane owns its stacking layer')
  assert.match(css, /#personal-agent\s*\{[^}]*position:\s*relative/, 'the stacking layer is local')
})

test('Jump to latest keeps the pill shape', () => {
  const css = read('src/renderer/home-desk.css')
  assert.match(css, /\.agent-latest\s*\{[^}]*border-radius:\s*var\(--odk-radius-pill\)/,
    'the control is a capsule, not the nested control radius')
})

test('finished proposals do not become the Agent identity state', () => {
  const source = read('src/renderer/core/personal-agent-suggestions.js')
  const labels = /const activeLabels = \{([^}]*)\}/.exec(source)
  assert.ok(labels, 'only active proposal labels are published')
  const terminal = ['ignored', 'expired', 'completed']
  for (const name of terminal) {
    assert.equal(labels[1].includes(`${name}:`), false,
      `${name} is not published as an identity caption`)
  }
  assert.match(labels[1], /executing:\s*'In progress'/, 'in-progress work still reports')
  assert.match(labels[1], /unknown:\s*'Outcome not confirmed'/, 'an unknown outcome keeps its safety assertion')
  assert.match(source, /'Waiting for result'/, 'pending work still reports')
  assert.doesNotMatch(source, /'Expired'|'Dismissed'|'Completed'/,
    'no terminal proposal word remains an identity caption')
})

test('the keyboard composer centers its message like Tap to talk', () => {
  const css = read('src/renderer/home-desk.css')
  assert.match(css, /\.agent-composer\[data-mode="keyboard"\]\s+textarea\s*\{[^}]*text-align:\s*center/,
    'the keyboard message is centered')
  assert.match(css, /\.agent-composer\[data-mode="voice"\]\s+\.agent-mic\s*\{[^}]*justify-content:\s*center/,
    'Tap to talk remains the centered reference')
})

test('the Overview weekday and date type is enlarged', () => {
  const css = read('src/renderer/home-desk.css')
  const wd = /#home-summary \.dash-wd \{ font-size: clamp\((\d+)px, (\d+)cqw, (\d+)px\)/.exec(css)
  const date = /#home-summary \.dash-date \{[^}]*font-size: clamp\((\d+)px, ([\d.]+)cqw, (\d+)px\)/.exec(css)
  assert.ok(wd && date, 'both use a bounded type scale')
  assert.ok(Number(wd[1]) >= 40 && Number(wd[3]) >= 108, 'the weekday is larger at both ends')
  assert.ok(Number(date[1]) >= 18 && Number(date[3]) >= 48, 'the date is larger at both ends')
  assert.match(css, /\.dash-narrative \{ font-size: var\(--overview-copy-size/,
    'the narrative keeps its own fitted size')
})

test('Home still reserves one Cell of height for the fixed Overview', () => {
  const shell = read('src/renderer/shell.js')
  assert.match(shell, /pageId === 'home' \? 1 : 0/,
    'the Overview row keeps its Cell in the shared canvas budget')
  assert.match(shell, /Overview owns its own row outside the paging track/,
    'the reservation is documented as the fixed Overview row')
})
