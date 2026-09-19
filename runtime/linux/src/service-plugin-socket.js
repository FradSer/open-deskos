'use strict'

const fs = require('node:fs')
const net = require('node:net')

const PROTO_VERSION = 1
const MAX_FRAME_BYTES = 64 * 1024

function frame(record) {
  return `${JSON.stringify(record)}\n`
}

function createServicePluginSocket({ socketPath, services = {}, onSnapshot = () => {}, onStatus = () => {} } = {}) {
  if (!socketPath) throw Error('socket-path-required')
  let server = null

  function send(socket, record) {
    try { socket.write(frame(record)) } catch {}
  }

  function handleRecord(socket, state, record) {
    if (!record || typeof record !== 'object' || record.v !== 1 || typeof record.type !== 'string') {
      send(socket, { v: 1, type: 'ack', ok: false, error: 'malformed-record' })
      return
    }
    if (record.type === 'hello') {
      const declared = services[record.service]
      if (!declared || (declared.revision !== undefined && declared.revision !== record.revision) || record.proto !== PROTO_VERSION) {
        send(socket, { v: 1, type: 'ack', ok: false, error: 'unknown-service' })
        socket.end()
        return
      }
      state.peer = { service: record.service, revision: record.revision }
      onStatus({ service: record.service, state: 'connected' })
      send(socket, { v: 1, type: 'ack', ok: true })
      return
    }
    if (!state.peer || record.service !== state.peer.service) {
      send(socket, { v: 1, type: 'ack', ok: false, error: 'not-identified' })
      return
    }
    if (record.type === 'data') {
      if (!record.snapshot || typeof record.snapshot !== 'object') {
        send(socket, { v: 1, type: 'ack', ok: false, error: 'malformed-record' })
        return
      }
      onSnapshot({ service: state.peer.service, revision: state.peer.revision, snapshot: record.snapshot, updatedAt: record.updatedAt ?? Date.now() })
      send(socket, { v: 1, type: 'ack', ok: true })
      return
    }
    if (record.type === 'error' || record.type === 'auth-required' || record.type === 'auth-state') {
      onSnapshot({ service: state.peer.service, revision: state.peer.revision, status: record.type, code: record.code, message: record.message, secrets: record.secrets, state: record.state, updatedAt: record.updatedAt ?? Date.now() })
      send(socket, { v: 1, type: 'ack', ok: true })
      return
    }
    send(socket, { v: 1, type: 'ack', ok: false, error: 'unknown-record' })
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        try {
          fs.mkdirSync(require('node:path').dirname(socketPath), { recursive: true })
          fs.rmSync(socketPath, { force: true })
        } catch {}
        server = net.createServer((socket) => {
          const state = { peer: null, buffer: '' }
          onStatus({ state: 'connection' })
          socket.on('data', (chunk) => {
            state.buffer += chunk.toString('utf8')
            if (Buffer.byteLength(state.buffer, 'utf8') > MAX_FRAME_BYTES * 4) {
              send(socket, { v: 1, type: 'ack', ok: false, error: 'frame-too-large' })
              socket.end()
              return
            }
            let index
            while ((index = state.buffer.indexOf('\n')) !== -1) {
              const line = state.buffer.slice(0, index)
              state.buffer = state.buffer.slice(index + 1)
              if (!line.trim()) continue
              if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
                send(socket, { v: 1, type: 'ack', ok: false, error: 'frame-too-large' })
                continue
              }
              let record
              try { record = JSON.parse(line) } catch {
                send(socket, { v: 1, type: 'ack', ok: false, error: 'malformed-record' })
                continue
              }
              handleRecord(socket, state, record)
            }
          })
          socket.on('close', () => {
            if (state.peer) onStatus({ service: state.peer.service, state: 'disconnected' })
          })
          socket.on('error', () => {})
        })
        server.on('error', reject)
        server.listen(socketPath, resolve)
      })
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve()
        server.close(() => {
          try { fs.rmSync(socketPath, { force: true }) } catch {}
          resolve()
        })
      })
    },
  }
}

module.exports = { createServicePluginSocket, PROTO_VERSION, MAX_FRAME_BYTES }
