'use strict'
const { TextDecoder } = require('node:util')
const { createHydraStore } = require('./hydra-mqtt')
const { createHydraPeerStore, unicast } = require('./hydra-peer-store')
const { createHydraControlBroker } = require('./hydra-control-broker')
const { readHydraControlKey } = require('./hydra-control-key')
const { createHydraPlanStore } = require('./hydra-control-plan-store')
const LIVE_MS = 10000
const STATUSES = new Set(['IDLE', 'PULSE', 'SOAK', 'WATER', 'PAUSE', 'WAIT', 'DORM', 'FAULT'])
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff
const numeric = value => typeof value === 'number' && Number.isFinite(value)
const between = (value, low, high) => numeric(value) && value >= low && value <= high
function decodeHydraTelemetry(payload) {
  try {
    if (typeof payload !== 'string' || !payload.length || payload.length > 336) return null
    const bytes = Buffer.from(payload, 'base64')
    if (bytes.length > 250 || bytes.toString('base64') !== payload) return null
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || Array.isArray(value) || value.p !== 'hydra' || value.v !== 1 || typeof value.boot !== 'string' || !/^[a-f0-9]{16}$/.test(value.boot) || !uint32(value.seq) || !value.seq) return null
    const common = ['p', 'v', 'k', 'boot', 'seq']
    let fields
    if (value.k === 'hello') {
      fields = ['firmware', 'uptime', 'clock']
      if (typeof value.firmware !== 'string' || !/^[\x20-\x7e]{1,24}$/.test(value.firmware) || !value.firmware.trim() || !uint32(value.uptime) || typeof value.clock !== 'boolean') return null
    } else if (value.k === 'env') {
      fields = value.valid === false ? ['age', 'valid'] : ['age', 'valid', 'tc', 'rh', 'hp', 'lx', 'vp']
      if (!uint32(value.age) || typeof value.valid !== 'boolean') return null
      if (value.valid && (!between(value.tc, -50, 100) || !between(value.rh, 0, 100) || !between(value.hp, 100, 1300)
        || !(value.lx === null || between(value.lx, 0, 200000)) || !(value.vp === null || between(value.vp, 0, 100)))) return null
    } else if (value.k === 'node') {
      fields = ['id', 'age', 'online', 'soil', 'status']
      if (!Number.isInteger(value.id) || value.id < 1 || value.id > 6 || !uint32(value.age) || typeof value.online !== 'boolean' || (value.soil !== null && (!numeric(value.soil) || value.soil < 0 || value.soil > 100)) || !STATUSES.has(value.status)) return null
    } else return null
    if (Object.keys(value).length !== common.length + fields.length || Object.keys(value).some(key => !common.includes(key) && !fields.includes(key))) return null
    return value
  } catch { return null }
}

