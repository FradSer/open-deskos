'use strict'

const { EventEmitter } = require('node:events')

class RemoteLinkAdapter extends EventEmitter {
  async start() {
    throw new Error('RemoteLinkAdapter.start must be implemented')
  }

  async stop() {
    throw new Error('RemoteLinkAdapter.stop must be implemented')
  }

  async send(_record) {
    throw new Error('RemoteLinkAdapter.send must be implemented')
  }
}

module.exports = { RemoteLinkAdapter }
