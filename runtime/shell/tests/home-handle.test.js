const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
function fixture(close = async () => {}) {
  const root = new EventTarget(), handle = new EventTarget(), capture = new Set(), styles = new Map(), errors = []
  let open = true, externalOpen = false, blocked = false, pinchEnabled = true, calls = 0
  handle.setPointerCapture = id => capture.add(id)
  handle.hasPointerCapture = id => capture.has(id)
  handle.releasePointerCapture = id => capture.delete(id)
  handle.dataset = {}; handle.removeAttribute = () => {}
  const card = { clientHeight: 600, style: {
    set transform(v) { styles.set('transform', v) }, set opacity(v) { styles.set('opacity', v) }, removeProperty(k) { styles.delete(k) },
  } }
  card.contains = node => node === card
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/home-handle.js'), 'utf8'), { window: root, AbortController, Promise })
  const controller = root.odkHomeHandle.bind({ handle, card, isOpen: () => open, canPinch: () => pinchEnabled, canReturn: () => open || externalOpen, blocked: () => blocked,
    returnHome: async () => { calls++; await close() }, reportError: error => errors.push(error) })
  function send(type, values = {}, target = handle) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, ...values })
    target.dispatchEvent(event); return event
  }
  return { root, handle, card, controller, styles, errors, capture, send, calls: () => calls,
    move(dx, dy) { send('pointerdown'); send('pointermove', { clientX: 100 + dx, clientY: 100 + dy }) },
    release() { send('pointerup') }, tick: () => new Promise(resolve => setImmediate(resolve)),
    setOpen(v) { open = v }, setExternalOpen(v) { externalOpen = v }, setBlocked(v) { blocked = v }, setPinchEnabled(v) { pinchEnabled = v } }
}

test('upward handle drag returns once and releases capture and presentation state', async () => {
  const f = fixture(); f.move(0, -96)
  assert.equal(f.styles.get('transform'), 'translateY(-96px)')
  f.release(); await f.tick()
  assert.equal(f.calls(), 1); assert.equal(f.styles.size, 0); assert.equal(f.capture.size, 0); f.controller.destroy()
})
for (const [name, dx, dy] of [['short', 0, -16], ['down', 0, 96], ['horizontal', 96, 0], ['diagonal', 100, -96]]) {
  test(`${name} drag cannot return`, async () => {
    const f = fixture(); f.move(dx, dy); f.release(); await f.tick()
    assert.equal(f.calls(), 0); assert.equal(f.styles.size, 0); f.controller.destroy()
  })
}
for (const boundary of ['pointercancel', 'lostpointercapture', 'blur', 'resize', 'odk-personal-agent-visibility']) {
  test(`${boundary} cancels return`, async () => {
    const f = fixture(); f.move(0, -96)
    f.send(boundary, {}, ['blur', 'resize', 'odk-personal-agent-visibility'].includes(boundary) ? f.root : f.handle)
    f.release(); await f.tick()
    assert.equal(f.calls(), 0); assert.equal(f.styles.size, 0); assert.equal(f.capture.size, 0); f.controller.destroy()
  })
}
test('a secondary pointer cancels the pending return', async () => {
  const f = fixture(); f.move(0, -96); f.send('pointerdown', { pointerId: 2, isPrimary: false }, f.root)
  f.release(); await f.tick(); assert.equal(f.calls(), 0); f.controller.destroy()
})
test('a foreign release cannot commit the current gesture', async () => {
  const f = fixture(); f.move(0, -96); f.send('pointerup', { pointerId: 2 }); await f.tick()
  assert.equal(f.calls(), 0); f.controller.destroy()
})
test('closed foreground and modal ownership block return', async () => {
  const f = fixture(); f.setOpen(false); f.move(0, -96); f.release(); await f.tick(); assert.equal(f.calls(), 0)
  f.setOpen(true); f.setBlocked(true); f.move(0, -96); f.release(); await f.tick(); assert.equal(f.calls(), 0); f.controller.destroy()
})
test('modal ownership acquired during a gesture cancels it', async () => {
  const f = fixture(); f.move(0, -32); f.setBlocked(true); f.send('pointermove', { clientY: 0 }); f.release(); await f.tick()
  assert.equal(f.calls(), 0); assert.equal(f.styles.size, 0); f.controller.destroy()
})
test('a failed close reports the failure and permits retry', async () => {
  let reject = true
  const f = fixture(async () => { if (reject) throw Error('retained cleanup') })
  f.move(0, -96); f.release(); await f.tick(); assert.equal(f.errors[0].message, 'retained cleanup')
  reject = false; f.move(0, -96); f.release(); await f.tick(); assert.equal(f.calls(), 2); f.controller.destroy()
})
test('pending close cannot be dispatched twice', async () => {
  let settle
  const f = fixture(() => new Promise(resolve => { settle = resolve }))
  f.controller.requestReturn(); await f.tick(); f.controller.requestReturn(); assert.equal(f.calls(), 1)
  settle(); await f.tick(); f.controller.destroy()
})
test('the focused handle provides a keyboard equivalent and releases listeners', async () => {
  const f = fixture(); const key = f.send('keydown', { key: 'ArrowUp', repeat: false })
  assert.equal(key.defaultPrevented, true); await f.tick(); assert.equal(f.calls(), 1)
  f.controller.destroy(); f.send('keydown', { key: 'ArrowUp' }); await f.tick(); assert.equal(f.calls(), 1)
})

