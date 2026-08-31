'use strict'

const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { createJsonLineReader } = require('./json-line-reader')
const { parseJsonLine, encodeJsonLine, validateNavigate } = require('./protocol')
const { RemoteLinkAdapter } = require('./remote-link-adapter')

const DEFAULT_SERIAL_DIRECTORY = '/dev/serial/by-id'
const DEFAULT_SCAN_INTERVAL_MS = 1_000
const REMOTE_DEVICE_NAME = 'open-deskos-remote'

class UsbCdcAdapter extends RemoteLinkAdapter {
  constructor({
    serialDirectory = DEFAULT_SERIAL_DIRECTORY,
    scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS,
    discoverDevice = discoverUsbCdcDevice,
    createConnection = createCdcConnection,
  } = {}) {
    super()
    this.serialDirectory = serialDirectory
    this.scanIntervalMs = scanIntervalMs
    this.discoverDevice = discoverDevice
    this.createConnection = createConnection
    this.connection = null
    this.disconnectedReason = null
    this.running = false
    this.scanTimer = null
    this.scanning = null
  }

  get isConnected() {
    return this.connection !== null
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.scan()
    this.scanTimer = setInterval(() => {
      void this.scan().catch((error) => this.emit('adapter-error', error))
    }, this.scanIntervalMs)
  }

  async stop() {
    this.running = false
    clearInterval(this.scanTimer)
    this.scanTimer = null
    const connection = this.connection
    this.connection = null
    if (connection) await connection.close()
  }

  async send(record) {
    if (!this.connection) throw new Error('USB CDC Remote Control is disconnected')
    await this.connection.send(record)
  }

  async scan() {
    if (!this.running) return
    if (this.scanning) return this.scanning
    this.scanning = this.#scan().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  async #scan() {
    const discovery = await this.discoverDevice(this.serialDirectory)
    if (!this.running) return
    if (!discovery.devicePath) {
      await this.#disconnect(discovery.reason)
      return
    }
    if (this.connection?.devicePath === discovery.devicePath) return

    await this.#disconnect('device-replaced')
    try {
      const connection = await this.createConnection(discovery.devicePath)
      if (!this.running) {
        await connection.close()
        return
      }
      this.connection = connection
      this.disconnectedReason = null
      connection.on('message', (record) => this.emit('message', record))
      connection.once('disconnect', (reason) => {
        if (this.connection !== connection) return
        this.connection = null
        this.disconnectedReason = reason
        this.emit('disconnected', { transport: 'usb-cdc', reason })
      })
      this.emit('connected', { transport: 'usb-cdc', devicePath: discovery.devicePath })
    } catch (error) {
      this.emit('disconnected', { transport: 'usb-cdc', reason: 'connect-failed' })
      this.emit('adapter-error', error)
    }
  }

  async #disconnect(reason) {
    const connection = this.connection
    if (connection) {
      this.connection = null
      await connection.close()
    } else if (this.disconnectedReason === reason) {
      return
    }
    this.disconnectedReason = reason
    this.emit('disconnected', { transport: 'usb-cdc', reason })
  }
}

async function discoverUsbCdcDevice(serialDirectory = DEFAULT_SERIAL_DIRECTORY) {
  let names
  try {
    names = await fs.promises.readdir(serialDirectory)
  } catch (error) {
    if (error.code === 'ENOENT') return { reason: 'serial-directory-unavailable' }
    throw error
  }
  const matches = names
    .filter(isOpenDeskOsRemoteDevice)
    .map((name) => path.join(serialDirectory, name))
  if (matches.length === 1) return { devicePath: matches[0] }
  return { reason: matches.length === 0 ? 'device-not-found' : 'ambiguous-device' }
}

function isOpenDeskOsRemoteDevice(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').includes('opendeskosremote')
}

class CdcConnection extends EventEmitter {
  constructor(devicePath) {
    super()
    this.devicePath = devicePath
    this.closed = false
    this.input = fs.createReadStream(devicePath, { autoClose: true })
    this.output = fs.createWriteStream(devicePath, { autoClose: true })
    const reader = createJsonLineReader((line) => this.#receive(line))
    this.input.on('data', (chunk) => reader.push(chunk))
    this.input.once('end', () => {
      reader.end()
      this.#end('read-ended')
    })
    this.input.once('error', () => this.#end('read-failed'))
    this.output.once('error', () => this.#end('write-failed'))
  }

  send(record) {
    if (this.closed) return Promise.reject(new Error('USB CDC Remote Control is disconnected'))
    return new Promise((resolve, reject) => {
      this.output.write(encodeJsonLine(record), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.input.destroy()
    this.output.destroy()
  }

  #receive(line) {
    const parsed = parseJsonLine(line)
    if (parsed.ok && validateNavigate(parsed.record).ok) this.emit('message', parsed.record)
  }

  #end(reason) {
    if (this.closed) return
    this.closed = true
    this.input.destroy()
    this.output.destroy()
    this.emit('disconnect', reason)
  }
}

async function createCdcConnection(devicePath) {
  return new CdcConnection(devicePath)
}

module.exports = {
  CdcConnection,
  DEFAULT_SERIAL_DIRECTORY,
  REMOTE_DEVICE_NAME,
  UsbCdcAdapter,
  createCdcConnection,
  discoverUsbCdcDevice,
  isOpenDeskOsRemoteDevice,
}
