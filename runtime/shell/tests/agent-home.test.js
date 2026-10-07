const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function services() {
  let receive
  const root = { odkPersonalBot: { subscribe(fn) { receive = fn }, getStatus: async () => ({ state: 'unavailable' }) } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/services.js'), 'utf8'), {
    window: root, navigator: { onLine: true }, setInterval: () => 0, console,
  })
  return { home: root.odkServices.homeBriefing, receive }
}

test('home service uses agent content and marks retained content stale on disconnect', () => {
  const { home, receive } = services()
  const frames = []
  home.subscribe(f => frames.push(f))
  receive({ state: 'idle', briefing: { state: 'live', items: [{ text: '<script>literal mail</script>', sources: [] }], generatedAt: 1000 } })
  assert.equal(frames.at(-1).items[0].text, '<script>literal mail</script>')
  receive({ state: 'unavailable' })
  assert.equal(frames.at(-1).state, 'stale')
  assert.equal(frames.at(-1).items.length, 1)
})

test('voice state changes without briefing never become home content', () => {
  const { home, receive } = services()
  receive({ state: 'thinking', message: 'Voice response' })
  assert.equal(home.snapshot().items.length, 0)
})
