import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compute, REF } = require('../src/renderer/layout.js')

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
  '1920x1280': { cellW: 270, cellH: 270, cellDim: 270, gutter: 28, statusH: 76, cols: 5, rows: 3 },
  '1920x1080': { cellW: 236, cellH: 236, cellDim: 236, gutter: 28, statusH: 76, cols: 5, rows: 3 },
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
  // padding top/bottom, grid, breathing gap above peek, peek, bottom inset.
  const budget =
    m.statusH + m.gutter + m.gridH + m.gutter + m.gutter + m.peekH + m.gutter
  check(`${tag}: vertical budget fits`, budget <= height, `budget=${budget} > ${height}`)

  check(`${tag}: status bar floored`, m.statusH >= 36)
  // The peek may yield below PEEK_MIN on extreme ratios, but never below
  // its scaled reference height — and the yield floor never exceeds PEEK_MIN.
  const peekFloor = Math.min(96, Math.floor(REF.stripMin * m.fit))
  check(`${tag}: peek clamped`, m.peekH >= peekFloor && m.peekH <= 160, `peekH=${m.peekH}`)

  // Peek vertical budget harness: peek primary + peek secondary line heights + gap
  // must comfortably fit within peekH across all sizes to prevent text container overflow
  const peekPrimarySize = Math.max(16, Math.min(24, Math.floor(m.cellDim * 0.11)))
  const peekSecondarySize = Math.max(12, Math.min(16, Math.floor(m.cellDim * 0.08)))
  const peekGap = Math.max(4, Math.min(8, Math.floor(m.gutter * 0.2)))
  const peekContentBudget = Math.ceil(peekPrimarySize * 1.3) + Math.ceil(peekSecondarySize * 1.3) + peekGap
  check(`${tag}: peek content fits inside peek container`, peekContentBudget <= m.peekH, `peekContent=${peekContentBudget} > peekH=${m.peekH}`)

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
