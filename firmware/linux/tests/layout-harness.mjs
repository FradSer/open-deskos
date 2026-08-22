import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compute } = require('../src/renderer/layout.js')

const SIZES = [
  ['target panel', 568, 1232],
  ['user window', 636, 1087],
  ['small dev', 480, 854],
  ['reference canvas', 320, 480],
  ['wide', 1024, 1366],
  ['narrow tall', 400, 700],
  ['extreme tiny', 240, 320],
]

// Golden values pinning the target-panel geometry against accidental drift.
const GOLDEN = { '568x1232': { cellW: 170, gutter: 28, statusH: 57 } }

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

  const cols = 3
  const rows = 4
  const cellByWidth = Math.floor((width - (cols - 1) * m.gutter) / cols)
  const cellByHeight = Math.floor(
    (height - m.statusH - m.peekH - 4 * m.gutter - (rows - 1) * m.gutter) / rows,
  )
  check(`${tag}: cell respects width bound`, m.cellW <= cellByWidth, `cell=${m.cellW} bound=${cellByWidth}`)
  check(`${tag}: cell respects height bound`, m.cellW <= cellByHeight, `cell=${m.cellW} bound=${cellByHeight}`)
  check(`${tag}: cell above floor`, m.cellW >= 24, `cell=${m.cellW}`)

  check(`${tag}: grid fits width`, m.gridW <= width, `gridW=${m.gridW}`)

  // Canonical vertical budget mirrored by the stylesheet: status bar, page
  // padding top/bottom, grid, breathing gap above peek, peek, bottom inset.
  const budget =
    m.statusH + m.gutter + m.gridH + m.gutter + m.gutter + m.peekH + m.gutter
  check(`${tag}: vertical budget fits`, budget <= height, `budget=${budget} > ${height}`)

  check(`${tag}: status bar floored`, m.statusH >= 40)
  check(`${tag}: peek clamped`, m.peekH >= 96 && m.peekH <= 160, `peekH=${m.peekH}`)

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
