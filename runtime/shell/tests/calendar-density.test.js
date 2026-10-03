const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('Calendar marks the narrow first-day glyph without changing the date', () => {
  let plugin
  let tick
  const nodes = new Map()
  const el = {
    querySelector(selector) {
      if (!nodes.has(selector)) {
        const classes = new Set()
        nodes.set(selector, { textContent: '', classes, classList: {
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name) },
        } })
      }
      return nodes.get(selector)
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/almanac.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
  })
  plugin.mount(el, { onTick(callback) { tick = callback } })
  tick(new Date(2026, 0, 1, 12))
  assert.equal(nodes.get('.al-day').textContent, 1)
  assert.equal(nodes.get('.al-month').textContent, 'Jan')
  assert.equal(nodes.get('.al-weekday').textContent, 'Thu')
  assert.equal(nodes.get('.al-day').classes.has('al-day-narrow'), true)
  tick(new Date(2026, 0, 2, 12))
  assert.equal(nodes.get('.al-day').classes.has('al-day-narrow'), false)
  tick(new Date(2026, 0, 11, 12))
  assert.equal(nodes.get('.al-day').classes.has('al-day-wide'), true)
  assert.equal(nodes.get('.al-day').classes.has('al-day-narrow'), false)
})
