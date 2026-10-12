'use strict'

const net = require('node:net')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const { requiresToken, writeHandshake } = require('./local-channel')

async function requestLocalControl({ endpoint, tokenFile, platform = process.platform, request, label, timeoutMs = 2000, maxResponseBytes = 256 * 1024 }) {
  if (!endpoint) throw Error(`${label} unavailable: no local channel`)
  const token = requiresToken({ endpoint, platform }) ? (await fs.readFile(tokenFile, 'utf8')).trim() : null
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    let pending = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(Error(`${label} timed out; operation outcome unknown`)), timeoutMs)
    socket.setEncoding('utf8')
    socket.on('error', error => finish(Error(`${label} failed: ${error.message}; operation outcome unknown`)))
    socket.on('end', () => finish(Error(`${label} closed without a response; operation outcome unknown`)))
    socket.on('close', () => finish(Error(`${label} connection closed; operation outcome unknown`)))
    socket.on('connect', () => {
      if (token !== null) writeHandshake(socket, token)
      socket.write(JSON.stringify({ ...request, v: 1, id }) + '\n')
    })
    socket.on('data', chunk => {
      pending += chunk
      if (Buffer.byteLength(pending) > maxResponseBytes) return finish(Error(`${label} response too large; operation outcome unknown`))
      if (!pending.includes('\n')) return
      let response
      try {
        response = JSON.parse(pending.trim())
        if (response?.v !== 1 || response.id !== id || typeof response.ok !== 'boolean') throw Error('invalid response envelope')
        if (!response.ok && (typeof response.error !== 'string' || !response.error.trim())) throw Error('invalid failure response')
      } catch {
        return finish(Error(`invalid ${label} response; operation outcome unknown`))
      }
      if (!response.ok) return finish(Error(response.error || `${label} failed`))
      finish(null, response)
    })
  })
}

module.exports = { requestLocalControl }
