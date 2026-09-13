const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createTracker, BURST_MS } = require('../src/renderer/core/remote-burst.js')

function clock(start = 1000) {
  let now = start
  return {
    now: () => now,
    advance(ms) {
      now += ms
    },
  }
}

test('an isolated up or down is not a scroll burst', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  assert.equal(tracker.observe('up'), false)
})

test('a same-direction repeat inside the burst window is a scroll burst', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  time.advance(BURST_MS - 1)
  assert.equal(tracker.observe('down'), true)
})

test('a repeat past the burst window starts over', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  time.advance(BURST_MS)
  assert.equal(tracker.observe('down'), false)
})

test('a direction change is not a scroll burst', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  time.advance(10)
  assert.equal(tracker.observe('up'), false)
  time.advance(10)
  assert.equal(tracker.observe('left'), false)
})

test('left and right never scroll', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('left'), false)
  time.advance(10)
  assert.equal(tracker.observe('left'), false)
  time.advance(10)
  assert.equal(tracker.observe('right'), false)
})

test('a press in between breaks the burst', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  time.advance(10)
  assert.equal(tracker.observe('primary'), false)
  time.advance(10)
  assert.equal(tracker.observe('down'), false)
})

test('mic, back, and action inputs break the burst', () => {
  for (const breaker of ['mic', 'back', 'action']) {
    const time = clock()
    const tracker = createTracker(time.now)
    assert.equal(tracker.observe('up'), false)
    time.advance(10)
    assert.equal(tracker.observe(breaker), false)
    time.advance(10)
    assert.equal(tracker.observe('up'), false)
  }
})

test('the burst keeps scrolling while the finger stays down', () => {
  const time = clock()
  const tracker = createTracker(time.now)
  assert.equal(tracker.observe('down'), false)
  for (let step = 0; step < 3; step += 1) {
    time.advance(50)
    assert.equal(tracker.observe('down'), true)
  }
})