function pagerFixture() {
  class Surface extends EventTarget {
    constructor() {
      super(); this.style = {}; this.dataset = {}; this.hidden = false; this.attributes = new Map(); this.capture = new Set()
      const classes = new Set()
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name) } }
    }
    setAttribute(name, value) { this.attributes.set(name, value) }
    removeAttribute(name) { this.attributes.delete(name) }
    hasPointerCapture(id) { return this.capture.has(id) }
    setPointerCapture(id) { this.capture.add(id) }
    releasePointerCapture(id) { this.capture.delete(id) }
  }
  const root = new Surface(), handle = new Surface(), viewport = new Surface(), track = new Surface()
  const dots = [new Surface(), new Surface()]
  viewport.clientWidth = 1000; track.children = [{ dataset: { surface: 'display' } }, { dataset: { surface: 'display' } }]
  const document = { activeElement: null, getElementById: id => id === 'app-view' ? { hidden: true } : handle,
    querySelectorAll: () => dots }
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/shell.js'), 'utf8')
  const pagerCode = source.slice(source.indexOf('function createPager('), source.indexOf('\nasync function main()'))
  const context = { window: root, document, DRAG_SUPPRESS_PX: 8, SWIPE_THRESHOLD_RATIO: 0.18 }
  vm.runInNewContext(pagerCode + '\nthis.create = createPager', context)
  const pager = context.create(viewport, track, ['Home', 'Desk'], () => {})
  function send(type, x, target = handle) {
    const event = new Event(type)
    Object.assign(event, { pointerId: 1, clientX: x, clientY: 100, isPrimary: true, button: 0, detail: 1 })
    target.dispatchEvent(event)
  }
  return { root, handle, track, pager, send }
}
for (const boundary of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`Home handle ${boundary} preserves the current page and restores its position`, () => {
    const f = pagerFixture(); f.send('pointerdown', 100); f.send('pointermove', 0)
    f.send(boundary, 0, boundary === 'blur' ? f.root : f.handle)
    assert.equal(f.pager.currentIndex(), 0)
    assert.equal(f.track.style.transform, 'translateX(0px)')
    assert.equal(f.handle.capture.size, 0)
  })
}

