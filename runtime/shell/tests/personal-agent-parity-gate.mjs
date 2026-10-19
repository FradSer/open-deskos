#!/usr/bin/env node
// The Android parity gate.
//
// One renderer, one fixture, two hosts: each state is rendered by Electron and by
// the connected Android host, and the readings are compared field by field. The
// state reaches the phone only over the link, so this also proves the phone shows
// what the desk produced rather than a fixture of its own.
//
// Usage: node tests/personal-agent-parity-gate.mjs [--viewport=redroid|sony]
//        [--device=<adb serial>] [--report=<json>]
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { connectShell, launchShell } from '../scripts/lib/android-webview-cdp.mjs'
import { STATES, VIEWPORTS, compareParity } from './helpers/personal-agent-parity.js'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const shellRoot = path.resolve(here, '..')

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))

const viewportName = args.get('viewport') ?? 'redroid'
if (!VIEWPORTS[viewportName]) throw new Error('unknown viewport ' + viewportName)
const device = args.get('device') ?? '10.10.0.195:5555'
// A viewport the device does not have must be set on the display, so the Shell
// boots into it exactly as it boots on a phone of that size.
const NATIVE_VIEWPORTS = { redroid: { size: '720x1280', density: 240 }, sony: { size: '540x960', density: 240 } }
const reportDir = args.get('report') ?? '/tmp/odk-parity'
mkdirSync(reportDir, { recursive: true })
const readingsFile = path.join(reportDir, 'readings.jsonl')
writeFileSync(readingsFile, '')

async function reading(host, state, extra = []) {
  const out = path.join(reportDir, host + '-' + state + '.png')
  const list = host === 'electron'
    ? [path.join(shellRoot, 'node_modules/.bin/electron'), [path.join(shellRoot, 'tests/personal-agent-parity.cjs'), '--state=' + state, '--viewport=' + viewportName, '--out=' + out]]
    : [process.execPath, [path.join(shellRoot, 'tests/personal-agent-parity-device.mjs'), '--state=' + state, '--viewport=' + viewportName, '--device=' + device, '--out=' + out, ...extra]]
  const { stdout } = await run(list[0], list[1], { maxBuffer: 32 * 1024 * 1024, timeout: 120000 })
  const line = stdout.split('\n').find((value) => value.startsWith('PERSONAL_AGENT_PARITY'))
  if (!line) throw new Error(host + ' produced no reading for ' + state)
  const parsed = JSON.parse(line.slice('PERSONAL_AGENT_PARITY'.length))
  appendFileSync(readingsFile, JSON.stringify(parsed) + '\n')
  return parsed
}

// Chrome 111 is the oldest engine the shared renderer is written for; the Sony
// device's WebView 67 must never pass this gate.
const MINIMUM_WEBVIEW_MAJOR = 111
const engines = new Set()
let failed = 0
const failures = []
const native = NATIVE_VIEWPORTS[viewportName]
const sh = async (...list) => (await run('adb', ['-s', device, ...list], { maxBuffer: 8 * 1024 * 1024 })).stdout
await sh('shell', 'wm', 'size', native.size)
await sh('shell', 'wm', 'density', String(native.density))
const measured = await sh('shell', 'wm', 'size')
console.log('PARITY device display ' + measured.trim().replace(/\s+/g, ' '))

// Device state is pinned like the viewport: a saved Agent identity would change
// the copy the two hosts are compared on, so the run starts from the default.
await sh('forward', '--remove-all')
await launchShell(device)
const devtoolsDeadline = Date.now() + 20000
while (Date.now() < devtoolsDeadline && !(await sh('shell', 'cat', '/proc/net/unix')).includes('webview_devtools_remote_')) {
  await new Promise((resolve) => setTimeout(resolve, 300))
}
const reset = await connectShell(device)
try {
  await reset.evaluate("localStorage.removeItem('odk.agent.identity'); 'cleared'")
} finally {
  reset.close()
}
for (const state of STATES) {
  let report
  try {
    const electronReading = await reading('electron', state)
    const androidReading = await reading('android', state, ['--native-viewport=true'])
    engines.add(electronReading.webView)
    engines.add(androidReading.webView)
    const differences = compareParity(electronReading.reading, androidReading.reading)
    // An old engine must not pass as proof of the design.
    const androidChrome = Number.parseInt((String(androidReading.webView).match(/Chrome\/(\d+)/) ?? [])[1] ?? '0', 10)
    if (!(androidChrome >= MINIMUM_WEBVIEW_MAJOR)) {
      differences.push({ label: 'webView.major', electron: MINIMUM_WEBVIEW_MAJOR, android: androidReading.webView })
    }
    const verdict = differences.length === 0 ? 'PASS' : 'FAIL'
    if (differences.length > 0) {
      failed += 1
      failures.push({ state, differences })
    }
    report = { state, verdict, differences: differences.length }
    console.log('PARITY ' + verdict + ' ' + state + ' differences=' + differences.length)
    for (const difference of differences.slice(0, 8)) {
      console.log('    ' + difference.label + ': electron=' + JSON.stringify(difference.electron) + ' android=' + JSON.stringify(difference.android))
    }
  } catch (error) {
    failed += 1
    failures.push({ state, error: error.message })
    console.log('PARITY ERROR ' + state + ' ' + error.message)
  }
}

const summary = {
  viewport: viewportName,
  device,
  engines: [...engines],
  states: STATES.length,
  failed,
  readings: readingsFile,
  screenshots: reportDir,
  failures,
}
writeFileSync(path.join(reportDir, 'gate.json'), JSON.stringify(summary, null, 2))
await sh('shell', 'wm', 'size', 'reset')
await sh('shell', 'wm', 'density', 'reset')
console.log('PARITY_SUMMARY ' + JSON.stringify({ viewport: viewportName, states: STATES.length, failed, report: path.join(reportDir, 'gate.json') }))
process.exit(failed === 0 ? 0 : 1)