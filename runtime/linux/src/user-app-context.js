'use strict'

/*
 * Package appearance context.
 *
 * A user package is an opaque frame: it cannot read the Shell's theme, inherit its
 * custom properties, or load its fonts over the network. Instead of asking every
 * package author to vendor a palette, a face, and a theme switch, the Shell serves
 * one context document into the package:
 *
 *   <html data-theme="pixel">          the active appearance, kept current by a message
 *   :root { --odk-* }                  the theme's resolved semantic tokens
 *   [data-theme='pixel'] { … }         every appearance's overrides, so a switch is instant
 *   @font-face { … }                   the theme's own faces, served by this process
 *
 * The values here mirror src/renderer/shell.css and src/renderer/themes/pixel.css.
 * tests/user-app-desktop.cjs compares them against the rendered Shell so the two
 * cannot drift apart silently.
 *
 * This grants no new capability: still no network, no Shell DOM, no preload. It only
 * closes the appearance gap between a built-in tile and an installed package.
 */

const path = require('node:path')
const fs = require('node:fs')

const DEFAULT_THEME = 'instrument'
const THEMES = ['instrument', 'pixel', 'border-beam']

// Served to packages as odk-user-app://app/font/<id>, the same origin as the package
// document: a custom scheme enforces CORS across hosts, so a separate font host would
// be blocked. Absolute paths are resolved inside the running release, so a package
// never reaches outside it.
const FONTS = {
  'zpix': { file: 'renderer/fonts/zpix.woff2', contentType: 'font/woff2' },
  'montserrat-bold': { file: 'renderer/fonts/Montserrat-Bold.ttf', contentType: 'font/ttf' },
  'noto-sans-sc': { file: 'renderer/fonts/NotoSansSC-Regular.ttf', contentType: 'font/ttf' },
}

/*
 * The radius a package's own inner shapes should match. A tile's radius is derived
 * from the grid (`calc(var(--radius) * 0.72)` at the desk, other values when the grid
 * collapses), so it is not a cell ratio and cannot be computed from the frame size:
 * the Shell measures its own host element and passes the value along. Without a
 * measured value the context falls back to the card token.
 */
function tileRadius(value) {
  const number = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(number) && number >= 0 && number <= 120 ? `${Number(number.toFixed(2))}px` : null
}

const SHARED_TOKENS = {
  '--odk-bg': '#000000',
  '--odk-surface': '#171717',
  '--odk-elevated': '#1f1f1f',
  '--odk-button': '#383838',
  '--odk-stroke': '#383838',
  '--odk-stroke-focus': '#b5b5b5',
  '--odk-primary': '#ffffff',
  '--odk-secondary': '#706f70',
  '--odk-secondary-strong': '#b5b5b5',
  '--odk-accent-red': '#eb5757',
  '--odk-accent-green': '#34c759',
  '--odk-accent-blue': '#025bc2',
  '--odk-radius-card': '36px',
  '--odk-radius-pill': '999px',
  '--odk-status-control-h': '44px',
  '--odk-space-1': '4px',
  '--odk-space-2': '8px',
  '--odk-space-3': '16px',
  '--odk-space-4': '24px',
  '--odk-ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
}

// The Shell derives its text roles from the grid cell; a package frame *is* a cell,
// so the same ratios are expressed against the viewport the package is given.
const CELL_TOKENS = {
  '--odk-cell': '100cqi',
  '--odk-text-label': 'clamp(12px, calc(var(--odk-cell) * 0.05), 16px)',
  '--odk-text-body': 'clamp(16px, calc(var(--odk-cell) * 0.06), 20px)',
  '--odk-text-heading': 'clamp(24px, calc(var(--odk-cell) * 0.1), 36px)',
  '--odk-widget-inset': 'clamp(16px, calc(var(--odk-cell) * 0.08), 28px)',
}

