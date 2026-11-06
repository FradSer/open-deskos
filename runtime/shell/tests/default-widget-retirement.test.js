const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const layoutContext = {}
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/config/desktop_layout.js'), 'utf8'), layoutContext)
const pages = layoutContext.DESKTOP_LAYOUT.pages
const homeIds = pages.find(page => page.id === 'home').widgets.map(widget => widget.id)
const deskIds = pages.find(page => page.id === 'desk').widgets.map(widget => widget.id)
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')

test('default layout removes Camera, Chatbot, and Settings while retaining Weather and Hydra', () => {
  assert.equal(homeIds.includes('odk.tile.camera'), false)
  assert.equal(homeIds.includes('odk.tile.weather'), true)
  assert.equal(deskIds.includes('odk.tile.chat'), false)
  assert.equal(deskIds.includes('odk.tile.settings'), false)
  assert.equal(deskIds.includes('odk.tile.hydra'), true)
})

test('renderer does not load retired widgets and retains the built-in Weather implementation', () => {
  for (const filename of ['camera.js', 'chat.js', 'settings.js']) {
    assert.equal(fs.existsSync(path.join(root, 'src/renderer/plugins', filename)), false, `${filename} is removed`)
    assert.equal(html.includes(`plugins/${filename}`), false, `${filename} is not loaded`)
  }
  assert.equal(fs.existsSync(path.join(root, 'src/renderer/plugins/weather.js')), true)
  assert.equal(html.includes('plugins/weather.js'), true)
  assert.equal(fs.existsSync(path.join(root, 'src/weather-source.js')), true)
})


test('retired time and pre-order views have no implementation, entry, asset, or catalog record', () => {
  for (const file of ['clock.js', 'almanac.js', 'preorder.js']) {
    assert.equal(fs.existsSync(path.join(root, 'src/renderer/plugins', file)), false, file)
    assert.equal(html.includes(`plugins/${file}`), false, file)
  }
  assert.equal(fs.existsSync(path.join(root, 'src/renderer/assets/hero-preorder.jpg')), false)
  const catalog = require('../src/app-manager-endpoint').createAppManagerEndpoint().list()
  for (const id of ['clock', 'calendar', 'preorder']) assert.equal(catalog.some(app => app.appId === id), false, id)
  const reading = pages.find(page => page.id === 'reading')
  assert.equal(pages.indexOf(reading), pages.findIndex(page => page.id === 'desk') + 1)
  assert.deepEqual(JSON.parse(JSON.stringify(reading.widgets)), [{ id: 'odk.tile.weread', opensApp: 'weread', col: '1 / 4', row: '1 / 4' }])
  assert.equal(pages.some(page => page.id === 'preorder'), false)
})
