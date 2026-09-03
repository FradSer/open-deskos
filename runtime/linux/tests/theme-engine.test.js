const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const themeSource = fs.readFileSync('src/renderer/core/theme.js', 'utf8')

test('theme engine registers themes and applies token variables to root element', () => {
  const styles = new Map()
  const fakeDocElement = {
    style: {
      setProperty(key, val) { styles.set(key, val) },
      getPropertyValue(key) { return styles.get(key) || '' },
      removeProperty(key) { styles.delete(key) },
    },
    classList: {
      classes: new Set(),
      add(cls) { this.classes.add(cls) },
      remove(cls) { this.classes.delete(cls) },
      contains(cls) { return this.classes.has(cls) },
    },
  }

  const root = {
    document: { documentElement: fakeDocElement },
  }
  const context = vm.createContext({ window: root, globalThis: root, document: root.document })
  vm.runInContext(themeSource, context)

  const engine = root.odkTheme
  assert.ok(engine)

  const pixelTheme = {
    id: 'odk.theme.pixel-art',
    name: 'Pixel Art',
    manifest: { schemaVersion: 1 },
    kind: 'theme',
    tokens: {
      '--radius': '0px',
      '--odk-radius-card': '0px',
      '--odk-accent-green': '#38d948',
      '--odk-accent-red': '#f5a623',
    },
    className: 'theme-pixel-art',
  }

  engine.registerTheme(pixelTheme)
  assert.equal(engine.hasTheme('odk.theme.pixel-art'), true)

  // Apply theme
  engine.applyTheme('odk.theme.pixel-art')
  assert.equal(engine.currentTheme(), 'odk.theme.pixel-art')
  assert.equal(styles.get('--radius'), '0px')
  assert.equal(styles.get('--odk-radius-card'), '0px')
  assert.equal(styles.get('--odk-accent-green'), '#38d948')
  assert.equal(fakeDocElement.classList.contains('theme-pixel-art'), true)

  // Revert to default
  engine.applyTheme('odk.theme.default')
  assert.equal(engine.currentTheme(), 'odk.theme.default')
  assert.equal(fakeDocElement.classList.contains('theme-pixel-art'), false)
})
