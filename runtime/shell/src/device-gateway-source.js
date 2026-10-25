'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn: spawnProcess } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { TextDecoder } = require('node:util')

const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const KEY = /^[0-9a-f]{32}$/i
const unicast = value => typeof value === 'string' && MAC.test(value) && !(parseInt(value.slice(0, 2), 16) & 1) && !/^00(?::00){5}$/.test(value)
const base64 = value => typeof value === 'string' && value.length > 0 && value.length <= 336 && Buffer.from(value, 'base64').toString('base64') === value && Buffer.from(value, 'base64').length <= 250

function createLineDecoder(receive) {
  let bytes = []; let size = 0; let discarded = false
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return chunk => {
    for (const byte of chunk) {
      if (byte === 10) {
        if (!discarded && size) {
          try {
            const record = JSON.parse(decoder.decode(Uint8Array.from(bytes)))
            if (record && record.v === 1 && !Array.isArray(record)) receive(record)
          } catch {}
        }
        bytes = []; size = 0; discarded = false
      } else if (!discarded) {
        if (++size >= 512) { discarded = true; bytes = [] }
        else bytes.push(byte)
      }
    }
  }
}

function validateConfig(config) {
  if (!config || Object.keys(config).some(key => !['python', 'serialNumber', 'channel', 'pmk', 'peers', 'remoteMac'].includes(key))
    || typeof config.python !== 'string' || !path.isAbsolute(config.python) || config.python.includes('\0')
    || typeof config.serialNumber !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(config.serialNumber)) throw Error('invalid-configuration')
  const peers = config.peers || []
  if (!Array.isArray(peers) || peers.length > 7 || (config.channel !== undefined && (!Number.isInteger(config.channel) || config.channel < 1 || config.channel > 11))
    || (config.pmk !== undefined && !KEY.test(config.pmk)) || (peers.length && !KEY.test(config.pmk))) throw Error('invalid-configuration')
  const seen = new Set()
  for (const peer of peers) {
    if (!peer || Object.keys(peer).some(key => !['mac', 'lmk'].includes(key)) || !unicast(peer.mac) || !KEY.test(peer.lmk)
      || seen.has(peer.mac.toLowerCase())) throw Error('invalid-configuration')
    seen.add(peer.mac.toLowerCase())
  }
  if (config.remoteMac !== undefined && (!unicast(config.remoteMac) || !seen.has(config.remoteMac.toLowerCase()))) throw Error('invalid-configuration')
  return { ...config, peers }
}

function loadConfig(file) {
  if (!file) return null
  if (!path.isAbsolute(file)) throw Error('invalid-configuration')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0))
  try {
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.size > 16384) throw Error('invalid-configuration')
    if (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid())) throw Error('configuration-not-private')
    const bytes = Buffer.alloc(16385)
    const count = fs.readSync(fd, bytes, 0, bytes.length, null)
    if (count > 16384) throw Error('invalid-configuration')
    return validateConfig(JSON.parse(bytes.subarray(0, count).toString('utf8')))
  } finally { fs.closeSync(fd) }
}

function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false
  if (action.type === 'ping') return Object.keys(action).length === 1
  return action.type === 'send' && Object.keys(action).length === 3 && unicast(action.peer) && base64(action.payload)
}

function validStatus(reply) {
  return reply.board === 'm5stack-nanoc6' && typeof reply.firmware === 'string'
    && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-zA-Z0-9.-]{1,32})?$/.test(reply.firmware) && /^[a-f0-9]{8}$/.test(reply.session)
    && unicast(reply.mac) && reply.radio === true && Number.isInteger(reply.channel) && reply.channel >= 1 && reply.channel <= 11
    && Number.isInteger(reply.peers) && reply.peers >= 0 && reply.peers <= 7
}

