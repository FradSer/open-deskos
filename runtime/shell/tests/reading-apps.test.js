const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

class Element {
  constructor() { this.children = []; this.text = ''; this.disabled = false; this.style = {}; this.classList = {add() {}}; this.clientWidth = 600; this.clientHeight = 600; this.offsetHeight = 100; this.scrollHeight = 100 }
  set textContent(text) { this.text = String(text); this.children = [] }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' ') }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.text = ''; this.children = children }
  setAttribute() {}
  addEventListener(event, handler) { this[event] = handler }
  querySelector(selector) { return this.children.find(child => child.className?.split(' ').includes(selector.slice(1))) || null }
}
async function renderApp(appId, snapshot, options = {}) {
  const plugins = []
  const nodes = new Map()
  const el = { querySelector(selector) {
    if (selector === '.reading-refresh' && !this.innerHTML.includes('reading-refresh')) return null
    if (!nodes.has(selector)) nodes.set(selector, new Element())
    return nodes.get(selector)
  } }
  const sandbox = {
    odkPlugins: { register: plugin => plugins.push(plugin) },
    odkPlatform: { getHydraStatus: async () => snapshot, getWeatherStatus: async () => snapshot, getWeReadHighlight: options.read || (async () => snapshot) },
    document: { createElement: () => new Element() },
    getSelection: () => ({isCollapsed: !options.selected}),
    getComputedStyle: () => ({paddingTop:'0',paddingBottom:'0',rowGap:'20'}),
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync('src/renderer/plugins/weread-typography.js', 'utf8'), context)
  vm.runInContext(fs.readFileSync('src/renderer/plugins/reading-apps.js', 'utf8'), context)
  const cleanups = []
  plugins.find(plugin => plugin.appId === appId).mount(el, { trackCleanup(fn) {cleanups.push(fn)}, onTick() {} })
  await new Promise(resolve => setImmediate(resolve))
  return { markup: el.innerHTML, status: nodes.get('.reading-status').textContent, content: nodes.get('.reading-content').textContent, contentNode: nodes.get('.reading-content'), surface: nodes.get('.reading-app'), release: () => cleanups.forEach(fn => fn()) }
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
    assert.match(auth.status,id === 'weread' ? /[Cc]lick/ : /Refresh/)
    const setup = await renderApp(id, {status:'unconfigured',highlight:null,current:null})
    assert.match(setup.status,/Connect/)
  })
  test(`${id} marks malformed live readings unavailable`, async () => {
    const rendered = await renderApp(id,{status:'live',highlight:'invalid',current:{temperature:'invalid'}})
    assert.match(rendered.status,/unavailable|incomplete/)
  })
}


test('WeRead App keeps its no-cover wrapper and title fallback', async () => {
  const rendered = await renderApp('weread', {status:'live',highlight:{markText:'A complete excerpt',title:'《 》',author:'Writer'}})
  const book = rendered.contentNode.children[1]
  assert.equal(book.children[0].children[0].textContent, 'WeRead')
  assert.equal(book.children[1].className, 'weread-cover-wrap')
  assert.equal(book.children[1].hidden, true)
  assert.doesNotMatch(rendered.markup, /reading-refresh|reading-head/)
})

test('WeRead clicks and keyboard refresh share a pending guard and stop after release', async () => {
  const snapshot = {status:'live',highlight:{markText:'Read this',title:'Book'}}
  let calls = 0
  let complete
  const rendered = await renderApp('weread', snapshot, {read() {
    calls++
    return calls === 1 ? Promise.resolve(snapshot) : new Promise(resolve => { complete = resolve })
  }})
  const surface = rendered.surface
  surface.click()
  surface.click()
  assert.equal(calls, 2)
  complete(snapshot)
  await new Promise(resolve => setImmediate(resolve))
  for (const key of ['Enter', ' ']) {
    let prevented = false
    surface.keydown({key,target:surface,preventDefault() {prevented=true},stopPropagation() {}})
    assert.equal(prevented,true)
    complete(snapshot)
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(calls,4)
  surface.keydown({key:' ',target:rendered.contentNode,preventDefault() {assert.fail('Excerpt scrolling must remain native')}})
  assert.equal(calls,4)
  surface.click()
  const beforeRelease = rendered.contentNode.textContent
  rendered.release()
  complete({status:'live',highlight:{markText:'Late response must stay hidden'}})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(rendered.contentNode.textContent,beforeRelease)
  surface.click()
  assert.equal(calls,5)
})

test('Selecting WeRead text does not refresh its reading', async () => {
  let calls = 0
  const rendered = await renderApp('weread', {}, {selected:true,read:async () => {calls++;return {status:'live',highlight:{markText:'Selected text'}}}})
  rendered.surface.click()
  assert.equal(calls,1)
})
