import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compute } = require('../src/renderer/layout.js')

const SIZES = [
  ['target HDMI display', 1920, 1280],
  ['1080P HDMI display', 1920, 1080],
  ['user window', 636, 1087],
  ['small dev', 480, 854],
  ['reference canvas', 320, 480],
  ['wide', 1024, 1366],
  ['narrow tall', 400, 700],
  ['extreme tiny', 240, 320],
]

// Golden values pinning the target-panel geometry against accidental drift.
const GOLDEN = {
  '1920x1280': { cellW: 348, cellH: 348, cellDim: 348, gutter: 28, statusH: 96, cols: 5, rows: 3 },
  '1920x1080': { cellW: 286, cellH: 286, cellDim: 286, gutter: 28, statusH: 81, cols: 5, rows: 3 },
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) {
    failures += 1
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

for (const [label, width, height] of SIZES) {
  const m = compute(width, height)
  const tag = `${label} ${width}x${height}`

  check(`${tag}: cell is strictly square`, m.cellW === m.cellH && m.cellH === m.cellDim, `cellW=${m.cellW} cellH=${m.cellH} cellDim=${m.cellDim}`)
  check(`${tag}: row height above floor`, m.cellH >= 24, `cellH=${m.cellH}`)
  check(`${tag}: grid width within screen`, m.gridW <= width, `gridW=${m.gridW} > ${width}`)

  // Canonical vertical budget mirrored by the stylesheet: status bar, page
  // padding, grid, and the bottom breathing gutter.
  const budget = m.statusH + m.gutter + m.gridH + m.gutter + m.gutter
  check(`${tag}: vertical budget fits`, budget <= height, `budget=${budget} > ${height}`)

  check(`${tag}: status bar floored`, m.statusH >= 36)

  const golden = GOLDEN[`${width}x${height}`]
  if (golden) {
    for (const [key, expected] of Object.entries(golden)) {
      check(`${tag}: golden ${key}`, m[key] === expected, `${key}=${m[key]} expected ${expected}`)
    }
  }
}

if (failures > 0) {
  console.error(`layout harness: ${failures} failure(s)`)
  process.exit(1)
}
console.log(`LAYOUT HARNESS PASS (${SIZES.length} sizes)`)
