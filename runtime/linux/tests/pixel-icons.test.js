const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer')

function loadPixelPaths() {
  const source = fs.readFileSync(path.join(RENDERER_DIR, 'icons', 'pixelarticons.js'), 'utf8')
  const root = {}
  vm.runInNewContext(source, { window: root })
  return root.PIXELARTICON_PATHS
}

function usedTablerIconNames() {
  const names = new Set()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|html|css)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        for (const match of text.matchAll(/data-tabler="([a-z0-9-]+)"/g)) names.add(match[1])
      }
    }
  }
  walk(RENDERER_DIR)
  return [...names].sort()
}

test('every renderer icon name has a pixelarticons replacement for the Pixel theme', () => {
  const paths = loadPixelPaths()
  const used = usedTablerIconNames()
  assert.ok(used.length >= 10, `expected the shell to use icons, found ${used.join(', ')}`)
  const missing = used.filter((name) => !paths[name])
  assert.deepEqual(missing, [], 'icon names used by the renderer but missing pixel replacements')
})

test('pixel replacements are non-empty pure path fill icons', () => {
  const paths = loadPixelPaths()
  for (const [name, body] of Object.entries(paths)) {
    assert.ok(body.trim().length > 0, `pixel replacement for ${name} is empty`)
    assert.match(body, /<path d="/, `pixel replacement for ${name} must use path elements`)
    assert.doesNotMatch(body, /<script|on[a-z]+=/, `pixel replacement for ${name} must not carry scripts or handlers`)
  }
})
