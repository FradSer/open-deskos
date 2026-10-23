'use strict'

const https = require('node:https')
const dns = require('node:dns/promises')
const { isIP, BlockList } = require('node:net')

const MAX_BYTES = 64 * 1024
const ID = /^[a-z][a-z0-9-]{0,63}$/
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
const blocked = new BlockList()
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip, bits, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('3fff::', 20, 'ipv6')

function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('invalid-api-source')
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !host.includes('.') && !isIP(host) || /(^|\.)(localhost|local|internal|home|arpa)$/i.test(host)
    || isIP(host) && !isPublicAddress(host)) throw Error('invalid-api-source')
  return url
}

function parseApiSources(api) {
  if (api === undefined) return undefined
  if (!api || typeof api !== 'object' || Array.isArray(api) || Object.keys(api).length < 1 || Object.keys(api).length > 8) throw Error('invalid-api-sources')
  const parsed = {}
  for (const [id, source] of Object.entries(api)) {
    if (!ID.test(id) || forbidden.has(id) || !source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).some(key => !['url', 'refreshMs'].includes(key))
      || !Number.isInteger(source.refreshMs) || source.refreshMs < 10000 || source.refreshMs > 86400000) throw Error('invalid-api-source')
    try { publicUrl(source.url) } catch { throw Error('invalid-api-source') }
    parsed[id] = { url: source.url, refreshMs: source.refreshMs }
  }
  return parsed
}

// Resolve once, check every answer, and pin the connection to the checked address.
// Redirects, cookies, proxy configuration, and package-provided headers have no path here.
async function requestPublicJson(rawUrl, { signal, lookup = dns.lookup, get = https.get, accept = 'application/json' } = {}) {
  const url = publicUrl(rawUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true })
  if (signal?.aborted) throw Error('api-timeout')
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw Error('api-address-blocked')
  const selected = addresses[0]
  return new Promise((resolve, reject) => {
    const req = get(url, {
      agent: false, signal, family: selected.family, autoSelectFamily: false,
      lookup: (_hostname, _options, done) => done(null, selected.address, selected.family),
      headers: { Accept: accept, 'User-Agent': 'OpenDeskOS-PackageData/1' },
    }, response => {
      if (response.statusCode !== 200 || !/^application\/(?:(?:[\w.+-]+\+)?json|dns-json)(?:\s*;|$)/i.test(response.headers['content-type'] || '')) {
        response.destroy(); reject(Error('api-response-rejected')); return
      }
      let size = 0
      const chunks = []
      response.on('data', chunk => {
        size += chunk.length
        if (size > MAX_BYTES) { response.destroy(); reject(Error('api-response-too-large')); return }
        chunks.push(chunk)
      })
      response.on('error', () => reject(Error('api-unavailable')))
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!value || typeof value !== 'object') throw Error('invalid')
          resolve(value)
        } catch { reject(Error('api-invalid-json')) }
      })
    })
    req.on('error', () => reject(Error(signal?.aborted ? 'api-timeout' : 'api-unavailable')))
  })
}

// Owner configuration can select an HTTPS resolver when the LAN uses fake IPs.
// There is no automatic fallback after a blocked system DNS answer.
async function lookupPublicDns(host, { signal, request = requestPublicJson } = {}) {
  const result = await request(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, { signal, accept: 'application/dns-json' })
  if (result.Status !== 0 || result.TC === true || !Array.isArray(result.Answer)) throw Error('api-dns-unavailable')
  const addresses = result.Answer.filter(answer => answer.type === 1).map(answer => ({ address: answer.data, family: 4 }))
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw Error('api-address-blocked')
  return addresses
}

function createUserAppApi({ store, requestJson = requestPublicJson, now = Date.now, timeoutMs = 8000, publicDns = false } = {}) {
  let stopped = false
  const cache = new Map()
  const pending = new Set()
  const controllers = new Set()
  const failure = error => ({ ok: false, state: 'unavailable', error })
  const current = async (id, revision) => {
    const result = await store.getContent(id)
    return result.ok && result.app.revision === revision ? result.app : null
  }
  return {
    async read(appId, revision, sourceId) {
      if (stopped) return failure('runtime-stopped')
      if (!ID.test(appId) || !/^[a-f0-9]{32}$/.test(revision) || !ID.test(sourceId) || forbidden.has(sourceId)) return failure('invalid-api-request')
      const app = await current(appId, revision)
      if (stopped) return failure('runtime-stopped')
      if (!app) return failure('revision-changed')
      const sources = parseApiSources(app.api)
      if (!sources || !Object.hasOwn(sources, sourceId)) return failure('source-not-declared')
      const key = `${appId}:${revision}:${sourceId}`
      for (const old of cache.keys()) if (old.startsWith(`${appId}:`) && !old.startsWith(`${appId}:${revision}:`)) cache.delete(old)
      let entry = cache.get(key)
      if (!entry && cache.size >= 256) {
        const idle = [...cache].find(([, value]) => !value.pending)
        if (!idle) return failure('api-busy')
        cache.delete(idle[0])
      }
      if (!entry) { entry = { attemptedAt: -Infinity }; cache.set(key, entry) }
      if (entry.pending) return entry.pending
      if (entry.result && now() - entry.attemptedAt < sources[sourceId].refreshMs) return structuredClone(entry.result)
      entry.attemptedAt = now()
      const controller = new AbortController()
      controllers.add(controller)
      let timer
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('api-timeout')) }, timeoutMs) })
      const operation = (async () => {
        let result
        try {
          const data = await Promise.race([requestJson(sources[sourceId].url, { signal: controller.signal, ...(publicDns ? { lookup: host => lookupPublicDns(host, { signal: controller.signal }) } : {}) }), deadline])
          if (!data || typeof data !== 'object' || Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw Error('api-response-rejected')
          result = { ok: true, state: 'live', data, retrievedAt: now() }
        } catch (error) {
          const code = ['api-timeout','api-address-blocked','api-response-rejected','api-response-too-large','api-invalid-json'].includes(error.message) ? error.message : 'api-unavailable'
          result = entry.result?.data ? { ...entry.result, ok: false, state: 'stale', error: code } : failure(code)
        } finally { clearTimeout(timer); controllers.delete(controller) }
        if (stopped) return failure('runtime-stopped')
        if (!await current(appId, revision)) return failure('revision-changed')
        if (stopped) return failure('runtime-stopped')
        entry.result = result
        return structuredClone(result)
      })()
      entry.pending = operation
      pending.add(operation)
      try { return await operation } finally { entry.pending = null; pending.delete(operation) }
    },
    async close() {
      stopped = true
      for (const controller of controllers) controller.abort()
      await Promise.allSettled([...pending])
      cache.clear()
    },
  }
}

module.exports = { parseApiSources, isPublicAddress, requestPublicJson, lookupPublicDns, createUserAppApi }
