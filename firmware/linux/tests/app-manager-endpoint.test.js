const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

test('lists app metadata and enforces one foreground UI app', () => {
  const endpoint = createAppManagerEndpoint({ apps: [
    { appId: 'clock', name: '时钟', kind: 'ui', version: '1', source: 'builtin', capabilities: [] },
    { appId: 'sensor', name: '传感器', kind: 'service', version: '1', source: 'sideload', capabilities: ['network'] },
  ] })
  assert.deepEqual(endpoint.list().map(({ appId, kind, state }) => ({ appId, kind, state })), [
    { appId: 'clock', kind: 'ui', state: 'installed' },
    { appId: 'sensor', kind: 'service', state: 'installed' },
  ])
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'clock' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'sensor' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'other' }).error, 'not-found')
})

test('rejects starting an app after removal', () => {
  const endpoint = createAppManagerEndpoint()
  assert.equal(endpoint.remove('clock').ok, true)
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'clock' }).error, 'not-installed')
})

test('routes lifecycle actions and rejects malformed intent', () => {
  const endpoint = createAppManagerEndpoint()
  assert.equal(endpoint.dispatch(null).error, 'invalid-intent')
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'pause' }).error, 'invalid-state')
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'start' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'pause' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'resume' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'stop' }).ok, true)
  assert.equal(endpoint.foreground(), null)
})
