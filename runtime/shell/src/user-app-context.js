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

const { createAppearanceHost, DEFAULT_THEME, FONTS } = require('./renderer/core/appearance-plugins')
const packagedAppearances = createAppearanceHost()
const THEMES = packagedAppearances.declarations().map(appearance => appearance.theme)
const appearances = plugins => plugins ? createAppearanceHost({ plugins }) : packagedAppearances

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

function normalizeTheme(theme, { appearancePlugins } = {}) {
  return appearances(appearancePlugins).preview(theme).theme
}

function fontFace(fontId) {
  const font = FONTS[fontId]
  if (!font) return ''
  const { family, weight, format } = font
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
function buildContextStyle({ radius, appearancePlugins } = {}) {
  const declarations = appearances(appearancePlugins).declarations()
  const faces = [...new Set(declarations.flatMap(appearance => appearance.faces))].map(fontFace).join('')
  const blocks = declarations.map(appearance => tokenBlock(`[data-theme='${appearance.theme}']`, appearance.tokens, appearance.extra || '')).join('')
  const measured = tileRadius(radius)
  const fallback = tokenBlock(':root', declarations.find(appearance => appearance.theme === DEFAULT_THEME).tokens)
  const tile = measured ? `:root{--odk-radius-tile:${measured}}` : ':root{--odk-radius-tile:var(--odk-radius-card)}'
  return `${faces}${fallback}${blocks}${tile}:root{font-family:var(--odk-font);color:var(--odk-primary);background:var(--odk-bg)}`
}

function contextTokens(theme, { appearancePlugins } = {}) {
  return { ...appearances(appearancePlugins).preview(theme).tokens }
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
