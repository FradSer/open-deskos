const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginRpcRouter } = require('../src/plugin-rpc')

test('plugin RPC router routes authorized requests to registered backend handler', async () => {
  const router = createPluginRpcRouter({
    manifests: new Map([
      ['odk.plugin.sample', {
        id: 'odk.plugin.sample',
        schemaVersion: 1,
        permissions: ['hardware:process:scan'],
      }],
    ]),
  })

  router.registerHandler('odk.plugin.sample', 'scanSessions', async (payload) => {
    return { ok: true, sessions: [123], filter: payload.filter }
  }, 'hardware:process:scan')

  const res = await router.dispatch({
    pluginId: 'odk.plugin.sample',
    action: 'scanSessions',
    payload: { filter: 'running' },
  })

  assert.deepEqual(res, { ok: true, sessions: [123], filter: 'running' })
})

test('plugin RPC router rejects unauthorized or missing permission requests', async () => {
  const router = createPluginRpcRouter({
    manifests: new Map([
      ['odk.plugin.unauthorized', {
        id: 'odk.plugin.unauthorized',
        schemaVersion: 1,
        permissions: [],
      }],
    ]),
  })

  router.registerHandler('odk.plugin.unauthorized', 'secretAction', async () => {
    return { ok: true }
  }, 'system:privilege:raw')

  await assert.rejects(
    async () => router.dispatch({
      pluginId: 'odk.plugin.unauthorized',
      action: 'secretAction',
    }),
    /permission-denied/
  )
})

test('plugin RPC router rejects unknown plugin or unhandled action', async () => {
  const router = createPluginRpcRouter({ manifests: new Map() })

  await assert.rejects(
    async () => router.dispatch({
      pluginId: 'odk.plugin.unknown',
      action: 'any',
    }),
    /unknown-plugin/
  )
})
