'use strict'
const { randomUUID, timingSafeEqual } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { unicast } = require('./hydra-peer-store')
const { TYPES, encodeControlFrame, decodeControlFrame, waterBody, planBody } = require('./hydra-control-codec')
const MAX_ID = (1n << 64n) - 1n, PRESENCE_MS = 1000, TOKEN_MS = 30000, ACK_MS = 1000
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const fail = error => ({ ok: false, error })
function createHydraControlBroker({ deviceGateway, readKey = () => null, getContext = () => ({}), authorize = () => false, onUpdate = () => {}, now = () => performance.now(), randomToken = randomUUID,
  planStore, unixNow = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let stopped = false, key = null, scope = '', epoch = 0, presence = null, pending = null, querying = null, preparing = false
  let boot = null, highwater = 0n, issued = null, lease = null, result = null, physicalOwner = null
  const owner = event => event?.sender || event
  const notify = () => { try { onUpdate() } catch {} }
  const context = () => { try { return getContext() || {} } catch { return {} } }
  function clear(reason = 'control-scope-changed', discardObservations = false) {
    epoch++; pending = null; lease = null; boot = null; highwater = 0n
    if (issued?.waiting && !discardObservations) result = { ...result, state: 'unknown' }
    else result = null
    physicalOwner = null; issued = null
    if (querying) { const previous = querying; querying = null; clearTimeoutFn(previous.timer); previous.reject(Error(reason)) }
    notify()
  }
  function sync() {
    if (stopped) return context()
    const value = context(), next = JSON.stringify([value.peer, value.gateway, value.generation, value.boot, value.connected])
    if (next !== scope) { scope = next; clear('control-scope-changed', true) }
    let nextKey
    try { nextKey = readKey() } catch {}
    if (!Buffer.isBuffer(nextKey) || nextKey.length !== 32 || !nextKey.some(value => value)) nextKey = null
    if (!!key !== !!nextKey || (key && nextKey && !timingSafeEqual(key, nextKey))) { key?.fill(0); key = nextKey ? Buffer.from(nextKey) : null; clear('key-unavailable', true) }
    if (presence && (now() - presence.at < 0 || now() - presence.at >= PRESENCE_MS || !authorize(presence.event))) { presence = null; clear('devices-inactive') }
    if (pending && now() >= pending.expires) { pending = null; notify() }
    return value
  }
  function allowed(event) {
    const value = sync()
    if (stopped || !authorize(event)) return 'unauthorized'
    if (!key) return 'key-unavailable'
    if (!presence || presence.owner !== owner(event)) return 'devices-inactive'
    if (!value.connected || !unicast(value.peer) || !unicast(value.gateway) || value.peer.toLowerCase() === value.gateway.toLowerCase()) return 'hydra-unavailable'
    return null
  }
  function packet(type, commandId, challenge = Buffer.alloc(16), deadline = 0, body = Buffer.alloc(0)) {
    const value = context()
    return { type, main: value.peer.toLowerCase(), gateway: value.gateway.toLowerCase(), boot: type === TYPES.QUERY ? 0n : boot, challenge, commandId, deadline, body }
  }
  function transport(frame) {
    const bytes = encodeControlFrame(frame, key), action = { type: 'send', peer: frame.main, payload: bytes.toString('base64') }
    try { return Promise.resolve(typeof deviceGateway?.send === 'function' ? deviceGateway.send(action.peer, action.payload) : deviceGateway?.action?.(action)) } catch { return Promise.resolve({ ok: false }) }
  }
  async function query(id, event, captured) {
    if (allowed(event) || captured !== epoch || querying) throw Error('confirmation-cancelled')
    let request
    const response = new Promise((resolve, reject) => {
      request = { id, resolve, reject, sentAt: now(), timer: null }
      request.timer = setTimeoutFn(() => { if (querying === request) { querying = null; reject(Error('challenge-unavailable')) } }, 1000)
      querying = request
    })
    // Attach before transport can fail or synchronously deliver its response.
    const observed = response.then(value => ({ value }), () => ({ error: true }))
    try {
      void transport(packet(TYPES.QUERY, id)).then(receipt => {
        if (!receipt?.ok && querying === request) { const active = querying; querying = null; clearTimeoutFn(active.timer); active.reject(Error('challenge-unavailable')) }
      }, () => { if (querying === request) { const active = querying; querying = null; clearTimeoutFn(active.timer); active.reject(Error('challenge-unavailable')) } })
      const outcome = await observed
      if (outcome.error || allowed(event) || epoch !== captured) throw Error('confirmation-cancelled')
      return outcome.value
    } catch {
      if (querying === request) { clearTimeoutFn(querying.timer); querying.reject(Error('challenge-unavailable')); querying = null }
      throw Error('challenge-unavailable')
    }
  }
  function summary(action) {
    if (action.type === 'prepare-water') return { action: 'water', node: action.node, durationMs: action.durationMs }
    if (action.type === 'prepare-stop') return { action: 'stop', node: action.node }
    return { action: 'plan', node: action.node, windowSeq: action.windowSeq, season: action.season, entries: action.entries.map(entry => ({ ...entry })) }
  }
  function preparePayload(action) {
    if (exact(action, ['type', 'node', 'durationMs']) && action.type === 'prepare-water') return { type: TYPES.WATER, body: waterBody(action.node, action.durationMs) }
    if (exact(action, ['type', 'node']) && action.type === 'prepare-stop' && Number.isInteger(action.node) && action.node >= 1 && action.node <= 6) return { type: TYPES.STOP, body: Buffer.from([action.node]) }
    if (exact(action, ['type', 'node', 'season', 'entries']) && action.type === 'prepare-plan') {
      planBody({ node: action.node, windowSeq: 1, season: action.season, entries: action.entries })
      let previous
      try { previous = planStore.get(context().peer, action.node) } catch { throw Error('plan-state-unavailable') }
      const windowSeq = Math.max(previous + 1, Math.floor(unixNow() / 1000), 1)
      if (!Number.isInteger(windowSeq) || windowSeq > 0xffffffff) throw Error('plan-state-unavailable')
      return { type: TYPES.PLAN, body: planBody({ node: action.node, windowSeq, season: action.season, entries: action.entries }) }
    }
    throw Error('invalid-action')
  }
  async function action(action, event) {
    if (!authorize(event) || stopped) return fail('unauthorized')
    if (exact(action, ['type', 'visible']) && action.type === 'control-visibility' && typeof action.visible === 'boolean') {
      if (!action.visible) { if (presence?.owner === owner(event)) { presence = null; clear('devices-inactive') } }
      else { if (presence && presence.owner !== owner(event)) clear('devices-inactive'); presence = { owner: owner(event), event, at: now() }; sync() }
      return { ok: true }
    }
    if (exact(action, ['type']) && action.type === 'cancel') { clear('confirmation-cancelled'); return { ok: true } }
    const error = allowed(event); if (error) return fail(error)
    if (action?.type?.startsWith('prepare-')) {
      let payload, safeSummary
      try { payload = preparePayload(action); safeSummary = summary(action); if (payload.type === TYPES.PLAN) safeSummary.windowSeq = payload.body.readUInt32LE(1) } catch (error) { return fail(error?.message === 'plan-state-unavailable' ? 'plan-state-unavailable' : 'invalid-action') }
      if (preparing || querying || issued?.waiting) return fail('busy')
      clear('confirmation-cancelled'); preparing = true
      const captured = epoch
      try {
        const status = await query(0n, event, captured)
        if (allowed(event) || captured !== epoch) return fail('confirmation-cancelled')
        boot = status.boot; highwater = status.body.readBigUInt64LE(0)
        const token = randomToken()
        if (typeof token !== 'string' || token.length < 8 || token.length > 128) return fail('control-unavailable')
        pending = { token, summary: safeSummary, payload, expires: now() + TOKEN_MS, owner: owner(event), epoch }
        notify(); return { ok: true, token, summary: structuredClone(safeSummary), expiresInMs: TOKEN_MS }
      } catch { return fail('challenge-unavailable') } finally { preparing = false }
    }
    if (!exact(action, ['type', 'token']) || action.type !== 'confirm' || typeof action.token !== 'string') return fail('invalid-action')
    const prepared = pending; pending = null
    if (!prepared || prepared.token !== action.token || prepared.owner !== owner(event) || prepared.epoch !== epoch || now() >= prepared.expires) return fail('confirmation-expired')
    if (highwater >= MAX_ID) return fail('command-space-exhausted')
    const id = ++highwater, captured = epoch, capturedBoot = boot
    try {
      const challenge = await query(id, event, captured)
      if (allowed(event) || epoch !== captured || boot !== capturedBoot || challenge.boot !== capturedBoot || now() >= challenge.expires) return fail('confirmation-cancelled')
      if (prepared.payload.type === TYPES.PLAN) {
        try { await planStore.reserve(context().peer, prepared.payload.body[0], prepared.payload.body.readUInt32LE(1)) } catch { return fail('plan-state-unavailable') }
        if (allowed(event) || epoch !== captured || boot !== capturedBoot || now() >= challenge.expires) return fail('confirmation-cancelled')
      }
      const frame = packet(prepared.payload.type, id, challenge.challenge, challenge.deadline, prepared.payload.body)
      issued = { frame, sentAt: now(), waiting: true, epoch: captured, expires: now() + ACK_MS }
      result = { state: 'awaiting-ack', action: prepared.summary.action, node: frame.body[0], commandId: id.toString() }
      const failed = () => { if (issued?.frame === frame && issued.waiting) { issued.waiting = false; lease = null; result = { ...result, state: 'unknown' }; notify() } }
      void transport(frame).then(receipt => { if (!receipt?.ok) failed() }, failed)
      notify(); return { ok: true, state: result.state, commandId: id.toString() }
    } catch { return fail('challenge-unavailable') }
  }
  function receive(event) {
    const value = sync()
    if (!key || !presence || !value.connected || event?.peer?.toLowerCase() !== value.peer?.toLowerCase() || typeof event.payload !== 'string' || event.payload.length > 172) return false
    const bytes = Buffer.from(event.payload, 'base64')
    if (bytes.toString('base64') !== event.payload) return false
    const frame = decodeControlFrame(bytes, key, { main: value.peer, gateway: value.gateway }); if (!frame) return false
    if (boot !== null && frame.boot !== boot) { clear('control-scope-changed', true); return false }
    if (frame.type === TYPES.CHALLENGE && querying && frame.commandId === querying.id) {
      const request = querying
      if (request.id !== 0n && (frame.boot !== boot || now() >= request.sentAt + 5000)) { clear(); return false }
      querying = null; clearTimeoutFn(request.timer)
      request.resolve({ ...frame, expires: request.sentAt + 5000 }); return true
    }
    if (frame.type !== TYPES.ACK || !issued || issued.epoch !== epoch || frame.boot !== boot || frame.commandId !== issued.frame.commandId || !frame.challenge.equals(issued.frame.challenge) || frame.body[0] !== issued.frame.body[0]) return false
    const code = frame.body[1]
    if (code === 1 && ((frame.deadline - issued.frame.deadline) >>> 0) >= 5000) return false
    if (issued.frame.type !== TYPES.WATER && frame.body.readUInt32LE(3) !== 0) return false
    if (!issued.waiting && !(issued.frame.type === TYPES.PLAN && result?.state === 'accepted-main' && code >= 2)) return false
    if (issued.waiting && now() >= issued.expires) return false
    if (issued.frame.type !== TYPES.PLAN && code !== 1) return false
    issued.waiting = false; physicalOwner = !!frame.body[2]
    result = { ...result, state: code === 1 ? 'accepted-main' : code === 2 ? 'leaf-installed' : 'leaf-rejected' }
    if (issued.frame.type === TYPES.WATER && code === 1) {
      const deviceNow = (frame.deadline - 5000) >>> 0, end = frame.body.readUInt32LE(3), remaining = (end - deviceNow) >>> 0
      if (!remaining || remaining > issued.frame.body.readUInt32LE(1)) { result = { ...result, state: 'unknown' }; lease = null }
      else lease = { frame: issued.frame, end, deviceNow, at: now(), expires: Math.min(issued.sentAt + issued.frame.body.readUInt32LE(1), now() + remaining), counter: 0, nextAt: now() + 250, inflight: null }
    }
    notify(); return true
  }
  function tick() {
    sync()
    if (issued?.waiting && now() >= issued.expires) { issued.waiting = false; lease = null; result = { ...result, state: 'unknown' }; notify() }
    if (!lease) return
    const active = lease, deviceNow = (active.deviceNow + Math.max(0, Math.floor(now() - active.at))) >>> 0, remaining = (active.end - deviceNow) >>> 0
    if (!presence || !context().connected || now() >= active.expires || !remaining || remaining > 30000 || active.counter >= 0xffffffff || active.inflight !== null && now() - active.inflight >= 1000) { lease = null; notify(); return }
    if (active.inflight !== null || now() < active.nextAt) return
    active.counter++; active.nextAt = now() + 250; active.inflight = now()
    const body = Buffer.alloc(5); body[0] = active.frame.body[0]; body.writeUInt32LE(active.counter, 1)
    const frame = { ...active.frame, type: TYPES.HEARTBEAT, deadline: (deviceNow + Math.min(750, remaining)) >>> 0, body }
    void transport(frame).then(receipt => { if (lease === active) { active.inflight = null; if (!receipt?.ok) { lease = null; result = { ...result, state: 'unknown' }; notify() } } }, () => { if (lease === active) { lease = null; result = { ...result, state: 'unknown' }; notify() } })
  }
  function snapshot() {
    const value = sync(), reason = stopped ? 'unavailable' : !key ? 'key-unavailable' : !presence ? 'devices-inactive' : !value.connected ? 'hydra-unavailable' : null
    let planAvailable = false
    try { planAvailable = unicast(value.peer) && Number.isInteger(planStore.get(value.peer, 1)) } catch {}
    return { planSequence: { available: !!planAvailable, deviceKnown: false }, available: reason === null, reason, pending: pending ? { token: pending.token, summary: structuredClone(pending.summary), expiresInMs: Math.max(0, pending.expires - now()) } : null,
      result: result ? { ...result } : null, physicalOwner, lease: { active: !!lease, ...(lease ? { commandId: lease.frame.commandId.toString(), remainingMs: Math.max(0, Math.min(lease.expires - now(), ((lease.end - lease.deviceNow) >>> 0) - (now() - lease.at))) } : {}) } }
  }
  const timer = setIntervalFn(tick, 250); timer?.unref?.()
  return { action, receive, sync, tick, snapshot, stop() { stopped = true; presence = null; clear(); key?.fill(0); key = null; clearIntervalFn(timer) } }
}
module.exports = { createHydraControlBroker }
