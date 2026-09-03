const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

test('ships English names for every built-in view', () => {
  const endpoint = createAppManagerEndpoint()
  assert.deepEqual(endpoint.list().map((app) => app.name), [
    'Calendar', 'Clock', 'Pomodoro', 'Year progress', 'System status', 'Built-in views', 'Pi Sessions',
  ])
})

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

test('preserves the foreground app when the target is removed', () => {
  const endpoint = createAppManagerEndpoint()
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'pomodoro' }).ok, true)
  assert.equal(endpoint.remove('clock').ok, true)
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'clock' }).error, 'not-installed')
  assert.equal(endpoint.foreground().appId, 'pomodoro')
  assert.equal(endpoint.get('pomodoro').state, 'running')
})

test('keeps removed apps removed when stop is requested', () => {
  const endpoint = createAppManagerEndpoint()
  assert.equal(endpoint.remove('clock').ok, true)
  assert.equal(endpoint.stop('clock').error, 'not-installed')
  assert.equal(endpoint.get('clock').state, 'removed')
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'clock' }).error, 'not-installed')
})

test('switches foreground apps only after the target is accepted', () => {
  const endpoint = createAppManagerEndpoint()
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'clock' }).ok, true)
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'missing' }).error, 'not-found')
  assert.equal(endpoint.foreground().appId, 'clock')
  assert.equal(endpoint.dispatch({ type: 'open-app', appId: 'pomodoro' }).ok, true)
  assert.equal(endpoint.foreground().appId, 'pomodoro')
  assert.equal(endpoint.get('clock').state, 'stopped')
  assert.equal(endpoint.dispatch({ type: 'action', appId: 'pomodoro', action: 'stop' }).ok, true)
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
