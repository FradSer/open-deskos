'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFrameReadyEvents } = require('../src/frame-ready')

test('frame events retain frame identity and release subscriptions', () => {
  const events = createFrameReadyEvents()
  const frames = []
  const unsubscribe = events.subscribe(frame => frames.push(frame))
  const frame = { send() {} }
  events.publish(frame)
  assert.equal(frames[0], frame)
  unsubscribe()
  unsubscribe()
  events.publish(frame)
  assert.equal(frames.length, 1)
})

test('frame listener failures do not block neighbors or escape as rejected promises', async () => {
  const failures = []
  const events = createFrameReadyEvents({ report: error => failures.push(error.message) })
  const calls = []
  events.subscribe(() => { throw Error('sync') })
  events.subscribe(async () => { throw Error('async') })
  events.subscribe(() => calls.push('neighbor'))
  events.publish({ send() {} })
  await Promise.resolve()
  assert.deepEqual(calls, ['neighbor'])
  assert.deepEqual(failures, ['sync', 'async'])
})

test('a removed listener is skipped during the current frame event', () => {
  const events = createFrameReadyEvents({ report() { throw Error('report unavailable') } })
  let remove
  let calls = 0
  events.subscribe(() => { remove(); throw Error('listener unavailable') })
  remove = events.subscribe(() => calls++)
  events.publish({ send() {} })
  assert.equal(calls, 0)
})
