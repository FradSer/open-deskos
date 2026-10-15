const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

class Element {
  constructor() { this.children = []; this.text = ''; this.disabled = false }
  set textContent(text) { this.text = String(text); this.children = [] }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' ') }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.text = ''; this.children = children }
  addEventListener(event, handler) { this[event] = handler }
}
async function renderApp(appId, snapshot) {
  const plugins = []
  const nodes = new Map()
  const el = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Element())
    return nodes.get(selector)
  } }
  vm.runInNewContext(fs.readFileSync('src/renderer/plugins/reading-apps.js', 'utf8'), {
    odkPlugins: { register: plugin => plugins.push(plugin) },
    odkPlatform: { getHydraStatus: async () => snapshot, getWeatherStatus: async () => snapshot, getWeReadHighlight: async () => snapshot },
    document: { createElement: () => new Element() },
  })
  plugins.find(plugin => plugin.appId === appId).mount(el, { trackCleanup() {}, onTick() {} })
  await new Promise(resolve => setImmediate(resolve))
  return { status: nodes.get('.reading-status').textContent, content: nodes.get('.reading-content').textContent }
}

test('Hydra App marks controller loss and never presents a retained pump as current watering', async () => {
  const rendered = await renderApp('hydra', { configured: true, connected: true, mainOnline: false,
    env: { tempC: 24, stale: true }, nodes: [{ id: 1, online: true, stale: true, pump: true, soilPercent: 63 }] })
  assert.match(rendered.status, /Offline/)
  assert.match(rendered.content, /Stale.*63%/)
  assert.doesNotMatch(rendered.content, /Watering/)
})

test('Hydra App shows watering only for a current online plant', async () => {
  const rendered = await renderApp('hydra', { configured: true, connected: true, mainOnline: true,
    env: { stale: false }, nodes: [{ id: 1, online: true, stale: false, pump: true, soilPercent: 63 }] })
  assert.match(rendered.content, /Watering/)
})

for (const id of ['weather', 'weread']) {
  test(`${id} explains authorization and setup without raw state identifiers`, async () => {
    const auth = await renderApp(id, {status:'needs-auth',highlight:null,current:null})
    assert.doesNotMatch(auth.status,/needs-auth/)
    assert.match(auth.status,/authorization/)
    assert.match(auth.status,/Refresh/)
    const setup = await renderApp(id, {status:'unconfigured',highlight:null,current:null})
    assert.match(setup.status,/Connect/)
  })
  test(`${id} marks malformed live readings unavailable`, async () => {
    const rendered = await renderApp(id,{status:'live',highlight:'invalid',current:{temperature:'invalid'}})
    assert.match(rendered.status,/unavailable|incomplete/)
  })
}
