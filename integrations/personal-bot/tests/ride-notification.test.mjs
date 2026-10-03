import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rideNotification } from '../src/ride-notification.mjs'

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