function createDeviceGatewaySource({ config, configFile, spawn = spawnProcess, timeoutMs = 2000, authorize = () => false, onReceive = () => {} } = {}) {
  let configurationError = false
  try { config = config ? validateConfig(config) : loadConfig(configFile) } catch { configurationError = true }
  let configuredSession = null
  const provision = async session => {
    if (config.pmk) {
      const configured = await request('configure', { channel: config.channel || 1, pmk: config.pmk })
      if (configured.ok !== true) throw Error('configuration-rejected')
      for (const peer of config.peers) {
        const reply = await request('peer', peer)
        if (reply.ok !== true) throw Error('configuration-rejected')
      }
    }
    configuredSession = session
  }
  let child = null; let ready = null; let refreshing = null; let stopped = false; let stopping = null; let sequence = 0
  const prefix = randomBytes(6).toString('hex')
  const pending = new Map()
  let snapshot = { status: configurationError ? 'unavailable' : 'unconfigured', reason: configurationError ? 'invalid-configuration' : 'select-device', events: [] }
  const fail = reason => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(reason)) }
    pending.clear()
    snapshot = { ...snapshot, status: 'disconnected', reason }
  }
  const request = (type, fields = {}) => new Promise((resolve, reject) => {
    if (!child || stopped || pending.size >= 16) return reject(Error('unavailable'))
    const id = `${prefix}-${++sequence}`
    const line = JSON.stringify({ v: 1, id, type, ...fields }) + '\n'
    if (Buffer.byteLength(line) > 512) return reject(Error('record-too-large'))
    const timer = setTimeout(() => { pending.delete(id); reject(Error('deadline')) }, timeoutMs)
    pending.set(id, { resolve, reject, timer, type })
    child.stdin.write(line, error => {
      if (!error || !pending.has(id)) return
      clearTimeout(timer); pending.delete(id); reject(Error('write-failed'))
    })
  })
  const connect = () => {
    if (ready) return ready
    if (child) return Promise.reject(Error('worker-cleanup-pending'))
    let selected
    const attempt = (async () => {
      if (!config || stopped) throw Error('unconfigured')
      selected = spawn(config.python, ['-u', path.join(__dirname, '../scripts/device-gateway-serial.py'), '--serial-number', config.serialNumber], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      child = selected
      selected.stdin.on('error', () => { if (child === selected) fail('write-failed') })
      selected.stderr.on('data', () => {}) // Private host errors never enter readings or logs.
      selected.stdout.on('data', createLineDecoder(record => {
        if (stopped || child !== selected) return
        if (record.type === 'transport-error') { fail(record.reason === 'ambiguous-device' ? 'ambiguous-device' : 'device-unavailable'); return }
        if (record.type === 'rx' && snapshot.status === 'live' && record.session === snapshot.session
          && unicast(record.peer) && base64(record.payload)
          && config.peers.some(peer => peer.mac.toLowerCase() === record.peer.toLowerCase())) {
          snapshot = { ...snapshot, events: [...snapshot.events.slice(-15), { peer: record.peer, payload: record.payload, receivedAt: Date.now() }] }
          try { onReceive({ peer: record.peer, payload: record.payload }) } catch {}
          return
        }
        const item = pending.get(record.id)
        if (!item || (record.type !== item.type && record.type !== 'error')) return
        pending.delete(record.id); clearTimeout(item.timer)
        if (record.type === 'error') item.reject(Error('device-rejected'))
        else item.resolve(record)
      }))
      const end = () => {
        if (child !== selected) return
        child = null; if (ready === attempt) ready = null; configuredSession = null; fail('device-disconnected')
      }
      selected.once('error', end); selected.once('close', end)
      const hello = await request('hello')
      if (!validStatus(hello)) throw Error('unsupported-firmware')
      await provision(hello.session)
      return hello
    })()
    ready = attempt
    void attempt.catch(() => {
      if (child === selected) { try { selected.kill() } catch {} }
      if (ready === attempt) ready = null
    })
    return attempt
  }
  return {
    dispatch(event, action) {
      if (!authorize(event)) return Promise.resolve({ ok: false, error: 'unauthorized' })
      return action?.type === 'status' ? this.refresh() : this.action(action)
    },
    snapshot: () => structuredClone(snapshot),
    refresh() {
      if (stopped || !config) return Promise.resolve(structuredClone(snapshot))
      if (refreshing) return refreshing
      refreshing = (async () => {
        try {
          await connect()
          let reply = await request('status')
          if (!validStatus(reply)) throw Error('unsupported-firmware')
          if (reply.session !== configuredSession) {
            snapshot = { ...snapshot, status: 'syncing', events: [] }
            await provision(reply.session)
            reply = await request('status')
            if (!validStatus(reply) || reply.session !== configuredSession) throw Error('unsupported-firmware')
          }
          const { board, firmware, session, mac, channel, peers, radio } = reply
          if (!stopped) snapshot = { ...snapshot, events: snapshot.session === session ? snapshot.events : [], status: 'live', reason: '', board, firmware, session, mac, channel, peers, radio, receivedAt: Date.now() }
        } catch (error) {
          if (!stopped) snapshot = { ...snapshot, status: 'unavailable', reason: error.message === 'unsupported-firmware' ? error.message : 'device-unavailable' }
        }
        return structuredClone(snapshot)
      })().finally(() => { refreshing = null })
      return refreshing
    },
    async action(action) {
      if (!validateAction(action)) return { ok: false, error: 'invalid-action' }
      if (snapshot.status !== 'live' || stopped) return { ok: false, error: 'unavailable' }
      if (action.type === 'send' && !config.peers.some(peer => peer.mac.toLowerCase() === action.peer.toLowerCase())) return { ok: false, error: 'peer-not-granted' }
      try {
        const { type, ...fields } = action
        const reply = await request(type, fields)
        if (reply.ok !== true) return { ok: false, error: 'device-rejected' }
        return { ok: true, delivery: type === 'send' ? 'mac-receipt' : 'usb-reply' }
      } catch { return { ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'device-unavailable' } }
    },
    stop() {
      if (stopping) return stopping
      stopped = true; fail('stopped')
      const selected = child
      if (!selected) return Promise.resolve()
      stopping = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { selected.kill('SIGKILL'); reject(Error('gateway-worker-cleanup-timeout')) }, 3000)
        selected.once('close', () => { clearTimeout(timer); resolve() })
        selected.kill()
      }).finally(() => { stopping = null })
      return stopping
    },
  }
}

module.exports = { createDeviceGatewaySource, createLineDecoder, validateAction, validateConfig, loadConfig }
