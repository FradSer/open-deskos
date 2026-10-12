'use strict'

const crypto = require('node:crypto')
const path = require('node:path')

const NATIVE_PLUGIN_SCHEME = 'odk-native-plugin'
const NATIVE_PLUGIN_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
const TYPES = new Map(Object.entries({ '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' }))

// URLs carry per-startup authority. Responses never read the revision directory.
function assetView(bundles, initialTotal, { live = false, parentOpen = () => true } = {}) {
  let total = initialTotal
  let closed = false
  const unavailable = () => closed || !parentOpen()
  return {
    hasEntries: () => !unavailable() && bundles.size > 0,
    fork({ live: follow = false } = {}) {
      if (unavailable()) throw Error('native Renderer assets are closed')
      // Live views follow publications and retirement, so their initial total
      // cannot describe a later independent snapshot's retained bytes.
      const retainedBytes = [...bundles.values()].reduce((sum, bundle) => sum + bundle.bytes, 0)
      return follow ? assetView(bundles, retainedBytes, { live: true, parentOpen: () => !unavailable() })
        : assetView(new Map(bundles), retainedBytes)
    },
    publish(plugin) {
      if (unavailable()) throw Error('native Renderer assets are closed')
      if (live) throw Error('native Renderer lease cannot publish')
      if (bundles.size >= 32) throw Error('native Renderer entry limit exceeded')
      const files = new Map()
      let bytes = 0
      for (const [name, content] of plugin.files) {
        if (name === 'manifest.json' || !TYPES.has(path.posix.extname(name))) continue
        files.set(name, Buffer.from(content))
        bytes += content.length
      }
      if (total + bytes > 64 * 1024 * 1024) throw Error('native Renderer asset memory limit exceeded')
      const relative = file => path.relative(plugin.root, file).split(path.sep).join('/')
      const entry = relative(plugin.entry)
      const css = plugin.css ? relative(plugin.css) : null
      if (!files.has(entry) || (css && !files.has(css))) throw Error('native Renderer entry or CSS is absent from signed assets')
      const token = crypto.randomBytes(16).toString('hex')
      const base = `${NATIVE_PLUGIN_SCHEME}://${token}/`
      bundles.set(token, { files, bytes, entryUrl: base + entry })
      total += bytes
      return { manifest: structuredClone(plugin.manifest), entryUrl: base + entry, ...(css ? { cssUrl: base + css } : {}) }
    },
    retire(entryUrl) {
      if (unavailable()) throw Error('native Renderer assets are closed')
      if (live) throw Error('native Renderer lease cannot retire')
      const token = typeof entryUrl === 'string' && entryUrl.match(/^odk-native-plugin:\/\/([a-f0-9]{32})\//)?.[1]
      const bundle = bundles.get(token)
      if (!bundle || bundle.entryUrl !== entryUrl) return false
      bundles.delete(token)
      total -= bundle.bytes
      return true
    },
    response(request) {
      if (unavailable()) return new Response(null, { status: 410 })
      if (request.method && !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
      const match = typeof request.url === 'string' && request.url.match(/^odk-native-plugin:\/\/([a-f0-9]{32})\/([a-zA-Z0-9_./-]+)$/)
      if (!match) return new Response(null, { status: 404 })
      const content = bundles.get(match[1])?.files.get(match[2])
      if (!content) return new Response(null, { status: 404 })
      return new Response(request.method === 'HEAD' ? null : Buffer.from(content), { headers: {
        'Content-Type': TYPES.get(path.posix.extname(match[2])), 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      } })
    },
    close() { closed = true; if (!live) bundles.clear(); total = 0 },
  }
}

function createNativeRendererAssets() { return assetView(new Map(), 0) }

module.exports = { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME, NATIVE_PLUGIN_PRIVILEGES }
