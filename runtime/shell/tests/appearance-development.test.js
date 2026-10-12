'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const api = require('../src/renderer/core/appearance-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { loadAppearanceReplacements, loadDevelopmentPlugins } = require('../src/development-plugins')
const { buildUserAppDocument } = require('../src/user-app-content')

function replacement() {
  const original = api.createAppearancePlugins().find(plugin => plugin.manifest.id === 'odk.theme.pixel')
  return { ...original.manifest, version: '2.0.0', appearance: { theme: 'pixel', name: 'Selected Pixel', css: 'themes/pixel.css',
    faces: ['zpix'], extra: 'image-rendering:pixelated;', tokens: { '--odk-primary': '#fafafa' } } }
}

test('appearance startup discovery preserves a valid selection beside a damaged link', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-appearance-isolation-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(replacement()))
  const preference = folder => ({ development: { path: folder, grants: [], trustAcknowledgedAt: new Date().toISOString(), host: 'electron-renderer', replace: true } })
  const config = { version: 1, plugins: { 'odk.theme.instrument': preference(path.join(directory, 'missing')), 'odk.theme.pixel': preference(directory) } }
  const before = JSON.stringify(config)
  const errors = []
  const selected = loadAppearanceReplacements(config, { report: id => errors.push(id) })
  assert.deepEqual(selected.map(manifest => manifest.id), ['odk.theme.pixel'])
  assert.deepEqual(errors, ['odk.theme.instrument'])
  assert.throws(() => loadAppearanceReplacements(config), /ENOENT/)
  assert.equal(JSON.stringify(config), before)
  const plugins = api.selectAppearancePlugins(selected)
  assert.equal(plugins.find(plugin => plugin.manifest.id === 'odk.theme.instrument').manifest.version, '1.0.0')
  assert.equal(plugins.find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, '2.0.0')
})

test('CLI links pure appearance declarations without loading native or browser entries', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-appearance-dev-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(replacement()))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(directory, 'config') }
  const cli = path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js')
  const run = promisify(execFile)
  await assert.rejects(run(process.execPath, [cli, 'link', directory, '--replace'], { env }), /trust/)
  await run(process.execPath, [cli, 'link', directory, '--trust', '--replace'], { env })
  const config = () => readConfig(resolveConfigPath(env))
  const selected = loadAppearanceReplacements(config())
  assert.equal(selected[0].version, '2.0.0')
  assert.deepEqual(loadDevelopmentPlugins(config(), { host: 'electron-renderer' }), [])
  await run(process.execPath, [cli, 'disable', 'odk.theme.pixel'], { env })
  assert.deepEqual(loadAppearanceReplacements(config()), [])
  await run(process.execPath, [cli, 'enable', 'odk.theme.pixel'], { env })
  assert.equal(loadAppearanceReplacements(config()).length, 1)
  await run(process.execPath, [cli, 'remove', 'odk.theme.pixel'], { env })
  assert.deepEqual(loadAppearanceReplacements(config()), [])
  assert.equal(fs.existsSync(path.join(directory, 'manifest.json')), true)
})

