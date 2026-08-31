const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync('src/preload.js', 'utf8')

function loadPreload() {
  const exposed = {}
  const listeners = new Map()
  const invokes = []
  const ipcRenderer = {
    invoke(channel, payload) {
      invokes.push([channel, payload])
      if (channel === 'odk-remote-link-state') {
        return Promise.resolve({ state: 'disconnected', sequence: 1 })
      }
      return Promise.resolve(true)
    },
    on(channel, callback) {
      listeners.set(channel, callback)
    },
    removeListener(channel, callback) {
      if (listeners.get(channel) === callback) listeners.delete(channel)
    },
  }
  vm.runInNewContext(source, {
    require(id) {
      assert.equal(id, 'electron')
      return {
        contextBridge: { exposeInMainWorld(name, value) { exposed[name] = value } },
        ipcRenderer,
      }
    },
  })
  return { exposed, listeners, invokes }
}

test('exposes platform actions and only narrow remote state APIs to the sandboxed renderer', async () => {
  const { exposed, listeners, invokes } = loadPreload()

  assert.deepEqual(Object.keys(exposed.odkPlatform).sort(), ['dispatchIntent', 'getAppState', 'getFaceAgentStatus', 'getOpenCodeGoStatus', 'listApps'])
  await exposed.odkPlatform.getOpenCodeGoStatus()
  assert.deepEqual(invokes[0], ['odk-opencode-go-status', undefined])
  await exposed.odkPlatform.getFaceAgentStatus()
  assert.deepEqual(invokes[1], ['odk-face-agent-status', undefined])
  await exposed.odkRemote.publishPageState({ page: 1 })
  assert.deepEqual(invokes[2], ['odk-remote-publish-page-state', { page: 1 }])

  const states = []
  const unsubscribe = exposed.odkRemote.subscribeLinkState((state) => states.push(state))
  listeners.get('odk-remote-link-state')(null, { state: 'usb', sequence: 2 })
  await Promise.resolve()
  assert.deepEqual(states, ['usb'])

  const navigations = []
  const unsubscribeNavigation = exposed.odkRemote.subscribeNavigation((direction) => navigations.push(direction))
  listeners.get('odk-remote-navigation')(null, { direction: 'next' })
  assert.deepEqual(navigations, ['next'])

  unsubscribe()
  unsubscribeNavigation()
  assert.equal(listeners.has('odk-remote-link-state'), false)
  assert.equal(listeners.has('odk-remote-navigation'), false)
})
