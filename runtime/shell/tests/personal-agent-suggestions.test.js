const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function mount({ explicit } = {}) {
  const canonical = [], retired = [], supplied = []
  const api = entries => ({ consumerReady: id => { entries.push(id); return Promise.resolve({ accepted: true }) } })
  const window = { odkPersonalAgent: api(canonical), odkPersonalBot: api(retired) }
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const surface = { hidden: false, replaceChildren() {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/personal-agent-suggestions.js'), 'utf8'), {
    window, document, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  })
  const controller = window.odkPersonalAgentSuggestions.mount(surface, explicit ? { api: api(supplied) } : {})
  return { canonical, retired, supplied, controller, surface }
}

test('inline suggestions default to the canonical Personal Agent bridge and withdraw readiness on release', async () => {
  const f = mount()
  assert.deepEqual(f.canonical, ['11111111-1111-4111-8111-111111111111'])
  assert.deepEqual(f.retired, [])
  await f.controller.destroy()
  assert.deepEqual(f.canonical, ['11111111-1111-4111-8111-111111111111', null])
  assert.equal(f.surface.hidden, true)
})

test('an explicitly selected suggestion bridge retains ownership', async () => {
  const f = mount({ explicit: true })
  assert.deepEqual(f.supplied, ['11111111-1111-4111-8111-111111111111'])
  assert.deepEqual(f.canonical, [])
  assert.deepEqual(f.retired, [])
  await f.controller.destroy()
  assert.deepEqual(f.supplied, ['11111111-1111-4111-8111-111111111111', null])
})
