import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compute, REF } = require('../src/renderer/layout.js')

const SIZES = [
  ['target HDMI display', 1920, 1280],
  ['user window', 636, 1087],
  ['small dev', 480, 854],
  ['reference canvas', 320, 480],
  ['wide', 1024, 1366],
  ['narrow tall', 400, 700],
  ['extreme tiny', 240, 320],
]

// Golden values pinning the target-panel geometry against accidental drift.
const GOLDEN = { '1920x1280': { cellW: 611, cellH: 138, cellDim: 138, gutter: 43, statusH: 85 } }

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
  const rows = 5
  const colW = (width - (cols - 1) * m.gutter) / cols
  const cellHByHeight = Math.floor(
    (height - m.statusH - m.peekH - 4 * m.gutter - (rows - 1) * m.gutter) / rows,
  )
  check(`${tag}: row height respects column squareness`, m.cellH <= Math.floor(colW), `cellH=${m.cellH} colW=${colW}`)
  check(`${tag}: row height respects height bound`, m.cellH <= cellHByHeight, `cellH=${m.cellH} bound=${cellHByHeight}`)
  check(`${tag}: row height above floor`, m.cellH >= 24, `cellH=${m.cellH}`)

  check(`${tag}: grid flush to both edges`, m.gridW === width, `gridW=${m.gridW}`)

  // Canonical vertical budget mirrored by the stylesheet: status bar, page
  // padding top/bottom, grid, breathing gap above peek, peek, bottom inset.
  const budget =
    m.statusH + m.gutter + m.gridH + m.gutter + m.gutter + m.peekH + m.gutter
  check(`${tag}: vertical budget fits`, budget <= height, `budget=${budget} > ${height}`)

  check(`${tag}: status bar floored`, m.statusH >= 40)
  // The peek may yield below PEEK_MIN on extreme ratios, but never below
  // its scaled reference height — and the yield floor never exceeds PEEK_MIN.
  const peekFloor = Math.min(96, Math.floor(REF.stripMin * m.fit))
  check(`${tag}: peek clamped`, m.peekH >= peekFloor && m.peekH <= 160, `peekH=${m.peekH}`)

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
