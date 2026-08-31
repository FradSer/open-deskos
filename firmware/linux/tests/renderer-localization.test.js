const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const HAN_CHARACTERS = /[\u3400-\u9fff]/u
const RENDERER_ROOT = path.join(__dirname, '..', 'src', 'renderer')

function rendererTextFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return rendererTextFiles(entryPath)
    return /\.(?:css|html|js)$/.test(entry.name) ? [entryPath] : []
  })
}

test('renderer UI source and end-to-end expectations are English-only', () => {
  const files = [
    ...rendererTextFiles(RENDERER_ROOT),
    path.join(__dirname, 'e2e.js'),
  ]
  const localizedFiles = files.filter((file) => HAN_CHARACTERS.test(fs.readFileSync(file, 'utf8')))

  assert.deepEqual(localizedFiles, [])
})
