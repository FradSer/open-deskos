'use strict'

const { EventEmitter } = require('node:events')

class MockTransport extends EventEmitter {
  constructor({ id, priority = 50, transport = 'mock' } = {}) {
    super()
    this.manifest = {
      schemaVersion: 1,
      id,
      kind: 'transport',
      provides: [{ interface: 'odk.transport.remote/v1' }],
    }
    this.priority = priority
    this.transport = transport
    this.started = false
    this.isConnected = false
    this.sent = []
  }

  async init() {}
  async start() { this.started = true }
  async stop() { this.started = false }
  async destroy() { this.started = false }
  async send(record) { this.sent.push(record) }
  health() { return { status: 'healthy', transport: this.transport } }
}

module.exports = { MockTransport }
