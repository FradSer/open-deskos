#!/usr/bin/env node
// Renders one Personal Agent state on the connected Android host and prints the
// same JSON the Electron harness prints, so one comparison covers both hosts.
//
// Usage: node tests/personal-agent-parity-device.mjs --state=<fixture key>
//        [--viewport=redroid|sony] [--device=<adb serial>] [--out=<png>]
//        [--selected=<selection file>]
//
// The state reaches the phone the way it reaches it in use: the desk's
// development frame source publishes it, and the phone only receives it. This
// host holds no fixture of its own.
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { connectShell, launchShell } from '../scripts/lib/android-webview-cdp.mjs'
import { VIEWPORTS, parityScript, parityPrepareScript } from './helpers/personal-agent-parity.js'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
// The desk's own projection, so the wait compares like with like instead of
// restating the field list this file would have to keep in step.
const { projectPersonalAgentFrame } = require('../src/personal-agent-frame.js')

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))

const stateName = args.get('state') ?? 'idle-empty'
const viewportName = args.get('viewport') ?? 'redroid'
const viewport = VIEWPORTS[viewportName]
const device = args.get('device') ?? '10.10.0.195:5555'
const out = args.get('out') ?? ''
const selectedFile = args.get('selected') ?? '/tmp/odk-dev/selected'
const nativeViewport = args.get('native-viewport') === 'true'
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'personal-agent-v1.json'), 'utf8'))
const status = fixture.states[stateName]
if (!status) throw new Error('unknown fixture state ' + stateName)
if (!viewport) throw new Error('unknown viewport ' + viewportName)

const adb = async (...list) => (await run('adb', ['-s', device, ...list], { maxBuffer: 32 * 1024 * 1024 })).stdout

function sameJson(one, other) {
  if (one === other) return true
  if (Array.isArray(one) && Array.isArray(other)) return one.length === other.length && one.every((value, index) => sameJson(value, other[index]))
  if (one && other && typeof one === 'object' && typeof other === 'object') {
    const keys = Object.keys(one)
    return keys.length === Object.keys(other).length && keys.every((key) => sameJson(one[key], other[key]))
  }
  return false
}

async function waitForDevtools(deadline) {
  while (Date.now() < deadline) {
    if ((await adb('shell', 'cat', '/proc/net/unix')).includes('webview_devtools_remote_')) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('the WebView devtools socket never appeared')
}

const expected = projectPersonalAgentFrame(status)

// The desk publishes the selected state; the phone restarts so the frame it shows
// is the first one it received, exactly as a fresh launch sees it.
writeFileSync(selectedFile, stateName + '\n')
await new Promise((resolve) => setTimeout(resolve, 900))

await adb('forward', '--remove-all')
await launchShell(device)
await waitForDevtools(Date.now() + 20000)

const shell = await connectShell(device)
try {
  // Both hosts are measured at the same layout viewport, as the Electron harness
  // does. A device that rounds its density to a neighbouring pixel would
  // otherwise differ in the canvas math rather than in the design.
  await shell.send('Page.enable')
  // A device already at the compared size needs no override: changing the
  // viewport after the Shell booted re-composes the page, which is not what the
  // Electron reference does.
  if (!nativeViewport) {
    await shell.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  // The same scrollbar metric the Electron side pins, so the two readings differ
  // only where the design differs.
  await shell.send('Emulation.setScrollbarsHidden', { hidden: true })
  // Record the engine that produced the reading: an old WebView must not pass as
  // proof of the design.
  const browser = await shell.send('Browser.getVersion')
  const deadline = Date.now() + 20000
  let received = null
  while (Date.now() < deadline) {
    received = JSON.parse(await shell.evaluate('window.ODKAndroid.status("{}")'))
    if (sameJson(received, expected)) break
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!sameJson(received, expected)) {
    throw new Error('the phone never showed state ' + stateName + '; it held ' + JSON.stringify(received).slice(0, 200))
  }
  await shell.evaluate(parityPrepareScript())
  // Compare a settled document: a reading taken while the reply was still
  // rendering reported a scroll position the same state does not hold a moment
  // later, and the compared geometry moved with it.
  let previous = null
  let reading = null
  const settleDeadline = Date.now() + 10000
  while (Date.now() < settleDeadline) {
    reading = JSON.parse(await shell.evaluate(parityScript()))
    if (previous !== null && JSON.stringify(previous) === JSON.stringify(reading)) break
    previous = reading
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (out) await shell.screenshot(out)
  console.log('PERSONAL_AGENT_PARITY ' + JSON.stringify({ host: 'android', state: stateName, viewport: viewportName, webView: browser.product, reading }))
} finally {
  shell.close()
}