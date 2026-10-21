'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { capturePaintedPage } = require('./helpers/native-page-capture')

function fixture() {
  const contents = new EventEmitter()
  const captures = []
  const image = { currentPixels: true }
  contents.invalidate = () => {}
  contents.capturePage = async (...args) => { captures.push(args); return image }
  const win = { webContents: contents, getContentSize: () => [480, 854] }
  const paint = (width = 480, height = 854, empty = false) => contents.emit('paint', {}, {}, {
    getSize: () => ({ width, height }), isEmpty: () => empty,
  })
  return { win, contents, captures, image, paint }
}

test('capture requires a full native frame, then returns current compositor pixels', async () => {
  const f = fixture()
  const pending = capturePaintedPage(f.win)
  f.paint(320, 480)
  f.paint(480, 854, true)
  assert.deepEqual(f.captures, [])
  f.paint()
  assert.equal(await pending, f.image)
  assert.deepEqual(f.captures, [[]])
  assert.equal(f.contents.listenerCount('paint'), 0)
  assert.equal(f.contents.listenerCount('destroyed'), 0)
})

test('crop captures retain the original rectangle and current pixels', async () => {
  const f = fixture()
  const rect = { x: 10, y: 20, width: 6, height: 40 }
  const pending = capturePaintedPage(f.win, rect)
  f.paint()
  assert.equal(await pending, f.image)
  assert.deepEqual(f.captures, [[rect]])
})

test('missing paint fails within a deadline and releases listeners', async () => {
  const f = fixture()
  await assert.rejects(capturePaintedPage(f.win, undefined, 10), /did not paint/)
  assert.equal(f.contents.listenerCount('paint'), 0)
  assert.equal(f.contents.listenerCount('destroyed'), 0)
  assert.deepEqual(f.captures, [])
})

test('window destruction and invalidation errors retain failures and release listeners', async () => {
  for (const invalidateFails of [false, true]) {
    const f = fixture()
    if (invalidateFails) f.contents.invalidate = () => { throw Error('invalidate failed') }
    const pending = capturePaintedPage(f.win)
    if (!invalidateFails) f.contents.emit('destroyed')
    await assert.rejects(pending, invalidateFails ? /invalidate failed/ : /closed before/)
    assert.equal(f.contents.listenerCount('paint'), 0)
    assert.equal(f.contents.listenerCount('destroyed'), 0)
    assert.deepEqual(f.captures, [])
  }
})

test('capture errors propagate without retries after native paint', async () => {
  const f = fixture()
  f.contents.capturePage = async () => { throw Error('UnknownVizError') }
  const pending = capturePaintedPage(f.win)
  f.paint()
  await assert.rejects(pending, /UnknownVizError/)
  assert.equal(f.contents.listenerCount('paint'), 0)
})
