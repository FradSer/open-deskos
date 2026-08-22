import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseDesignTokens(markdown) {
  const colors = {}
  let inColors = false
  for (const line of markdown.split('\n')) {
    if (/^colors:/.test(line)) { inColors = true; continue }
    if (inColors && /^\S/.test(line)) break
    const match = line.match(/^\s{2}([\w-]+):\s*"(#[0-9a-fA-F]{6})"/)
    if (match) colors[match[1]] = match[2].toLowerCase()
  }
  return colors
}

function parseCssVars(css) {
  const vars = {}
  for (const match of css.matchAll(/--odk-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    vars[match[1]] = match[2].toLowerCase()
  }
  return vars
}

const designRoot = path.resolve(root, '../../DESIGN.md')
const design = parseDesignTokens(readFileSync(designRoot, 'utf8'))
const cssVars = parseCssVars(readFileSync(path.join(root, 'src/renderer/shell.css'), 'utf8'))

if (Object.keys(design).length === 0) {
  console.error('FAIL: no color tokens parsed from DESIGN.md')
  process.exit(1)
}

let failures = 0
for (const [name, hex] of Object.entries(design)) {
  const varName = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const actual = cssVars[varName]
  if (actual !== undefined && actual !== hex) {
    console.error(`FAIL: --odk-${varName} is ${actual}, DESIGN.md says ${hex}`)
    failures += 1
  } else if (actual === undefined && !['typography'].includes(name)) {
    console.error(`FAIL: token ${name} (${hex}) has no matching --odk-${varName} in shell.css`)
    failures += 1
  }
}

if (failures > 0) {
  process.exit(1)
}
console.log('TOKENS MATCH DESIGN.MD')