function createHydraEspNowSource({ deviceGateway, profileFile, peerStore = createHydraPeerStore(profileFile), now = Date.now, onUpdate = () => {}, authorize = () => false, controlKeyFile, controlPlanFile, planStore = createHydraPlanStore(controlPlanFile), readControlKey = () => readHydraControlKey(controlKeyFile), controlOptions = {}, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  let stopped = false, peer = null, profileError = false, generation = 0, mutation = Promise.resolve(), managementPending = 0
  let store = createHydraStore(), boot = null, sequence = 0, lastHello = null, activeSession = false, firmware, clockValid
  const retired = new Map(), cleanups = new Set()
  let releaseEvent = null, lastStatus = ''
  try { peer = peerStore.load(); if (peer !== null && !unicast(peer)) throw Error('invalid-profile'); peer = peer?.toLowerCase() || null } catch { profileError = true }
  const notify = () => { if (!stopped) { try { onUpdate() } catch {} } }
  function bridge() { try { return deviceGateway?.snapshot?.() || {} } catch { return {} } }
  function available(state = bridge()) {
    if (!unicast(state.remote?.mac) || !Array.isArray(state.peers)) return []
    return [...new Set(state.peers.filter(item => item.role === 'device' && unicast(item.mac) && item.mac.toLowerCase() !== state.remote.mac.toLowerCase()).map(item => item.mac.toLowerCase()))].slice(0, 7)
  }
  function linkReady() { const state = bridge(); return state.status === 'live' && state.gateway?.status === 'live' && available(state).includes(peer) }
  function live() { return !stopped && peer !== null && activeSession && lastHello !== null && now() - lastHello >= 0 && now() - lastHello <= LIVE_MS && linkReady() }
  const control = createHydraControlBroker({ ...controlOptions, deviceGateway, planStore, readKey: readControlKey, authorize, onUpdate: notify,
    getContext: () => ({ peer, gateway: bridge().gateway?.mac, boot, generation, connected: live() && !profileError && managementPending === 0 }), setIntervalFn, clearIntervalFn })
  function snapshot(time = now()) {
    const value = store.snapshot(time), online = live()
    return { ...value, configured: peer !== null, connected: online,
      ...(value.mainOnline === undefined ? {} : { mainOnline: online && value.mainOnline }),
      env: value.env ? { ...value.env, stale: value.env.stale || !online } : null,
      nodes: value.nodes.map(item => ({ ...item, stale: item.stale || !online })) }
  }
  function deviceSnapshot() {
    const status = stopped || profileError ? 'unavailable' : peer === null ? 'unconfigured' : !linkReady() ? 'unavailable' : live() ? 'live' : boot === null ? 'syncing' : 'unavailable'
    return { transport: 'esp-now', peer, status, ...(firmware === undefined ? {} : { firmware }), ...(clockValid === undefined ? {} : { clockValid }), availablePeers: available(), nodes: snapshot().nodes, control: control.snapshot() }
  }
  function receive(event, capturedGeneration) {
    if (stopped || capturedGeneration !== generation || !peer || typeof event?.peer !== 'string' || event.peer.toLowerCase() !== peer || !linkReady()) return
    const received = event.receivedAt
    if (!Number.isFinite(received) || received < 0 || received > now() || now() - received > LIVE_MS) return
    if (typeof event.payload === 'string' && event.payload.length === 172 && Buffer.from(event.payload, 'base64').subarray(0, 4).toString('ascii') === 'HDC1') { control.receive(event); return }
    const record = decodeHydraTelemetry(event.payload)
    if (!record) return
    if (record.k === 'hello') {
      if (boot !== record.boot) {
        for (const [previous, retiredAt] of retired) if (now() - retiredAt > LIVE_MS) retired.delete(previous)
        if (retired.has(record.boot) || retired.size >= 64) return
        if (boot !== null) retired.set(boot, now())
        boot = record.boot; sequence = 0; store = createHydraStore(); control.sync()
      }
      if (record.seq <= sequence) return
      sequence = record.seq; lastHello = received; activeSession = true; firmware = record.firmware; clockValid = record.clock
      store.markConnected(true)
      store.applyMessage('hydra/main/online', 'true', received)
      for (const [key, value] of [['firmware', firmware], ['boot', boot], ['uptime_s', String(record.uptime)]]) store.applyMessage(`hydra/main/diag/${key}`, value, received)
      notify(); return
    }
    if (!live() || record.boot !== boot || record.seq <= sequence) return
    const measured = received - record.age
    if (measured < 0 || measured > now()) return
    sequence = record.seq
    if (record.k === 'env') {
      const value = record.valid ? `v=1;l=${record.lx === null ? 0 : 1};t=${record.tc};h=${record.rh};p=${record.hp}${record.lx === null ? '' : `;x=${record.lx}`}${record.vp === null ? '' : `;d=${record.vp}`}` : 'v=0'
      store.applyMessage('hydra/main/env', value, measured)
    } else {
      for (const [key, value] of [['soil', record.soil === null ? 'NC' : String(record.soil)], ['online', String(record.online)], ['status', record.status]]) store.applyMessage(`hydra/node${record.id}/${key}`, value, measured)
    }
    notify()
  }
  function subscribePeer() {
    const captured = generation
    if (peer && typeof deviceGateway?.onEvent === 'function') { releaseEvent = deviceGateway.onEvent(event => receive(event, captured)); if (typeof releaseEvent === 'function') cleanups.add(releaseEvent) }
  }
  function select(selected) {
    generation++
    peer = selected; profileError = false; store = createHydraStore(); boot = null; sequence = 0; lastHello = null; activeSession = false; firmware = undefined; clockValid = undefined; retired.clear(); control.sync()
    if (releaseEvent) {
      try { releaseEvent(); cleanups.delete(releaseEvent); releaseEvent = null }
      catch (error) { profileError = true; notify(); throw error }
    }
    if (!stopped) subscribePeer()
    notify()
  }
  subscribePeer()
  const releaseSnapshot = deviceGateway?.onSnapshot?.(() => { if (stopped) return; if (!linkReady()) activeSession = false; control.sync(); notify() })
  if (typeof releaseSnapshot === 'function') cleanups.add(releaseSnapshot)
  const timer = setIntervalFn(() => {
    if (stopped) return
    if (lastHello !== null && now() - lastHello > LIVE_MS) activeSession = false
    const status = deviceSnapshot().status
    if (status !== lastStatus) { lastStatus = status; notify() }
  }, 1000)
  timer?.unref?.()
  function deviceAction(action, event) {
    if (!authorize(event)) return Promise.resolve({ ok: false, error: 'unauthorized' })
    if (!action || typeof action !== 'object' || Array.isArray(action)) return Promise.resolve({ ok: false, error: 'invalid-action' })
    if (['prepare-water', 'prepare-plan', 'prepare-stop', 'confirm', 'cancel', 'control-visibility'].includes(action.type)) return control.action(action, event)
    if (action.type === 'status' && Object.keys(action).length === 1) return Promise.resolve(deviceSnapshot())
    if (!(action.type === 'unbind' && Object.keys(action).length === 1) && !(action.type === 'bind' && Object.keys(action).length === 2 && unicast(action.peer))) return Promise.resolve({ ok: false, error: 'invalid-action' })
    const selected = action.type === 'unbind' ? null : action.peer.toLowerCase()
    managementPending++; control.sync()
    const operation = mutation.then(async () => {
      if (stopped) return { ok: false, error: 'unavailable' }
      if (!authorize(event)) return { ok: false, error: 'unauthorized' }
      if (selected !== null && !available().includes(selected)) return { ok: false, error: 'peer-not-configured' }
      try {
        await peerStore.save(selected)
        select(selected)
        return { ok: true }
      } catch { return { ok: false, error: 'profile-unavailable' } }
    })
    const finalized = operation.finally(() => { managementPending--; control.sync(); notify() })
    mutation = finalized.catch(() => {})
    return finalized
  }
  return { snapshot, cachedSnapshot: snapshot, deviceSnapshot, deviceAction, dispatchDevice: (event, action) => deviceAction(action, event),
    async stop() {
      stopped = true; generation++; control.stop(); clearIntervalFn(timer)
      await mutation
      const failures = []
      for (const cleanup of cleanups) { try { cleanup(); cleanups.delete(cleanup) } catch (error) { failures.push(error) } }
      if (failures.length) throw new AggregateError(failures, 'Hydra subscription cleanup failed')
    } }
}
module.exports = { createHydraEspNowSource, decodeHydraTelemetry, LIVE_MS }