const THEME_RULES = {
  instrument: {
    tokens: { ...SHARED_TOKENS, ...CELL_TOKENS, '--odk-font': '"Noto Sans SC", "Montserrat", sans-serif' },
    faces: ['noto-sans-sc', 'montserrat-bold'],
  },
  pixel: {
    tokens: {
      ...SHARED_TOKENS,
      ...CELL_TOKENS,
      '--odk-radius-card': '0px',
      '--odk-radius-pill': '0px',
      '--odk-page-marker-active': 'var(--odk-accent-green)',
      '--odk-page-control-stroke': 'var(--odk-stroke)',
      '--odk-font': '"Zpix", monospace',
    },
    faces: ['zpix'],
    extra: 'image-rendering:pixelated;',
  },
  // Border Beam keeps Instrument neutrals and type; only built-in surfaces get the
  // optional perimeter, which a package frame cannot have.
  'border-beam': {
    tokens: { ...SHARED_TOKENS, ...CELL_TOKENS, '--odk-font': '"Noto Sans SC", "Montserrat", sans-serif' },
    faces: ['noto-sans-sc', 'montserrat-bold'],
  },
}

function normalizeTheme(theme) {
  return THEMES.includes(theme) ? theme : DEFAULT_THEME
}

function fontFace(fontId) {
  const font = FONTS[fontId]
  if (!font) return ''
  const family = fontId === 'zpix' ? 'Zpix' : (fontId === 'montserrat-bold' ? 'Montserrat' : 'Noto Sans SC')
  const weight = fontId === 'montserrat-bold' ? 700 : 400
  const format = font.contentType === 'font/woff2' ? 'woff2' : 'truetype'
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;`
    + `src:url("odk-user-app://app/font/${fontId}") format("${format}")}`
}

function tokenBlock(selector, tokens, extra = '') {
  const declarations = Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';')
  return `${selector}{${declarations};${extra}}`
}

/*
 * One stylesheet covering every appearance, so a live theme change is a single
 * attribute write inside the package instead of a reload.
 */
function buildContextStyle({ radius } = {}) {
  const faces = [...new Set(THEMES.flatMap((theme) => THEME_RULES[theme].faces))].map(fontFace).join('')
  const blocks = THEMES.map((theme) => tokenBlock(`[data-theme='${theme}']`, THEME_RULES[theme].tokens, THEME_RULES[theme].extra || '')).join('')
  const measured = tileRadius(radius)
  const fallback = tokenBlock(':root', THEME_RULES[DEFAULT_THEME].tokens)
  const tile = measured ? `:root{--odk-radius-tile:${measured}}` : ':root{--odk-radius-tile:var(--odk-radius-card)}'
  return `${faces}${fallback}${blocks}${tile}:root{font-family:var(--odk-font);color:var(--odk-primary);background:var(--odk-bg)}`
}

function contextTokens(theme) {
  return { ...THEME_RULES[normalizeTheme(theme)].tokens }
}

function resolveFont(fontId, { runtimeRoot = process.env.ODK_RUNTIME_ROOT || path.join(__dirname, '..') } = {}) {
  const font = Object.prototype.hasOwnProperty.call(FONTS, fontId) ? FONTS[fontId] : null
  if (!font) return null
  const file = path.join(runtimeRoot, 'src', font.file)
  return { file, contentType: font.contentType }
}

function fontResponse(fontId, options) {
  const resolved = resolveFont(fontId, options)
  if (!resolved) return new Response('Font unavailable', { status: 404 })
  try {
    const bytes = fs.readFileSync(resolved.file)
    return new Response(bytes, {
      headers: {
        'Content-Type': resolved.contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // A package frame is sandboxed without same-origin authority, so its origin is
        // opaque and every font request is cross-origin. These are public product
        // faces served from this process, so an open read is the whole policy.
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  } catch {
    return new Response('Font unavailable', { status: 404 })
  }
}

module.exports = {
  DEFAULT_THEME,
  THEMES,
  FONTS,
  tileRadius,
  normalizeTheme,
  buildContextStyle,
  contextTokens,
  fontResponse,
  resolveFont,
}