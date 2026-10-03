const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const overlaySource = fs.readFileSync('src/renderer/core/overlay-alerts.js', 'utf8')

test('overlay alerts manager mounts alert card and auto-dismisses after timeout', async () => {
  const elements = []
  const fakeContainer = {
    children: [],
    append(el) {
      this.children.push(el)
      elements.push(el)
    },
    replaceChildren() {
      this.children = []
    },
  }

  const fakeDoc = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        dataset: {},
        style: {},
        children: [],
        setAttribute(k, v) { this[k] = v },
        append(child) { this.children.push(child) },
        remove() {
          const idx = fakeContainer.children.indexOf(this)
          if (idx !== -1) fakeContainer.children.splice(idx, 1)
        },
        querySelector() { return null },
      }
    },
  }

  const root = {
    document: fakeDoc,
  }
  const context = vm.createContext({ window: root, globalThis: root, document: fakeDoc, setTimeout, clearTimeout })
  vm.runInContext(overlaySource, context)

  const manager = root.odkOverlayAlerts.create({ container: fakeContainer })
  assert.ok(manager)

  const alertId = manager.postAlert({
    title: 'Audio STT',
    message: 'Speech transcription started',
    level: 'info',
    timeoutMs: 100,
  })

  assert.ok(alertId)
  assert.equal(manager.activeAlerts().length, 1)
  assert.equal(fakeContainer.children.length, 1)

  const card = fakeContainer.children[0]
  assert.equal(card.dataset.level, 'info')

  // Wait for auto dismiss
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(manager.activeAlerts().length, 0)
  assert.equal(fakeContainer.children.length, 0)
})

test('overlay alerts manager rejects malformed or empty payloads', () => {
  const fakeContainer = { append() {}, replaceChildren() {} }
  const root = { document: {} }
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(overlaySource, context)

  const manager = root.odkOverlayAlerts.create({ container: fakeContainer })
  assert.throws(() => manager.postAlert(null), /invalid-alert-payload/)
  assert.throws(() => manager.postAlert({ message: '' }), /invalid-alert-payload/)
})
