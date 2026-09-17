const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer')

function createServices() {
  const root = {}
  vm.runInContext(
    fs.readFileSync(path.join(RENDERER_DIR, 'core', 'services.js'), 'utf8'),
    vm.createContext({
      window: root,
      globalThis: root,
      console: { error() {} },
      navigator: { onLine: true },
      setInterval: () => 0,
    }),
  )
  return root.odkServices
}

const ICON = '<svg data-tabler="folder" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h6v2H4z" /></svg>'

test('briefing contributions order by declared order and keep insertion order within one order', () => {
  const { briefing } = createServices()
  assert.equal(briefing.contribute({ id: 'odk.briefing.z', order: 10, parts: [{ text: 'Zed' }] }), true)
  assert.equal(briefing.contribute({ id: 'odk.briefing.a', order: 10, parts: [{ text: 'Aye' }] }), true)
  assert.equal(briefing.contribute({ id: 'odk.briefing.m', order: 5, parts: [{ text: 'Em' }] }), true)
  assert.deepEqual([...briefing.list()].map((entry) => entry.id), ['odk.briefing.m', 'odk.briefing.z', 'odk.briefing.a'])
})

test('briefing contributions default their order and replace their own id', () => {
  const { briefing } = createServices()
  briefing.contribute({ id: 'odk.briefing.first', parts: [{ text: 'First' }] })
  briefing.contribute({ id: 'odk.briefing.explicit', order: 1, parts: [{ text: 'Explicit' }] })
  assert.deepEqual([...briefing.list()].map((entry) => entry.id), ['odk.briefing.explicit', 'odk.briefing.first'])

  briefing.contribute({ id: 'odk.briefing.first', order: 1, parts: [{ text: 'Rewritten' }] })
  assert.equal(briefing.list().length, 2, 'the same id replaces rather than appends')
  assert.deepEqual(
    Object.fromEntries([...briefing.list()].map((entry) => [entry.id, entry.parts[0].text])),
    { 'odk.briefing.first': 'Rewritten', 'odk.briefing.explicit': 'Explicit' },
  )
})

test('briefing contributions drop malformed parts instead of rendering fabricated text', () => {
  const { briefing } = createServices()
  assert.equal(briefing.contribute({
    id: 'odk.briefing.mixed',
    parts: [
      { text: 'Kept' },
      { text: 'Emphasized', emphasis: true, icon: ICON },
      null,
      'raw string',
      { text: '' },
      { text: 42 },
      { emphasis: true },
      { text: 'Bad icon', icon: '<script>alert(1)</script>' },
      { text: 'Off-theme icon', icon: '<svg data-tabler="folder"><script>x</script></svg>' },
      { text: 'Handler icon', icon: '<svg data-tabler="folder" viewBox="0 0 24 24" onload="x()"><path d="M1 1h1" /></svg>' },
      { text: 'Sized icon', icon: '<svg data-tabler="folder"><path d="M1 1h1" /></svg>' },
    ],
  }), true)
  const [entry] = briefing.list()
  assert.deepEqual(JSON.parse(JSON.stringify(entry.parts)), [
    { text: 'Kept' },
    { text: 'Emphasized', emphasis: true, icon: ICON },
    { text: 'Bad icon' },
    { text: 'Off-theme icon' },
    { text: 'Handler icon' },
    { text: 'Sized icon' },
  ])
})

test('briefing contributions reject non-namespaced ids and empty part lists', () => {
  const { briefing } = createServices()
  assert.equal(briefing.contribute({ id: 'briefing.unscoped', parts: [{ text: 'No' }] }), false)
  assert.equal(briefing.contribute({ parts: [{ text: 'No' }] }), false)
  assert.equal(briefing.contribute({ id: 'odk.briefing.empty', parts: [] }), false)
  assert.equal(briefing.contribute({ id: 'odk.briefing.empty', parts: [{ text: '' }] }), false)
  assert.deepEqual([...briefing.list()], [])
})

test('an unchanged contribution does not re-notify subscribers', () => {
  const { briefing } = createServices()
  let renders = 0
  const unsubscribe = briefing.subscribe(() => { renders += 1 })
  assert.equal(renders, 1, 'subscribing renders the current state once')

  const statement = { id: 'odk.briefing.pi', order: 20, parts: [{ text: 'You have ' }, { text: '2 sessions', emphasis: true }] }
  briefing.contribute(statement)
  assert.equal(renders, 2)
  briefing.contribute({ ...statement, parts: [{ text: 'You have ' }, { text: '2 sessions', emphasis: true }] })
  assert.equal(renders, 2, 'a byte-identical statement is not re-rendered')

  briefing.contribute({ ...statement, parts: [{ text: 'You have ' }, { text: '3 sessions', emphasis: true }] })
  assert.equal(renders, 3, 'a changed statement is re-rendered')
  unsubscribe()
})

test('withdrawing a contribution removes it and notifies subscribers', () => {
  const { briefing } = createServices()
  const seen = []
  briefing.subscribe((statements) => seen.push(statements.length))
  briefing.contribute({ id: 'odk.briefing.temp', parts: [{ text: 'Temporary' }] })
  assert.equal(briefing.withdraw('odk.briefing.temp'), true)
  assert.equal(briefing.withdraw('odk.briefing.temp'), false, 'a second withdrawal is a no-op')
  assert.deepEqual(seen, [0, 1, 0])
  assert.deepEqual([...briefing.list()], [])
})

test('a listed statement exposes only the documented shape', () => {
  const { briefing } = createServices()
  briefing.contribute({ id: 'odk.briefing.shape', order: 5, parts: [{ text: 'Only facts' }] })
  const [entry] = briefing.list()
  assert.deepEqual(JSON.parse(JSON.stringify(entry)), {
    id: 'odk.briefing.shape',
    order: 5,
    parts: [{ text: 'Only facts' }],
  })
})

test('the briefing store is reachable through the shared service registry', () => {
  const services = createServices()
  assert.equal(services.get('odk.service.briefing'), services.briefing)
  assert.equal(services.get('briefing'), services.briefing)
  assert.ok(services.list().includes('odk.service.briefing'))
})