'use strict'
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { constants } = require('node:fs')
const path = require('node:path')
const ID = /^[a-z][a-z0-9-]{0,63}$/
const REVISION = /^[a-f0-9]{32}$/
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const unicast = value => typeof value === 'string' && MAC.test(value) && !(parseInt(value.slice(0, 2), 16) & 1) && value !== '00:00:00:00:00:00'
function peers(value = []) {
  if (!Array.isArray(value) || value.length > 7 || value.some(mac => !unicast(mac))) throw Error('invalid-device-declaration')
  const result = value.map(mac => mac.toLowerCase())
  if (new Set(result).size !== result.length) throw Error('invalid-device-declaration')
  return result
}
function parseDevices(value, kind = 'app') {
  if (value === undefined) return undefined
  if (!object(value) || Object.keys(value).some(key => !['gateway', 'read', 'send'].includes(key)) || (value.gateway !== undefined && typeof value.gateway !== 'boolean')) throw Error('invalid-device-declaration')
  const result = { gateway: value.gateway === true, read: peers(value.read), send: peers(value.send) }
  if (kind !== 'app' && result.send.length) throw Error('invalid-device-declaration')
  if (!result.gateway && !result.read.length && !result.send.length) throw Error('invalid-device-declaration')
  return result
}
function parseDeviceGrants(value) {
  if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'grants'].includes(key)) || !Array.isArray(value.grants) || value.grants.length > 32) throw Error('invalid-device-grants')
  const seen = new Set()
  const grants = value.grants.map(item => {
    if (!object(item) || typeof item.appId !== 'string' || !ID.test(item.appId) || typeof item.revision !== 'string' || !REVISION.test(item.revision) || Object.keys(item).some(key => !['appId', 'revision', 'gateway', 'read', 'send'].includes(key))) throw Error('invalid-device-grants')
    const key = `${item.appId}:${item.revision}`
    if (seen.has(key)) throw Error('invalid-device-grants')
    seen.add(key)
    const { appId, revision, ...declaration } = item
    return { appId, revision, ...parseDevices(declaration) }
  })
  return { schemaVersion: 1, grants }
}
async function loadDeviceGrants(file) {
  if (!path.isAbsolute(file || '')) throw Error('invalid-device-grants')
  const selected = await fs.lstat(file)
  if (!selected.isFile() || selected.isSymbolicLink()) throw Error('invalid-device-grants')
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.dev !== selected.dev || stat.ino !== selected.ino || stat.size > 16384 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('invalid-device-grants')
    const bytes = Buffer.alloc(16385)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, null)
    if (bytesRead > 16384) throw Error('invalid-device-grants')
    return parseDeviceGrants(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')))
  } finally { await handle.close() }
}
function loadDeviceGrantsSync(file) {
  if (!path.isAbsolute(file || '')) throw Error('invalid-device-grants')
  const selected = fsSync.lstatSync(file)
  if (!selected.isFile() || selected.isSymbolicLink()) throw Error('invalid-device-grants')
  const fd = fsSync.openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const stat = fsSync.fstatSync(fd)
    if (!stat.isFile() || stat.dev !== selected.dev || stat.ino !== selected.ino || stat.size > 16384 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('invalid-device-grants')
    const bytes = Buffer.alloc(16385)
    const count = fsSync.readSync(fd, bytes, 0, bytes.length, null)
    if (count > 16384) throw Error('invalid-device-grants')
    return parseDeviceGrants(JSON.parse(bytes.subarray(0, count).toString('utf8')))
  } finally { fsSync.closeSync(fd) }
}
function validPayload(payload) {
  return typeof payload === 'string' && payload.length > 0 && payload.length <= 336 && Buffer.from(payload, 'base64').toString('base64') === payload && Buffer.from(payload, 'base64').length <= 250
}
function isActiveDeviceFrame(event, identity, windows, shellDocument = path.join(__dirname, 'renderer', 'index.html')) {
  try {
    const win = windows.find(value => value.webContents === event?.sender)
    if (!win || event.senderFrame !== win.webContents.mainFrame || typeof identity?.frameToken !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(identity.frameToken)) return false
    const { fileURLToPath } = require('node:url')
    if (!path.isAbsolute(shellDocument) || fileURLToPath(new URL(event.senderFrame.url)) !== shellDocument) return false
    return win.webContents.mainFrame.framesInSubtree.some(frame => {
      if (frame === win.webContents.mainFrame || frame.detached) return false
      const url = new URL(frame.url)
      return url.protocol === 'odk-user-app:' && url.hostname === 'app' && url.pathname === `/${identity.appId}/${identity.revision}` && url.searchParams.get('token') === identity.frameToken
    })
  } catch { return false }
}
function createUserAppDevices({ store, gateway, grantsFile, readGrants = () => loadDeviceGrants(grantsFile), readGrantsNow = () => loadDeviceGrantsSync(grantsFile), isActive = () => false, reservedPeers = [], timeoutMs = 2500 } = {}) {
  let stopped = false, active = 0
  const reserved = new Set(reservedPeers.map(mac => mac.toLowerCase()))
  const pending = new Set()
  const failure = error => ({ ok: false, error })
  function rightsFor(app, grant, operation, peer) {
    const declaration = parseDevices(app.devices, app.kind)
    if (!declaration || !grant) throw Error('device-not-granted')
    const rights = { gateway: declaration.gateway && grant.gateway, read: declaration.read.filter(mac => grant.read.includes(mac)), send: app.kind === 'app' ? declaration.send.filter(mac => grant.send.includes(mac)) : [] }
    if (operation === 'send' ? !rights.send.includes(peer) : !rights.gateway && !rights.read.length) throw Error('device-not-granted')
    return rights
  }
  async function authorize(identity, operation, peer) {
    if (stopped) throw Error('runtime-stopped')
    if (!object(identity) || typeof identity.appId !== 'string' || !ID.test(identity.appId) || typeof identity.revision !== 'string' || !REVISION.test(identity.revision) || isActive(identity) !== true) throw Error('frame-inactive')
    let grants
    try { grants = parseDeviceGrants(await readGrants()) } catch { throw Error('device-not-granted') }
    // Grant loading can yield while an update installs another revision.
    // Read the catalog after that yield, before admitting any device action.
    const result = await store.getContent(identity.appId)
    if (!result.ok || result.app.revision !== identity.revision) throw Error('revision-changed')
    const grant = grants.grants.find(item => item.appId === identity.appId && item.revision === identity.revision)
    const rights = rightsFor(result.app, grant, operation, peer)
    if (stopped) throw Error('runtime-stopped')
    if (isActive(identity) !== true) throw Error('frame-inactive')
    return rights
  }
  async function run(identity, operation, peer, payload) {
    if (operation === 'send' && (!unicast(peer) || !validPayload(payload))) return failure('invalid-device-request')
    peer = peer?.toLowerCase()
    if (operation === 'send' && reserved.has(peer)) return failure('reserved-peer')
    if (active >= 8) return failure('device-busy')
    active++
    try {
      const rights = await authorize(identity, operation, peer)
      if (!gateway) return failure('device-unavailable')
      const initial = gateway.snapshot()
      if (operation === 'send') {
        // A missing Remote identity is not permission to transmit through its reserved protocol.
        if (initial?.status !== 'live' || !unicast(initial?.remote?.mac)) return failure('device-unavailable')
        if (initial.remote.mac.toLowerCase() === peer || initial.peers?.some(item => item.role === 'remote' && item.mac?.toLowerCase() === peer)) return failure('reserved-peer')
      }
      let timer, expired = false
      const deadline = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(failure(operation === 'send' ? 'delivery-unknown' : 'device-timeout')) }, timeoutMs) })
      let value
      try {
        // authorize() resolves across a microtask boundary. Teardown can run
        // there, so check frame admission synchronously at the actual dispatch.
        if (stopped) throw Error('runtime-stopped')
        if (isActive(identity) !== true) throw Error('frame-inactive')
        let work
        if (operation === 'send') {
          if (typeof store.withCurrentRevision !== 'function') return failure('device-unavailable')
          const admission = await store.withCurrentRevision(identity.appId, identity.revision, app => {
            let currentGrants
            try { currentGrants = parseDeviceGrants(readGrantsNow()) } catch { throw Error('device-not-granted') }
            const grant = currentGrants.grants.find(item => item.appId === identity.appId && item.revision === identity.revision)
            rightsFor(app, grant, operation, peer)
            if (stopped) throw Error('runtime-stopped')
            if (expired) throw Error('delivery-unknown')
            if (isActive(identity) !== true) throw Error('frame-inactive')
            const selected = gateway.snapshot()
            if (selected?.status !== 'live' || !unicast(selected?.remote?.mac)) throw Error('device-unavailable')
            if (selected.remote.mac.toLowerCase() === peer || selected.peers?.some(item => item.role === 'remote' && item.mac?.toLowerCase() === peer)) return failure('reserved-peer')
            const operationResult = gateway.action({ type: 'send', peer, payload })
            void Promise.resolve(operationResult).catch(() => {})
            return { ok: true, operation: operationResult }
          })
          if (!admission?.ok) return failure(admission?.error === 'reserved-peer' ? 'reserved-peer' : 'revision-changed')
          work = admission.operation
        } else work = gateway.snapshot()
        value = await Promise.race([work, deadline])
      } finally { clearTimeout(timer) }
      const current = await authorize(identity, operation, peer)
      if (operation === 'send') return value?.ok === true && value.delivery === 'mac-receipt' ? { ok: true, delivery: 'mac-receipt' } : failure(value?.error === 'reserved-peer' ? 'reserved-peer' : 'delivery-unknown')
      const allowed = current.read.filter(mac => rights.read.includes(mac))
      // Copy the public contract only. Keys, transport configuration, and raw Remote frames never leave the host.
      const fields = (item, keys) => Object.fromEntries(keys.filter(key => ['string', 'number', 'boolean'].includes(typeof item[key])).map(key => [key, item[key]]))
      const live = value?.status === 'live'
      return { ok: true, status: ['live', 'unavailable', 'disconnected', 'unconfigured', 'stale'].includes(value?.status) ? value.status : 'unavailable',
        ...(live && rights.gateway && current.gateway && object(value?.gateway) ? { gateway: fields(value.gateway, ['serialNumber', 'mac', 'firmware', 'channel', 'status', 'receivedAt']) } : {}),
        ...(live && object(value?.remote) && allowed.includes(value.remote.mac?.toLowerCase()) ? { remote: fields(value.remote, ['mac', 'status', 'lastSeen']) } : {}),
        peers: live && Array.isArray(value?.peers) ? value.peers.filter(item => object(item) && allowed.includes(item.mac?.toLowerCase())).slice(0, 7).map(item => fields(item, ['mac', 'role', 'status', 'lastSeen'])) : [],
        events: live && Array.isArray(value?.events) ? value.events.filter(item => object(item) && allowed.includes(item.peer?.toLowerCase()) && item.peer?.toLowerCase() !== value.remote?.mac?.toLowerCase() && !value.peers?.some(p => p.role === 'remote' && p.mac?.toLowerCase() === item.peer.toLowerCase()) && validPayload(item.payload)).slice(-16).map(item => fields(item, ['peer', 'payload', 'receivedAt'])) : [] }
    } catch (error) {
      return failure(['runtime-stopped', 'frame-inactive', 'revision-changed', 'device-not-granted'].includes(error.message) ? error.message : operation === 'send' ? 'delivery-unknown' : 'device-unavailable')
    } finally { active-- }
  }
  function track(operation) { pending.add(operation); void operation.then(() => pending.delete(operation), () => pending.delete(operation)); return operation }
  return { read: identity => track(run(identity, 'read')), send: (identity, peer, payload) => track(run(identity, 'send', peer, payload)), async close() { stopped = true; await Promise.allSettled([...pending]) } }
}
module.exports = { parseDevices, parseDeviceGrants, loadDeviceGrants, loadDeviceGrantsSync, createUserAppDevices, isActiveDeviceFrame }
