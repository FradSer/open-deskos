'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')
const { capturePaintedPage } = require('./helpers/native-page-capture')

function fixture({ forcedColors = false } = {}) {
  const contents = new EventEmitter()
  const elements = new Map()
  const style = () => new Proxy({}, {
    set(properties, key, value) {
      // CSSStyleDeclaration.cssText replaces all previous inline declarations.
      if (key === 'cssText') for (const name of Object.keys(properties)) delete properties[name]
      properties[key] = value
      return true
    },
  })
  const document = {
    createElement() {
      return { style: style(), children: [], setAttribute(name, value) { this[name] = value }, append(...children) { this.children.push(...children) }, remove() { elements.delete(this.id) } }
    },
    getElementById: id => elements.get(id),
    documentElement: { append(node) { elements.set(node.id, node) } },
  }
  let invalidations = 0
  contents.invalidate = () => { invalidations++ }
  contents.executeJavaScript = async source => vm.runInNewContext(source, { document })
  contents.capturePage = async () => { throw Error('UnknownVizError: current compositor capture must not run') }
  const win = { webContents: contents, getContentSize: () => [480, 854] }
  function frame({ marked = false, width = 480, height = 854, empty = false } = {}) {
    const marker = [...elements.values()][0]
    const pixels = Buffer.alloc(8 * 8 * 4)
    if (marked && marker) {
      marker.children.forEach((child, index) => {
        const value = forcedColors && marker.style.forcedColorAdjust !== 'none' ? 255 : Number(child.style.backgroundColor.match(/\d+/)[0])
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const offset = (((index >> 1) * 4 + y) * 8 + (index % 2) * 4 + x) * 4
          pixels.fill(value, offset, offset + 3); pixels[offset + 3] = 255
        }
      })
    }
    const crops = []
    const image = { getSize: () => ({ width, height }), isEmpty: () => empty, crop(rect) { crops.push(rect); return { toBitmap: () => pixels, cropOf: image, rect } } }
    return { image, crops }
  }
  const paint = options => { const f = frame(options); contents.emit('paint', {}, {}, f.image); return f }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  return { win, contents, elements, paint, frame, flush, invalidations: () => invalidations }
}

test('capture requires marker pixels and then a clean full native frame', async () => {
  const f = fixture()
  let settled = false
  const pending = capturePaintedPage(f.win).then(value => { settled = true; return value })
  await f.flush()
  assert.equal(f.elements.size, 1, 'capture has an owned transient marker')
  const marker = [...f.elements.values()][0]
  assert.equal(marker['aria-hidden'], 'true')
  assert.equal(marker.inert, true)
  assert.match(marker.style.cssText, /pointer-events:none/)
  f.paint(); f.paint({ marked: true, width: 320, height: 480 }); f.paint({ marked: true, empty: true })
  await f.flush(); assert.equal(settled, false, 'stale, partial, and empty frames do not acknowledge the marker')
  const staleMarker = f.frame({ marked: true })
  f.paint({ marked: true }); await f.flush()
  assert.equal(f.elements.size, 0, 'the observed marker is removed before capture completes')
  f.contents.emit('paint', {}, {}, staleMarker.image); await f.flush()
  assert.equal(settled, false, 'a queued marker frame cannot acknowledge removal')
  const clean = f.paint()
  assert.equal(await pending, clean.image)
  assert.equal(f.contents.listenerCount('paint'), 0)
  assert.equal(f.contents.listenerCount('destroyed'), 0)
})

test('crop retains original native rectangle after clean-frame acknowledgement', async () => {
  const f = fixture(), rect = { x: 10, y: 20, width: 6, height: 40 }
  const pending = capturePaintedPage(f.win, rect)
  await f.flush(); f.paint({ marked: true }); await f.flush()
  const clean = f.paint()
  const result = await pending
  assert.equal(result.cropOf, clean.image)
  assert.deepEqual(result.rect, rect)
})

test('missing marker or missing clean paint fails and removes transient state', async () => {
  for (const showMarker of [false, true]) {
    const f = fixture()
    const pending = capturePaintedPage(f.win, undefined, 20)
    const rejected = assert.rejects(pending, /did not paint/)
    await f.flush(); if (showMarker) { f.paint({ marked: true }); await f.flush() }
    await rejected; await f.flush()
    assert.equal(f.elements.size, 0)
    assert.equal(f.contents.listenerCount('paint'), 0)
    assert.equal(f.contents.listenerCount('destroyed'), 0)
  }
})

test('destruction, invalidation, and renderer errors retain failure and release state', async () => {
  for (const failure of ['destroyed', 'invalidate', 'renderer']) {
    const f = fixture()
    if (failure === 'invalidate') f.contents.invalidate = () => { throw Error('invalidate failed') }
    if (failure === 'renderer') f.contents.executeJavaScript = async () => { throw Error('renderer failed') }
    const pending = capturePaintedPage(f.win)
    const rejected = assert.rejects(pending, failure === 'destroyed' ? /closed before/ : new RegExp(failure + ' failed'))
    await f.flush(); if (failure === 'destroyed') f.contents.emit('destroyed')
    await rejected; await f.flush()
    assert.equal(f.elements.size, 0)
    assert.equal(f.contents.listenerCount('paint'), 0)
    assert.equal(f.contents.listenerCount('destroyed'), 0)
  }
})

test('native pixel errors remain failures without a second capture path', async () => {
  const f = fixture()
  const pending = capturePaintedPage(f.win)
  const rejected = assert.rejects(pending, /bitmap failed/)
  await f.flush()
  const broken = f.frame({ marked: true }).image
  broken.crop = () => { throw Error('bitmap failed') }
  f.contents.emit('paint', {}, {}, broken)
  await rejected; await f.flush()
  assert.equal(f.elements.size, 0)
  assert.equal(f.contents.listenerCount('paint'), 0)
})

// Forced colors remap CSS backgrounds unless the transient probe opts out.
test('forced colors retain marker pixels without changing the document appearance', async () => {
  const f = fixture({ forcedColors: true })
  const pending = capturePaintedPage(f.win, undefined, 30)
  const result = assert.doesNotReject(pending)
  await f.flush(); f.paint({ marked: true }); await f.flush()
  const clean = f.paint()
  await result
  assert.equal(await pending, clean.image)
  assert.equal(f.elements.size, 0)
})
