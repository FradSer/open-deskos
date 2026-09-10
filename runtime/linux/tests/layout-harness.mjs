import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compute, gridWidgetCount } = require('../src/renderer/layout.js')
require('../src/renderer/config/desktop_layout.js')
const DESKTOP_LAYOUT = globalThis.DESKTOP_LAYOUT

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
  const m = compute(width, height, gridWidgetCount(DESKTOP_LAYOUT))
  const tag = `${label} ${width}x${height}`

  check(`${tag}: cell is strictly square`, m.cellW === m.cellH && m.cellH === m.cellDim, `cellW=${m.cellW} cellH=${m.cellH} cellDim=${m.cellDim}`)
  check(`${tag}: row height above floor`, m.cellH >= 24, `cellH=${m.cellH}`)
  check(`${tag}: grid width within screen`, m.gridW <= width, `gridW=${m.gridW} > ${width}`)

  // Desktop fits the fixed panel; compact grids retain readable cells and scroll.
  const budget = m.statusH + 3 * m.gutter + m.gridH
  if (width >= 1000 && width > height) {
    check(`${tag}: vertical budget fits`, budget <= height, `budget=${budget} > ${height}`)
  } else {
    check(`${tag}: compact cells remain readable`, m.cellDim >= 200, `cellDim=${m.cellDim}`)
    check(`${tag}: compact grid keeps side margins`, m.gridW <= width - 2 * m.gutter)
    check(`${tag}: compact rows fit declared widgets`, m.rows === Math.ceil(gridWidgetCount(DESKTOP_LAYOUT) / m.cols))
  }

  check(`${tag}: status bar floored`, m.statusH >= 36)

  const golden = GOLDEN[`${width}x${height}`]
  if (golden) {
    for (const [key, expected] of Object.entries(golden)) {
      check(`${tag}: golden ${key}`, m[key] === expected, `${key}=${m[key]} expected ${expected}`)
    }
  }
}

// Placement contract: widgets fill grid pages starting from the top-left
// corner. A grid page hosting exactly one tile anchors it to the top-left
// (first column line, first row line); the dedicated reading page hosts the
// 3x2 WeRead tile (columns 1-3, rows 1-2) beside the 2x2 pre-order countdown
// (columns 4-5, rows 1-2 of the widescreen grid).
for (const page of DESKTOP_LAYOUT.pages.filter((p) => p.kind === 'grid' && p.widgets.length === 1)) {
  const [tile] = page.widgets
  const colStart = tile.col?.split('/')[0]?.trim()
  const rowStart = tile.row?.split('/')[0]?.trim()
  check(`page "${page.id}": single tile anchors top-left`, colStart === '1' && rowStart === '1', `col=${tile.col} row=${tile.row}`)
}
const readingPage = DESKTOP_LAYOUT.pages.find((p) => p.id === 'reading')
check('reading page exists as a display grid', Boolean(readingPage) && readingPage.kind === 'grid' && readingPage.surface === 'display')
check('reading page hosts WeRead and pre-order tiles', readingPage?.widgets?.length === 2 && readingPage.widgets[0]?.id === 'odk.tile.weread' && readingPage.widgets[1]?.id === 'odk.tile.preorder', JSON.stringify(readingPage?.widgets))
check('weread tile spans 3x2 top-left', readingPage?.widgets?.[0]?.col === '1 / 4' && readingPage?.widgets?.[0]?.row === '1 / 3', `col=${readingPage?.widgets?.[0]?.col} row=${readingPage?.widgets?.[0]?.row}`)
check('preorder tile spans 2x2 beside weread', readingPage?.widgets?.[1]?.col === '4 / 6' && readingPage?.widgets?.[1]?.row === '1 / 3', `col=${readingPage?.widgets?.[1]?.col} row=${readingPage?.widgets?.[1]?.row}`)

// Grid pages pin their tiles to the top edge instead of floating
// vertically centered in the page. This holds for every grid page — not only
// single-tile ones: the base .widget-grid rule carries margin: 0 auto, and
// the :has(> .widget:only-child) rule restates the same top anchor.
const shellCss = require('node:fs').readFileSync(require('node:path').join(new URL('.', import.meta.url).pathname, '../src/renderer/shell.css'), 'utf8')
check('every grid pins to top', /\.widget-grid\s*\{[^}]*margin:\s*0 auto/.test(shellCss))
check('single-tile grid pins to top', shellCss.includes('.widget-grid:has(> .widget:only-child)') && shellCss.includes('margin: 0 auto'))

// The pre-order countdown reads from the instrument surface below a hairline
// stroke. Depth stays tonal and stroked: the photo gets no scrim and no shadow.
const preorderCss = (shellCss.match(/\.w-preorder[^]*?(?=\.pi-widget-title)/) || [''])[0]
check('preorder block is styled', preorderCss.includes('.preorder-panel'), 'no .w-preorder rules found')
check('preorder photo carries no scrim', !preorderCss.includes('linear-gradient'), 'scrim gradient reintroduced')
check('preorder type carries no drop shadow', !preorderCss.includes('text-shadow'), 'text-shadow reintroduced')
check('preorder panel separates with a stroke', /\.preorder-panel\s*\{[^}]*border-top:\s*1px solid var\(--odk-stroke\)/.test(preorderCss))

// Zpix is a bitmap face: a flat 12px never reads as pixel art. Pixel-theme type
// sizing scales with the tile and keeps 12px only as its floor.
const pixelCss = require('node:fs').readFileSync(require('node:path').join(new URL('.', import.meta.url).pathname, '../src/renderer/themes/pixel.css'), 'utf8')
const preorderLabelPixel = pixelCss.match(/\[data-theme='pixel'\] \.w-preorder \.preorder-label\s*\{([^}]*)\}/)
check('preorder caption scales in the pixel theme', Boolean(preorderLabelPixel) && /font-size:\s*max\(12px,\s*\d+(\.\d+)?cqi\)/.test(preorderLabelPixel[1]), preorderLabelPixel ? preorderLabelPixel[1].trim() : 'no pixel override for .preorder-label')

if (failures > 0) {
  console.error(`layout harness: ${failures} failure(s)`)
  process.exit(1)
}
console.log(`LAYOUT HARNESS PASS (${SIZES.length} sizes)`)