function twoTouches(f, points) {
  return points.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY, target: f.card }))
}
function pinch(f, points = [[1, 140, 160], [2, 260, 160]]) {
  f.send('touchstart', { touches: twoTouches(f, [[1, 100, 160]]) }, f.root)
  f.send('touchstart', { touches: twoTouches(f, [[1, 100, 160], [2, 300, 160]]) }, f.root)
  return f.send('touchmove', { touches: twoTouches(f, points) }, f.root)
}
test('a completed inward pinch uses the same return path once without changing card presentation', async () => {
  const f = fixture(); const move = pinch(f)
  assert.equal(move.defaultPrevented, true)
  assert.equal(f.calls(), 0, 'A pending gesture must not return before release')
  f.send('touchend', { touches: [] }, f.root); f.send('touchend', { touches: [] }, f.root)
  await f.tick(); assert.equal(f.calls(), 1); assert.equal(f.styles.size, 0); f.controller.destroy()
})
for (const [name, points] of [
  ['parallel scrolling', [[1, 100, 80], [2, 300, 80]]],
  ['spreading', [[1, 60, 160], [2, 340, 160]]],
  ['short contraction', [[1, 115, 160], [2, 285, 160]]],
  ['mostly translating', [[1, 240, 160], [2, 360, 160]]],
]) test(`${name} cannot be a return pinch or consume scrolling`, async () => {
  const f = fixture(); const event = pinch(f, points)
  assert.equal(event.defaultPrevented, false); f.send('touchend', { touches: [] }, f.root)
  await f.tick(); assert.equal(f.calls(), 0); f.controller.destroy()
})
for (const boundary of ['touchcancel', 'blur', 'resize', 'odk-personal-agent-visibility', 'modal', 'closed', 'third touch', 'foreign touch', 'changed identity']) {
  test(`pinch ${boundary} cancels without rearming before all fingers lift`, async () => {
    const f = fixture(); pinch(f)
    if (boundary === 'modal') f.setBlocked(true)
    else if (boundary === 'closed') f.setOpen(false)
    else if (boundary === 'third touch') f.send('touchstart', { touches: twoTouches(f, [[1, 140, 160], [2, 260, 160], [3, 200, 200]]) }, f.root)
    else if (boundary === 'foreign touch') f.send('touchmove', { touches: [{ identifier: 1, clientX: 140, clientY: 160, target: f.root }, ...twoTouches(f, [[2, 260, 160]])] }, f.root)
    else if (boundary === 'changed identity') f.send('touchmove', { touches: twoTouches(f, [[3, 140, 160], [2, 260, 160]]) }, f.root)
    else f.send(boundary, { touches: [] }, f.root)
    f.send('touchmove', { touches: twoTouches(f, [[1, 160, 160], [2, 240, 160]]) }, f.root)
    f.send('touchend', { touches: [] }, f.root)
    await f.tick(); assert.equal(f.calls(), 0); f.controller.destroy()
  })
}
test('pinch close failure permits a new gesture after all touches end and destroy removes touch listeners', async () => {
  let reject = true; const f = fixture(async () => { if (reject) throw Error('retained cleanup') })
  pinch(f); f.send('touchend', { touches: [] }, f.root); await f.tick(); assert.equal(f.errors.length, 1)
  reject = false; pinch(f); f.send('touchend', { touches: [] }, f.root); await f.tick(); assert.equal(f.calls(), 2)
  f.controller.destroy(); pinch(f); f.send('touchend', { touches: [] }, f.root); await f.tick(); assert.equal(f.calls(), 2)
})
test('wheel and Ctrl-wheel never return an App', async () => {
  const f = fixture()
  for (const ctrlKey of [false, true]) assert.equal(f.send('wheel', { ctrlKey, deltaY: -100 }, f.root).defaultPrevented, false)
  await f.tick(); assert.equal(f.calls(), 0); f.controller.destroy()
})

test('non-App views retain handle return but cannot acquire pinch ownership', async () => {
  const f = fixture(); f.setPinchEnabled(false); pinch(f); f.send('touchend', { touches: [] }, f.root)
  await f.tick(); assert.equal(f.calls(), 0)
  f.send('keydown', { key: 'ArrowUp', repeat: false }); await f.tick(); assert.equal(f.calls(), 1); f.controller.destroy()
})

test('an installed App may request return without intercepting pager dot navigation', async () => {
  const f = fixture(); f.setOpen(false); f.setExternalOpen(true)
  const event = f.send('click', { detail: 0 })
  assert.equal(event.defaultPrevented, false)
  f.controller.requestReturn(); await f.tick(); assert.equal(f.calls(), 1)
  f.setBlocked(true); f.controller.requestReturn(); await f.tick(); assert.equal(f.calls(), 1)
  f.controller.destroy()
})

for(const [start,contraction,expected] of [[79,48,true],[80,48,true],[48,48,true],[48,47,false],[47,47,false]]) {
  test(`pinch from ${start}px with ${contraction}px contraction follows only the documented thresholds`,async()=>{
    const f=fixture(),points=span=>twoTouches(f,[[1,200-span/2,160],[2,200+span/2,160]])
    f.send('touchstart',{touches:points(start)},f.root)
    const move=f.send('touchmove',{touches:points(start-contraction)},f.root)
    assert.equal(move.defaultPrevented,expected)
    f.send('touchend',{touches:[]},f.root);await f.tick();assert.equal(f.calls(),expected?1:0);f.controller.destroy()
  })
}
