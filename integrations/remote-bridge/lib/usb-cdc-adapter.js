'use strict'

const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { createJsonLineReader } = require('./json-line-reader')
const { parseJsonLine, encodeJsonLine } = require('./protocol')
const { RemoteLinkAdapter } = require('./remote-link-adapter')

const DEFAULT_SERIAL_DIRECTORY = '/dev/serial/by-id'
const DEFAULT_SCAN_INTERVAL_MS = 1_000
const REMOTE_DEVICE_NAME = 'open-deskos-remote'
const REMOTE_SERIAL_JTAG_NAME = 'espressifusbjtagserialdebugunit'

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
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.includes('opendeskosremote') || normalized.includes(REMOTE_SERIAL_JTAG_NAME)
}

class CdcConnection extends EventEmitter {
  constructor(devicePath, {
    io = fs,
    fd = io.openSync(devicePath, io.constants.O_RDWR | io.constants.O_NOCTTY | io.constants.O_NONBLOCK),
    pollIntervalMs = 10,
    closeTimeoutMs = 100,
  } = {}) {
    super()
    this.devicePath = devicePath
    this.io = io
    this.fd = fd
    this.pollIntervalMs = pollIntervalMs
    this.closeTimeoutMs = closeTimeoutMs
    this.closed = false
    this.closing = null
    this.pollTimer = null
    this.readPending = false
    this.writeQueue = Promise.resolve()
    this.reader = createJsonLineReader((line) => this.#receive(line))
    this.buffer = Buffer.allocUnsafe(512)
    this.#scheduleRead(0)
  }

  send(record) {
    if (this.closed) return Promise.reject(new Error('USB CDC Remote Control is disconnected'))
    const data = Buffer.from(encodeJsonLine(record))
    const operation = this.writeQueue.then(() => this.#writeAll(data))
    this.writeQueue = operation.catch(() => {})
    return operation
  }

  close() {
    if (this.closing) return this.closing
    this.closed = true
    clearTimeout(this.pollTimer)
    this.pollTimer = null
    this.closing = this.readPending
      ? Promise.race([
        new Promise((resolve) => this.once('read-idle', resolve)),
        new Promise((resolve) => setTimeout(resolve, this.closeTimeoutMs)),
      ]).then(() => this.#closeFd())
      : this.#closeFd()
    return this.closing
  }

  #scheduleRead(delay = this.pollIntervalMs) {
    if (this.closed) return
    this.pollTimer = setTimeout(() => this.#readOnce(), delay)
    this.pollTimer.unref?.()
  }

  #readOnce() {
    if (this.closed || this.readPending) return
    this.readPending = true
    this.io.read(this.fd, this.buffer, 0, this.buffer.length, null, (error, bytesRead) => {
      this.readPending = false
      this.emit('read-idle')
      if (this.closed) return
      if (error) {
        if (isRetryable(error)) return this.#scheduleRead()
        this.#end('read-failed')
        return
      }
      if (bytesRead > 0) this.reader.push(this.buffer.subarray(0, bytesRead))
      this.#scheduleRead(bytesRead > 0 ? 0 : undefined)
    })
  }

  #writeAll(data, offset = 0) {
    if (this.closed) return Promise.reject(new Error('USB CDC Remote Control is disconnected'))
    return new Promise((resolve, reject) => {
      this.io.write(this.fd, data, offset, data.length - offset, null, (error, written) => {
        if (error && isRetryable(error)) {
          setTimeout(() => this.#writeAll(data, offset).then(resolve, reject), this.pollIntervalMs).unref?.()
          return
        }
        if (error) return reject(error)
        if (offset + written < data.length) return this.#writeAll(data, offset + written).then(resolve, reject)
        resolve()
      })
    })
  }

  #closeFd() {
    return new Promise((resolve) => {
      this.io.close(this.fd, () => resolve())
    })
  }

  #receive(line) {
    const parsed = parseJsonLine(line)
    if (parsed.ok) this.emit('message', parsed.record)
  }

  #end(reason) {
    if (this.closed) return
    void this.close().then(() => this.emit('disconnect', reason))
  }
}

function isRetryable(error) {
  return error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK'
}

async function createCdcConnection(devicePath) {
  try {
    const { execFileSync } = require('node:child_process')
    execFileSync('stty', ['-F', devicePath, 'raw', '-echo', 'min', '0', 'time', '0'], { stdio: 'ignore' })
  } catch {
    // Non-fatal if stty is unavailable or devicePath is mock/test path
  }
  return new CdcConnection(devicePath)
}

module.exports = {
  CdcConnection,
  DEFAULT_SERIAL_DIRECTORY,
  REMOTE_DEVICE_NAME,
  REMOTE_SERIAL_JTAG_NAME,
  UsbCdcAdapter,
  createCdcConnection,
  discoverUsbCdcDevice,
  isOpenDeskOsRemoteDevice,
}
