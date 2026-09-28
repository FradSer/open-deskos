const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

// The renderer loads this as a classic script, so the module is read and run the
// way the page runs it rather than required.
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/core/gamepad.js'), 'utf8')

function loadModule() {
  const root = {}
  vm.runInNewContext(source, { window: root, globalThis: root, console, navigator: { getGamepads: () => [] } })
  return root.odkGamepadInput
}

function states(connections) {
  // The module runs in its own context, so its objects carry that context's
  // prototypes and are copied into this one before they are compared.
  return connections.map((state) => ({ ...state }))
}

function standardPad(buttons = []) {
  const held = new Set(buttons)
  return {
    index: 0,
    id: 'Xbox Wireless Controller',
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, (_value, index) => ({ pressed: held.has(index), value: held.has(index) ? 1 : 0 })),
  }
}

// The desk's own navigation vocabulary, and the physical control that carries each
// intent on an Xbox-style pad: A, B, Y, the two shoulders, and the directional pad.
const A = 0
const B = 1
const Y = 3
const LB = 4
const RB = 5
const DPAD_UP = 12
const DPAD_DOWN = 13
const DPAD_LEFT = 14
const DPAD_RIGHT = 15

function harness({ pads = [], start = 0 } = {}) {
  const { createGamepadInput } = loadModule()
  const intents = []
  const connections = []
  let current = pads
  let clock = start
  const input = createGamepadInput({
    read: () => current,
    now: () => clock,
    onInput: (intent) => intents.push(intent),
    onConnection: (state) => connections.push(state),
  })
  return {
    intents,
    connections,
    press(padIndexes, padIndex = 0) {
      current = pads.map((pad, index) => (index === padIndex ? standardPad(padIndexes) : pad))
    },
    connect(next) { current = next },
    advance(ms) { clock += ms },
    poll: () => input.poll(),
  }
}

test('the pad drives the desk with the desk\'s own navigation intents', () => {
  const h = harness({ pads: [standardPad()] })
  h.poll()
  for (const [button, intent] of [
    [DPAD_DOWN, 'down'],
    [DPAD_UP, 'up'],
    [DPAD_LEFT, 'left'],
    [DPAD_RIGHT, 'right'],
    [A, 'primary'],
    [B, 'back'],
    [LB, 'page-previous'],
    [RB, 'page-next'],
    [Y, 'mic'],
  ]) {
    h.press([button])
    h.poll()
    h.press([])
    h.poll()
    assert.equal(h.intents.at(-1), intent, `button ${button} carries ${intent}`)
  }
  assert.deepEqual(h.intents, ['down', 'up', 'left', 'right', 'primary', 'back', 'page-previous', 'page-next', 'mic'])
})

test('the shoulders change page whatever the desk is focused on', () => {
  // The page intents are not directions: the desk's `left` and `right` mean
  // different things in its two modes, and the shoulders must always change page.
  const h = harness({ pads: [standardPad()] })
  h.poll()
  h.press([RB])
  h.poll()
  h.press([])
  h.poll()
  h.press([LB])
  h.poll()
  assert.deepEqual(h.intents, ['page-next', 'page-previous'])
})

test('holding a direction repeats it after a first delay, then at a steady interval', () => {
  const h = harness({ pads: [standardPad()] })
  h.poll()
  h.press([DPAD_DOWN])
  h.poll()
  assert.deepEqual(h.intents, ['down'], 'the press moves the desk at once')

  h.advance(440)
  h.poll()
  assert.deepEqual(h.intents, ['down'], 'a hold shorter than the delay does not repeat')

  h.advance(20)
  h.poll()
  assert.deepEqual(h.intents, ['down', 'down'], 'the delay is about 450ms')

  h.advance(130)
  h.poll()
  h.advance(130)
  h.poll()
  assert.deepEqual(h.intents, ['down', 'down', 'down', 'down'], 'a held direction keeps moving')

  h.press([])
  h.poll()
  h.advance(2000)
  h.poll()
  assert.equal(h.intents.length, 4, 'releasing stops the repeat')
})

test('a press the desk already acted on is not acted on twice', () => {
  const h = harness({ pads: [standardPad([A])] })
  h.poll()
  h.poll()
  h.poll()
  assert.deepEqual(h.intents, ['primary'])
})

test('a pad the desk cannot read is stated but drives nothing', () => {
  const exotic = { index: 0, id: 'Some Other Device', connected: true, mapping: '', buttons: standardPad([A]).buttons }
  const h = harness({ pads: [exotic] })
  h.poll()
  assert.deepEqual(states(h.connections), [{ connected: true, id: 'Some Other Device', readable: false }])
  assert.deepEqual(h.intents, [])
})

test('the desk states a connected pad once, and states it again when it goes away', () => {
  const h = harness({ pads: [standardPad()] })
  h.poll()
  h.poll()
  assert.deepEqual(states(h.connections), [{ connected: true, id: 'Xbox Wireless Controller', readable: true }], 'presence is stated once')

  h.connect([{ index: 0, id: 'Xbox Wireless Controller', connected: false, mapping: 'standard', buttons: [] }])
  h.poll()
  h.poll()
  assert.deepEqual(
    states(h.connections),
    [{ connected: true, id: 'Xbox Wireless Controller', readable: true }, { connected: false, id: null, readable: false }],
    'going away is stated once too',
  )

  h.connect([standardPad()])
  h.poll()
  assert.equal(h.connections.length, 3, 'reconnecting is stated again')
})

test('an unreadable pad never hides a readable one', () => {
  const exotic = { index: 0, id: 'Some Other Device', connected: true, mapping: '', buttons: standardPad([A]).buttons }
  const second = { ...standardPad([RB]), index: 1, id: 'Second Controller' }
  const h = harness({ pads: [exotic, second] })
  h.poll()
  assert.deepEqual(h.intents, ['page-next'], 'the readable pad drives the desk')
  assert.deepEqual(states(h.connections), [{ connected: true, id: 'Second Controller', readable: true }])
})