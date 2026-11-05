const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const HAN_CHARACTERS = /[\u3400-\u9fff]/u
const RENDERER_ROOT = path.join(__dirname, '..', 'src', 'renderer')
const APP_CATALOG = path.join(__dirname, '..', 'src', 'app-manager-endpoint.js')

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
    APP_CATALOG,
    path.join(__dirname, 'e2e.js'),
  ]
  const AGENT_PROTOCOL_PHRASES = ["查看报价", "刷新行程"]
  const localizedFiles = files.filter((file) => {
    const source = fs.readFileSync(file, "utf8")
    if (!file.endsWith("core/personal-agent-suggestions.js")) return HAN_CHARACTERS.test(source)
    const remaining = AGENT_PROTOCOL_PHRASES.reduce((text, phrase) => text.split(phrase).join(""), source)
    return HAN_CHARACTERS.test(remaining)
  })

  assert.deepEqual(localizedFiles, [])
})
