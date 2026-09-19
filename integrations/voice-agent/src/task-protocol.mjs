import { createConnection, createServer } from 'node:net'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { privateDirectory } from './task-store.mjs'

export const REQUEST_LIMIT = 64 * 1024
export const RESPONSE_LIMIT = 256 * 1024
export const REQUEST_TIMEOUT = 8000

/** Read exactly one JSONL frame. Kept for one-shot clients and stdin helpers. */
export function readFrame(stream, limit, timeout = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => finish(new Error('任务协议超时')), timeout)
    const cleanup = () => { clearTimeout(timer); stream.off('data', data); stream.off('end', end); stream.off('error', error); stream.off('close', end) }
    const finish = (failure, value = undefined) => { cleanup(); failure ? reject(failure) : resolve(value) }
    const error = failure => finish(failure)
    const end = () => finish(new Error('任务响应不完整'))
    const data = chunk => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)])
      if (buffer.length > limit) return finish(new Error('任务协议帧过大'))
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      if (buffer.subarray(newline + 1).toString().trim()) return finish(new Error('仅允许一条任务请求'))
      try { finish(null, JSON.parse(buffer.subarray(0, newline).toString('utf8'))) }
      catch { finish(new Error('任务 JSON 无效')) }
    }
    stream.on('data', data); stream.once('end', end); stream.once('close', end); stream.once('error', error)
  })
}
/** @param {string} socketPath @param {object} request @param {number} [timeout] */
export async function requestTask(socketPath, request, timeout = REQUEST_TIMEOUT) {
  const frame = `${JSON.stringify(request)}\n`
  if (Buffer.byteLength(frame) > REQUEST_LIMIT) throw new Error('任务请求过大')
  const socket = createConnection(socketPath)
  try {
    const response = readFrame(socket, RESPONSE_LIMIT, timeout)
    socket.once('connect', () => socket.write(frame))
    return await response
  } finally { socket.destroy() }
}
/** @param {string} socketPath */
async function clearStaleSocket(socketPath) {
  let info
  try { info = await lstat(socketPath) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!info.isSocket() || info.uid !== process.getuid?.()) throw new Error('任务套接字路径已占用')
  const live = await new Promise((resolve, reject) => {
    const probe = createConnection(socketPath)
    const timer = setTimeout(() => { probe.destroy(); reject(new Error('无法确定任务服务是否运行')) }, 1000)
    probe.once('connect', () => { clearTimeout(timer); probe.destroy(); resolve(true) })
    probe.once('error', error => { clearTimeout(timer); probe.destroy(); 'code' in error && error.code === 'ECONNREFUSED' ? resolve(false) : reject(error) })
  })
  if (live) throw new Error('任务服务已运行')
  await unlink(socketPath)
}

function lineReader(socket, onRecord, onFailure) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  socket.on('data', chunk => {
    pending += decoder.write(chunk)
    if (Buffer.byteLength(pending) > REQUEST_LIMIT) return onFailure(new Error('任务协议帧过大'))
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (!line) continue
      if (Buffer.byteLength(line) > REQUEST_LIMIT) return onFailure(new Error('任务协议帧过大'))
      try { onRecord(JSON.parse(line)) } catch { return onFailure(new Error('任务 JSON 无效')) }
    }
  })
  socket.once('end', () => {
    pending += decoder.end()
    if (pending.trim()) onFailure(new Error('任务响应不完整'))
  })
}

/** @param {string} socketPath @param {(request:{requestId?:string},context:{connectionId:string,send:(event:object)=>void})=>Promise<object>} handle @param {(connectionId:string)=>void|Promise<void>} [disconnect] */
export async function serveTasks(socketPath, handle, disconnect = () => {}) {
  await privateDirectory(dirname(socketPath))
  await clearStaleSocket(socketPath)
  const sockets = new Set()
  const server = createServer(socket => {
    const connectionId = randomUUID()
    let held = false
    let chain = Promise.resolve()
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket); void disconnect(connectionId) })
    socket.setTimeout(REQUEST_TIMEOUT, () => socket.destroy())
    const send = event => {
      const frame = `${JSON.stringify(event)}\n`
      if (Buffer.byteLength(frame) > RESPONSE_LIMIT) throw new Error('任务响应过大')
      if (socket.destroyed || socket.writableLength + Buffer.byteLength(frame) > RESPONSE_LIMIT) { socket.destroy(); return }
      socket.write(frame)
    }
    const fail = (_error = undefined) => socket.destroy()
    lineReader(socket, request => {
      chain = chain.then(async () => {
        /** @type {any} */
        const response = await handle(request, { connectionId, send })
        const frame = `${JSON.stringify(response)}\n`
        if (Buffer.byteLength(frame) > RESPONSE_LIMIT) throw new Error('任务响应过大')
        if (socket.destroyed) return
        if (request.command === 'attach' && response?.ok) {
          held = true
          socket.setTimeout(0)
          socket.write(frame)
          return
        }
        if (held) socket.write(frame)
        else socket.end(frame)
      }).catch(error => { fail(error) })
    }, fail)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.off('error', reject); resolve(undefined) }) })
  await chmod(socketPath, 0o600)
  return { async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined))) } }
}
