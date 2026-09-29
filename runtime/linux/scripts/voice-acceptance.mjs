// Operator acceptance for the resident Voice Agent on whichever Shell Host runs
// it. It speaks the published voice protocol over the host's own endpoint (a
// socket in the runtime directory, or the voice-agent named pipe on Windows),
// presents the channel token where the endpoint needs one, asks for one Spoken
// Turn, and reports what the service actually said — states in order, the
// transcript, and the final answer. It prints no credential.
//
//   node scripts/voice-acceptance.mjs              # toggle, then wait
//   node scripts/voice-acceptance.mjs --status     # read the current state only
//   node scripts/voice-acceptance.mjs --seconds 90 # allow a slower Pi run
//
// Service activity alone is not acceptance: this still needs a real microphone, a
// spoken request, and an authorized workspace, and the answer is only evidence
// when the transcript is the speech that was made.

import net from 'node:net'
import process from 'node:process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveShellHost } = require('../src/platform')
const { readOrCreateToken, requiresToken, writeHandshake } = require('../src/local-channel')

const args = process.argv.slice(2)
const statusOnly = args.includes('--status')
const secondsIndex = args.indexOf('--seconds')
const deadline = Number(secondsIndex >= 0 ? args[secondsIndex + 1] : 120) * 1000
const host = resolveShellHost()
const endpoint = host.endpoint('voice-agent')
if (!endpoint) {
  console.log('voice: this host resolves no voice endpoint')
  process.exit(1)
}

function send(socket, type) {
  socket.write(`${JSON.stringify({ v: 1, type })}\n`)
}

function finish(code) {
  process.exit(code)
}

const socket = net.createConnection(endpoint)
let remainder = ''
let asked = false
let terminal = false
const seen = []
const timer = setTimeout(() => {
  console.log(`voice: timed out after states ${seen.join(' -> ') || '(none)'}`)
  finish(1)
}, deadline)

async function presentToken(active) {
  if (!requiresToken({ endpoint, platform: process.platform })) return
  const token = await readOrCreateToken({ stateDir: host.stateDir })
  writeHandshake(active, token)
}

socket.setEncoding('utf8')
socket.on('connect', () => {
  presentToken(socket)
    .then(() => {
      if (statusOnly) send(socket, 'status')
      else {
        asked = true
        send(socket, 'toggle')
      }
    })
    .catch(() => {
      console.log('voice: the channel token could not be read')
      clearTimeout(timer)
      finish(1)
    })
})
socket.on('data', (chunk) => {
  remainder += chunk
  if (Buffer.byteLength(remainder) > 131072) {
    console.log('voice: the service sent an oversized frame')
    socket.destroy()
    return
  }
  for (const line of remainder.split('\n').slice(0, -1)) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (record?.v !== 1 || record.type !== 'status') continue
    if (seen.at(-1) !== record.state) seen.push(record.state)
    // The measured input level is the difference between a quiet room and a
    // microphone that heard something, so a recording report carries it.
    const level = record.state === 'recording' && Number.isFinite(record.level) ? ` level=${record.level.toFixed(4)}` : ''
    console.log(`[${record.state}]${level} ${record.message ?? ''}`.trimEnd())
    if (record.transcript) console.log(`transcript: ${record.transcript}`)
    // A status request reads the current state once: there is no turn to wait for.
    if (statusOnly) {
      terminal = true
      clearTimeout(timer)
      finish(record.state === 'unavailable' ? 1 : 0)
    }
    if (!asked) continue
    if (record.state !== 'idle' && record.state !== 'error') continue
    terminal = true
    clearTimeout(timer)
    // An error state is the honest result of a failed turn: report it as one.
    finish(record.state === 'idle' ? 0 : 1)
  }
  remainder = remainder.slice(remainder.lastIndexOf('\n') + 1)
})
socket.on('error', (error) => {
  console.log(`voice: ${endpoint} refused the connection (${error.code ?? error.message})`)
  clearTimeout(timer)
  finish(terminal ? 0 : 1)
})
socket.on('close', () => {
  if (terminal) return
  clearTimeout(timer)
  console.log(`voice: the service closed the link after states ${seen.join(' -> ') || '(none)'}`)
  finish(1)
})
