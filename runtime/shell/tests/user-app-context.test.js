'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const FEATURE = fs.readFileSync(path.join(__dirname, 'features', 'user-app-context.feature'), 'utf8')
const runtimeRoot = path.join(__dirname, '..')
const {
  THEMES,
  DEFAULT_THEME,
  FONTS,
  normalizeTheme,
  buildContextStyle,
  contextTokens,
  resolveFont,
  fontResponse,
  tileRadius,
} = require('../src/user-app-context')

test('BDD feature states the appearance contract for packages', () => {
  assert.match(FEATURE, /Feature: Package appearance context/)
  assert.match(FEATURE, /reads the appearance from a data-theme attribute/)
  assert.match(FEATURE, /every theme's tokens are present, so a switch needs no reload/)
  assert.match(FEATURE, /still has no network, no Shell DOM, and no preload API/)
})

test('the package scheme is fetchable and CORS-checked so fonts can load', () => {
  const { USER_APP_SCHEME_PRIVILEGES } = require('../src/user-app-system')
  assert.equal(USER_APP_SCHEME_PRIVILEGES.standard, true)
  assert.equal(USER_APP_SCHEME_PRIVILEGES.secure, true)
  assert.equal(USER_APP_SCHEME_PRIVILEGES.supportFetchAPI, true)
  assert.equal(USER_APP_SCHEME_PRIVILEGES.corsEnabled, true)
})

test('an unknown or missing theme falls back to the base appearance', () => {
  assert.deepEqual(THEMES, ['instrument', 'pixel', 'border-beam'])
  assert.equal(normalizeTheme('pixel'), 'pixel')
  assert.equal(normalizeTheme('midnight'), DEFAULT_THEME)
  assert.equal(normalizeTheme(undefined), DEFAULT_THEME)
  assert.equal(normalizeTheme(null), DEFAULT_THEME)
})

test('the context offers every appearance, so a switch needs no new document', () => {
  const style = buildContextStyle()
  for (const theme of THEMES) assert.match(style, new RegExp(`\\[data-theme='${theme}'\\]\\{`))
  assert.match(style, /:root\{/)
  assert.match(style, /--odk-primary:#ffffff/)
  assert.match(style, /font-family:var\(--odk-font\)/)
})

test('the pixel appearance matches themes/pixel.css', () => {
  const tokens = contextTokens('pixel')
  assert.equal(tokens['--odk-radius-card'], '0px')
  assert.equal(tokens['--odk-radius-pill'], '0px')
  assert.equal(tokens['--odk-font'], '"Zpix", monospace')
  assert.equal(tokens['--odk-page-marker-active'], 'var(--odk-accent-green)')
  assert.equal(tokens['--odk-primary'], '#ffffff')
  assert.match(buildContextStyle(), /\[data-theme='pixel'\]\{[^}]*image-rendering:pixelated/)
})

test('instrument and border beam share the default tokens', () => {
  const instrument = contextTokens('instrument')
  const borderBeam = contextTokens('border-beam')
  assert.equal(instrument['--odk-radius-card'], '36px')
  assert.equal(borderBeam['--odk-radius-card'], '36px')
  assert.equal(borderBeam['--odk-font'], instrument['--odk-font'])
  assert.deepEqual(borderBeam, instrument)
})

test('the measured tile radius is passed on, and a bad value is ignored', () => {
  assert.equal(tileRadius('23.04px'), '23.04px')
  assert.equal(tileRadius('  14.4px '), '14.4px')
  assert.equal(tileRadius('0px'), '0px')
  assert.equal(tileRadius('12'), '12px', 'a bare number still becomes a px value')
  for (const rejected of ['px', 'calc(1px)', '999px', '-4px', '', '   ', null, undefined, 'url(javascript:1)']) {
    assert.equal(tileRadius(rejected), null, `${rejected} must not become a radius token`)
  }
  assert.match(buildContextStyle({ radius: '23.04px' }), /:root\{--odk-radius-tile:23\.04px\}/)
  assert.match(buildContextStyle({}), /:root\{--odk-radius-tile:var\(--odk-radius-card\)\}/)
})

test('the appearance faces are resolved inside the release and nowhere else', () => {
  const zpix = resolveFont('zpix', { runtimeRoot })
  assert.equal(zpix.file, path.join(runtimeRoot, 'src', 'renderer', 'fonts', 'zpix.woff2'))
  assert.equal(zpix.contentType, 'font/woff2')
  for (const font of Object.values(FONTS)) {
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'src', font.file)), true, `${font.file} must ship with the runtime`)
  }
  for (const rejected of ['../../etc/passwd', 'zpix/../zpix', 'nope', '', null]) {
    assert.equal(resolveFont(rejected, { runtimeRoot }), null, `${rejected} must not resolve to a file`)
  }
})

test('a package can fetch exactly the faces the context declares', async () => {
  const served = await fontResponse('zpix', { runtimeRoot })
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('Content-Type'), 'font/woff2')
  assert.equal(served.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(served.headers.get('Access-Control-Allow-Origin'), '*', 'a sandboxed frame requests fonts cross-origin')
  assert.equal(served.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin')
  assert.ok((await served.arrayBuffer()).byteLength > 1000)
  assert.equal((await fontResponse('../../etc/passwd', { runtimeRoot })).status, 404)
  assert.equal((await fontResponse('missing', { runtimeRoot })).status, 404)
  assert.equal((await fontResponse('zpix', { runtimeRoot: '/nonexistent-release' })).status, 404)
})

test('every declared face is referenced by at least one appearance', () => {
  const style = buildContextStyle()
  for (const id of Object.keys(FONTS)) {
    assert.match(style, new RegExp(`odk-user-app://app/font/${id}`), `${id} must be declared in the context`)
  }
  assert.match(style, /font-family:"Zpix"/)
  assert.match(style, /font-family:"Montserrat";font-style:normal;font-weight:700/)
  assert.match(style, /font-family:"Noto Sans SC";font-style:normal;font-weight:400/)
})