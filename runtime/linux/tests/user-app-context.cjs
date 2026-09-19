/*
 * Package appearance context, end to end.
 *
 * Boots the real Shell renderer in a hidden window, mounts an installed package in a
 * Home cell, and checks from inside the opaque frame that it received the Shell's
 * appearance: the theme attribute, the token values, the theme's own face, and a live
 * switch. Also guards the injected tokens against the rendered Shell, so the package
 * context cannot drift away from the stylesheets it mirrors.
 *
 * HIDDEN ON PURPOSE: this harness must never activate a window on the desk it measures.
 */
'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildUserAppDocument, USER_APP_CSP } = require('../src/user-app-content')
const { USER_APP_SCHEME_PRIVILEGES } = require('../src/user-app-system')
const { createUserAppResponse } = require('../src/user-app-protocol')
const { buildContextStyle, contextTokens } = require('../src/user-app-context')

protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: USER_APP_SCHEME_PRIVILEGES }])

const REVISION = 'a'.repeat(32)
const widget = { id: 'probe', name: 'Probe', kind: 'widget', revision: REVISION, placement: { pageId: 'home', col: '4', row: '3' } }
const probeHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Probe</title>
<style>body{margin:0;background:var(--odk-bg);color:var(--odk-primary);font-family:var(--odk-font);font-size:var(--odk-text-label)}</style>
</head><body><p id="reading" style="border-radius:var(--odk-radius-card);background:var(--odk-surface)">probe 25°C</p></body></html>`

// Value tokens the Shell and the package context must agree on. The cell-relative
// text roles are excluded on purpose: the Shell expresses them against the grid cell,
// a package against the viewport it is handed.
const SHARED_VALUE_TOKENS = [
  '--odk-bg', '--odk-surface', '--odk-elevated', '--odk-button', '--odk-stroke', '--odk-stroke-focus',
  '--odk-primary', '--odk-secondary', '--odk-secondary-strong',
  '--odk-accent-red', '--odk-accent-green', '--odk-accent-blue',
  '--odk-radius-card', '--odk-radius-pill', '--odk-status-control-h',
  '--odk-space-1', '--odk-space-2', '--odk-space-3', '--odk-space-4',
]

const fixtures = {
  'odk-opencode-go-status': { state: 'unconfigured' },
  'odk-pi-sessions': { summary: { running: 0 }, sessions: [] },
  'odk-pi-session-events': { sessions: [] },
  'odk-hydra-status': { configured: false, connected: false, nodes: [] },
  'odk-weread-highlight': { status: 'unconfigured', highlight: null },
  'odk-futu-holdings': { state: 'unconfigured' },
  'odk-weather-status': { status: 'unconfigured', place: null, current: null, daily: null, updatedAt: null, hint: 'Set ODK_WEATHER_LAT and ODK_WEATHER_LON', error: null },
  'odk-remote-publish-page-state': true,
  'odk-camera-frame': { state: 'unavailable' },
  'odk-voice-status': { phase: 'idle', text: '', active: false },
  'odk-voice-toggle': { ok: false, error: 'harness' },
  'odk-app-manager-list': { ok: true, apps: [] },
  'odk-app-manager-state': { ok: true, apps: [] },
  'odk-app-manager-intent': { ok: false, error: 'harness' },
}

const deadline = setTimeout(() => { console.error('USER_APP_CONTEXT_TIMEOUT'); app.exit(1) }, 60000)

app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries(fixtures)) ipcMain.handle(channel, () => value)
  ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [widget] }))
  ipcMain.handle('odk-user-apps-dispatch', () => ({ ok: false, error: 'harness' }))

  const store = { getContent: async (id) => id === widget.id
    ? { ok: true, app: { id, revision: REVISION }, html: probeHtml }
    : { ok: false } }
  protocol.handle('odk-user-app', (request) => createUserAppResponse(request.url, store, buildUserAppDocument, USER_APP_CSP))

  const win = new BrowserWindow({ width: 1920, height: 1280, frame: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const js = (source) => win.webContents.executeJavaScript(source)
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function wait(expression, label) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await js(expression)) return
      await delay(50)
    }
    throw new Error(`Timed out waiting for ${label || expression}`)
  }

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await wait('Boolean(window.__odkGrid)', 'shell geometry')
  await wait(`document.querySelector('[data-user-app-id="${widget.id}"]')?.dataset.state === 'ready'`, 'installed package ready')

  const frame = win.webContents.mainFrame.frames.find((candidate) => candidate.url.includes(`/${widget.id}/`))
  assert.ok(frame, 'the installed package frame must be mounted')
  assert.match(frame.url, /theme=/, 'the frame URL must carry the appearance')

  function shellTokens() {
    return js(`(() => {
      const style = getComputedStyle(document.documentElement)
      return Object.fromEntries(${JSON.stringify(SHARED_VALUE_TOKENS)}.map((name) => [name, style.getPropertyValue(name).trim()]))
    })()`)
  }

  function frameTokens() {
    return frame.executeJavaScript(`(() => {
      const style = getComputedStyle(document.documentElement)
      return { theme: document.documentElement.dataset.theme,
        tokens: Object.fromEntries(${JSON.stringify(SHARED_VALUE_TOKENS)}.map((name) => [name, style.getPropertyValue(name).trim()])),
        font: style.getPropertyValue('--odk-font').trim(),
        tileRadius: style.getPropertyValue('--odk-radius-tile').trim(),
        readingRadius: getComputedStyle(document.getElementById('reading')).borderRadius,
        readingFont: getComputedStyle(document.body).fontFamily }
    })()`)
  }

  const shellTheme = await js('document.documentElement.dataset.theme')
  const frameStyle = await frameTokens()
  assert.equal(frameStyle.theme, shellTheme, 'the package must receive the Shell theme')
  assert.equal(frameStyle.tileRadius, await js('getComputedStyle(document.querySelector("#pages-track .widget")).borderTopLeftRadius'),
    'the package must receive the tile radius its frame actually renders with')

  for (const [name, value] of Object.entries(await shellTokens())) {
    assert.equal(frameStyle.tokens[name], value, `${name} must match the Shell (${shellTheme})`)
  }

  // The face has to be the one this release serves, not the platform default.
  const faces = await frame.executeJavaScript(`(async () => {
    await document.fonts.ready
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const width = (family) => { context.font = '400 32px ' + family; return context.measureText('25°C').width }
    const declared = getComputedStyle(document.body).fontFamily
    const family = declared.split(',')[0].replace(/["']/g, '')
    await document.fonts.load('400 32px "' + family + '"')
    return { declared, family, loaded: document.fonts.check('400 32px "' + family + '"'), appearance: width('"' + family + '"'), missing: width('"DefinitelyMissingFamilyXYZ"') }
  })()`)
  assert.match(faces.declared, /Zpix|Noto Sans SC|Montserrat/, 'the package must render in an appearance face')
  assert.equal(faces.loaded, true, `${faces.family} must be served to the frame`)
  assert.notEqual(faces.appearance, faces.missing, 'the served appearance face must load in the frame')

  // The context grants no network: a package still cannot reach a provider itself.
  assert.equal(await frame.executeJavaScript('fetch("https://example.invalid/secret").then(() => "reached", () => "blocked")'), 'blocked')

  // A theme switch reaches the live frame without a reload. The starting theme comes
  // from the profile, so the switch target is derived from it rather than assumed.
  const nextTheme = shellTheme === 'pixel' ? 'instrument' : 'pixel'
  await js(`window.odkTheme.set(${JSON.stringify(nextTheme)})`)
  await wait(`document.documentElement.dataset.theme === ${JSON.stringify(nextTheme)}`, 'shell theme switch')
  await wait(`document.querySelector('[data-user-app-id="${widget.id}"] iframe')?.dataset.theme === ${JSON.stringify(nextTheme)}`, 'frame theme notice')
  const switched = await frameTokens()
  assert.equal(switched.theme, nextTheme)
  assert.equal(switched.tileRadius, await js('getComputedStyle(document.querySelector("#pages-track .widget")).borderTopLeftRadius'))
  for (const [name, value] of Object.entries(await shellTokens())) {
    assert.equal(switched.tokens[name], value, `${name} must follow the Shell after a switch`)
  }
  assert.notEqual(switched.font, frameStyle.font, 'each appearance declares its own face')
  assert.equal(await js(`document.querySelector('[data-user-app-id="${widget.id}"] iframe').dataset.revision`), REVISION,
    'a theme switch must not reload or replace the package')

  // The injected stylesheet is the same document the tokens were modelled from.
  const injected = await frame.executeJavaScript('document.getElementById("odk-package-context").textContent.length')
  assert.ok(injected > 500, 'the package document must carry the appearance sheet')
  const modelled = contextTokens('instrument')
  for (const name of SHARED_VALUE_TOKENS) assert.ok(modelled[name], `${name} must be modelled for the instrument appearance`)
  assert.match(buildContextStyle(), /\[data-theme='border-beam'\]/)

  console.log('USER_APP_CONTEXT_PASS')
  clearTimeout(deadline)
  win.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  clearTimeout(deadline)
  app.exit(1)
})