#!/usr/bin/env node
// The Android composition check.
//
// It points the phone at a desk that cannot answer, and asserts what the Shell
// then says: composition completes, the Agent names the real condition, and the
// host invents nothing. That is the honest unavailable path, which the parity
// gate cannot cover because every parity state comes from a live desk.
//
// The provisioned configuration is read out through adb and written back the same
// way, so the check cannot leave a device pointed at a dead desk.
//
// Usage: node tests/personal-agent-device-composition.mjs [--device=<adb serial>]
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

import { connectShell, launchShell } from '../scripts/lib/android-webview-cdp.mjs'

const run = promisify(execFile)
const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const device = args.get('device') ?? '10.10.0.195:5555'
const CONFIG = 'files/odk-link.json'
const UPLOAD = '/data/local/tmp/odk-link.composition-restore.json'
const DEAD_DESK = JSON.stringify({ host: '127.0.0.1', port: 9, reportToken: 'composition-check' })

const adb = async (...list) => (await run('adb', ['-s', device, ...list], { maxBuffer: 32 * 1024 * 1024 })).stdout

/** Run inside the app's own private storage. A failure here is reported, never swallowed. */
async function runAs(command) {
  try {
    return await adb('shell', `run-as com.odk.shell sh -c "${command}"`)
  } catch (error) {
    throw new Error('run-as failed for "' + command + '": ' + (error.stderr || error.message).toString().trim())
  }
}

async function writeConfig(text) {
  const local = `/tmp/odk-composition-config-${process.pid}.json`
  writeFileSync(local, text)
  await adb('push', local, UPLOAD)
  await runAs(`cat ${UPLOAD} > ${CONFIG}`)
}

async function waitForDevtools(deadline) {
  while (Date.now() < deadline) {
    if ((await adb('shell', 'cat', '/proc/net/unix')).includes('webview_devtools_remote_')) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('the WebView devtools socket never appeared')
}

const findings = []
const previous = await adb('exec-out', 'run-as', 'com.odk.shell', 'cat', CONFIG).catch(() => '')

try {
  await writeConfig(DEAD_DESK)
  await adb('forward', '--remove-all')
  await launchShell(device)
  await waitForDevtools(Date.now() + 20000)
  const shell = await connectShell(device)
  try {
    await new Promise((resolve) => setTimeout(resolve, 12000))
    const reading = JSON.parse(await shell.evaluate(`JSON.stringify({
      composed: {
        statusBar: !!document.getElementById('status-bar'),
        desk: !!document.getElementById('home-desk'),
        agentPanel: !!document.querySelector('#personal-agent .agent-panel'),
        composer: !!document.querySelector('.agent-composer'),
        conversation: !!document.querySelector('.agent-conversation'),
      },
      caption: document.querySelector('.agent-state') ? document.querySelector('.agent-state').textContent : '',
      empty: document.querySelector('.agent-empty') ? document.querySelector('.agent-empty').textContent : '',
      messages: document.querySelectorAll('.agent-message').length,
      notifications: document.querySelectorAll('.agent-notification').length,
    })`))

    for (const [name, present] of Object.entries(reading.composed)) {
      if (!present) findings.push('composition is missing ' + name)
    }
    if (reading.caption !== 'Personal Bot unavailable') findings.push('the Agent states "' + reading.caption + '" instead of the unavailable condition')
    if (reading.messages !== 0) findings.push('the host showed ' + reading.messages + ' message(s) that no desk produced')
    if (reading.notifications !== 0) findings.push('the host showed ' + reading.notifications + ' notification(s) that no desk produced')
    if (!reading.empty) findings.push('the conversation does not state its empty condition')
  } finally {
    shell.close()
  }
} finally {
  // Restore what the device had, whatever happened above.
  if (previous.trim().length > 0) await writeConfig(previous)
  else await runAs(`rm -f ${CONFIG}`)
  // The uploaded copy belongs to the adb user, so it is removed as that user.
  await adb('shell', `rm -f ${UPLOAD}`)
  await launchShell(device)
}

for (const finding of findings) console.log('FAIL ' + finding)
console.log('DEVICE_COMPOSITION findings=' + findings.length + ' restored=' + (previous.trim().length > 0))
process.exit(findings.length === 0 ? 0 : 1)