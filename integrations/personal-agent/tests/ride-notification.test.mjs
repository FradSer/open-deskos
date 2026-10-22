import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRideNotifier, rideNotification } from '../src/ride-notification.mjs'

test('notifications present actual driver fields and label simulation without exposing raw data', () => {
  const message = rideNotification({ sandbox: true, phase: 'active', order: { statusCode: 1, driver: { name: '王师傅', carPlate: '京A12345', carModel: '黑色轿车', phone: 'private' }, map: { eta: '5' }, secret: 'hidden' } })
  assert.match(message, /模拟/)
  assert.match(message, /王师傅/)
  assert.match(message, /京A12345/)
  assert.match(message, /5/)
  assert.doesNotMatch(message, /private|hidden/)
  assert.match(rideNotification({ phase: 'unknown' }), /不要重复下单/)
  assert.equal(rideNotification({ phase: 'quoted' }), '')
  const uncertain = rideNotification({ sandbox: true, phase: 'unknown', order: { statusUnavailable: true, statusText: '司机已到达' } })
  assert.match(uncertain, /司机已到达/)
  assert.match(uncertain, /无法验证/)
  assert.match(uncertain, /不要重复下单/)
})

test('repeated uncertain polls notify once per order and later status changes still notify', () => {
  const notifications = []
  const update = createRideNotifier(message => notifications.push(message))
  const uncertain = { phase: 'unknown', quote: { id: 'quote-a' }, order: { statusUnavailable: true, statusText: '暂不可用' } }

  assert.equal(update(uncertain), true)
  assert.equal(update({ ...uncertain, order: { ...uncertain.order, statusText: '仍不可用' } }), false)
  assert.equal(notifications.length, 1)
  assert.match(notifications[0], /不要重复下单/)

  assert.equal(update({ phase: 'active', order: { orderId: 'order-a', statusCode: 1 } }), true)
  assert.equal(notifications.length, 2)
  assert.match(notifications[1], /已接单/)

  assert.equal(update({ phase: 'unknown', quote: { id: 'quote-b' } }), true)
  assert.equal(notifications.length, 3)
})