test('selected declaration supplies renderer first-paint tokens and installed package context', async () => {
  const raw = replacement()
  const plugins = api.selectAppearancePlugins([raw])
  const runtime = api.createAppearanceHost({ plugins })
  await runtime.start()
  assert.equal(runtime.resolve('pixel').tokens['--odk-primary'], '#fafafa')
  const original = api.createAppearancePlugins().find(plugin => plugin.appearance.theme === 'pixel')
  assert.deepEqual(runtime.resolve('pixel').tokens, { ...original.appearance.tokens, '--odk-primary': '#fafafa' })
  assert.equal(runtime.list().find(item => item.manifest.id === raw.id).manifest.version, '2.0.0')
  const html = buildUserAppDocument({ manifest: { id: 'fixture', name: 'Fixture' }, html: '<html><body>Fixture</body></html>', revision: 'a'.repeat(32) },
    { theme: 'pixel', appearancePlugins: plugins })
  assert.match(html, /--odk-primary:#fafafa/)
  const styles = []
  let storageWrites = 0
  const window = { location: { search: '?appearanceReplacements=' + encodeURIComponent(JSON.stringify([raw])) },
    localStorage: { getItem: () => 'pixel', setItem() { storageWrites++ } } }
  const document = { documentElement: { dataset: {} }, adoptedStyleSheets: [], hidden: false, addEventListener() {}, querySelector: selector => styles.find(element => selector === `link[href="${element.href}"]`),
    createElement: () => ({ dataset: {} }), head: { appendChild: element => styles.push(element) } }
  class CSSStyleSheet { replaceSync(value) { this.textContent = value; styles.push(this) } }
  const context = vm.createContext({ window, document, structuredClone, AbortController, URLSearchParams, CSSStyleSheet, console })
  for (const file of ['src/plugin-host.js', 'src/renderer/core/appearance-plugins.js', 'src/renderer/core/theme.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context)
  }
  assert.equal(window.odkTheme.get(), 'pixel')
  assert.ok(styles.some(element => element.textContent?.includes('--odk-primary:#fafafa')))
  await window.odkTheme.ready
  assert.equal(window.odkTheme.catalog().find(item => item.manifest.id === raw.id).manifest.version, '2.0.0')
  const writesBeforeRecovery = storageWrites
  const stylesBeforeRecovery = styles.length
  const receipt = await window.odkTheme.restoreDefault(raw.id)
  assert.equal(receipt.implementation, 'built-in')
  assert.equal(receipt.version, '2.0.0', 'configured palette remains the recovery declaration')
  assert.equal(window.odkTheme.get(), 'pixel')
  assert.equal(storageWrites, writesBeforeRecovery, 'factory recovery must not rewrite preferences')
  assert.equal(styles.length, stylesBeforeRecovery, 'factory recovery must retain the configured styles')
  assert.equal(buildUserAppDocument({ manifest: { id: 'fixture', name: 'Fixture' }, html: '<html><body>Fixture</body></html>', revision: 'a'.repeat(32) },
    { theme: 'pixel', appearancePlugins: plugins }), html)
  await runtime.stop()
})

test('appearance selection rejects authority, asset, identity, and derived geometry changes', () => {
  for (const change of [
    raw => { raw.permissions = ['network'] }, raw => { raw.host = 'electron-main' },
    raw => { raw.appearance.theme = 'unknown' }, raw => { raw.entry = 'entry.js' },
    raw => { raw.appearance.css = '../outside.css' }, raw => { raw.appearance.tokens['--odk-cell'] = '100px' },
    raw => { raw.appearance.tokens['--odk-primary'] = 'url(https://example.invalid)' },
  ]) {
    const raw = replacement(); change(raw)
    assert.throws(() => api.selectAppearancePlugins([raw]), /appearance/)
  }
  assert.throws(() => api.selectAppearancePlugins([replacement(), replacement()]), /duplicate/)
})

test('palette declarations reject image functions and non-color values', () => {
  for (const value of ['image-set("https://example.invalid/image.png" 1x)', 'linear-gradient(red, blue)', 'var(--odk-font)', '#fff !important', 'red']) {
    const raw = replacement()
    raw.appearance.tokens['--odk-bg'] = value
    assert.throws(() => api.selectAppearancePlugins([raw]), /appearance/)
  }
})

test('invalid renderer selections restore packaged themes without applying tokens', async () => {
  for (const selection of ['not-json', JSON.stringify([replacement(), replacement()]), 'x'.repeat(49153)]) {
    const errors = []
    const window = { location: { search: '?appearanceReplacements=' + encodeURIComponent(selection) },
      localStorage: { getItem: () => 'pixel', setItem() {} } }
    const document = { documentElement: { dataset: {} }, hidden: false, addEventListener() {} }
    const context = vm.createContext({ window, document, structuredClone, AbortController, URLSearchParams,
      console: { error: error => errors.push(error) } })
    for (const file of ['src/plugin-host.js', 'src/renderer/core/appearance-plugins.js', 'src/renderer/core/theme.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context)
    }
    assert.equal(window.odkTheme.get(), 'pixel')
    await window.odkTheme.ready
    assert.equal(window.odkTheme.catalog().find(item => item.manifest.id === 'odk.theme.pixel').manifest.version, '1.0.0')
    assert.equal(errors.length, 1)
  }
})

test('Main launch query carries validated appearance data without code or asset paths', () => {
  const { rendererQuery } = require('../src/main')
  const raw = replacement()
  const query = rendererQuery({ disabledPlugins: [], appearanceReplacements: [raw] })
  assert.deepEqual(JSON.parse(new URLSearchParams(query).get('appearanceReplacements')), [raw])
  assert.equal(rendererQuery({ disabledPlugins: [], appearanceReplacements: [] }), '')
})
