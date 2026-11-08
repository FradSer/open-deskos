import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { isLocalAbsolutePath } from './personal-config.mjs'
import { checkProactivePath, createProactiveDirectory, readProactiveFile } from './proactive-private.mjs'

const worker = fileURLToPath(new URL('../mem0/worker.py', import.meta.url))
const defaultPython = fileURLToPath(new URL(process.platform === 'win32' ? '../mem0/.venv/Scripts/python.exe' : '../mem0/.venv/bin/python', import.meta.url))
const unavailable = () => Error('Mem0 memory is unavailable.')
export const memoryDigest = value => createHash('sha256').update(value).digest('hex')

export function privateMemoryDirectory(directory) {
  createProactiveDirectory(directory)
  const info = lstatSync(directory)
  if (!info.isDirectory() || realpathSync(directory) !== directory || (process.platform !== 'win32'
    && (info.uid !== process.getuid?.() || info.mode & 0o077))) throw unavailable()
  checkProactivePath(directory)
}

/** The worker and its tools are host-only. It uses the original SDK for every memory operation. */
export function createMem0Backend({ stateDir, env = process.env }) {
  let connection, opening, closed = false
  const enabled = env.ODK_PERSONAL_AGENT_MEM0_CONFIG !== undefined
  const lifetime = new AbortController()

  async function execute(client, name, args, signal, timeout = 30000) {
    signal?.throwIfAborted()
    const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout })
    if (result.isError || !result.structuredContent) throw unavailable()
    return result.structuredContent
  }

  async function connect() {
    if (closed || !enabled) throw unavailable()
    if (connection) return connection
    if (opening) return opening
    const attempt = (async () => {
      const config = JSON.parse(readProactiveFile(env.ODK_PERSONAL_AGENT_MEM0_CONFIG, 32768))
      const python = env.ODK_PERSONAL_AGENT_MEM0_PYTHON ?? defaultPython
      if (!isLocalAbsolutePath(python)) throw unavailable()
      const cwd = join(stateDir, 'personal-agent', 'mem0')
      privateMemoryDirectory(cwd)
      const transport = new StdioClientTransport({ command: python, args: [worker], cwd, stderr: 'ignore', maxBufferSize: 4 * 1024 * 1024 })
      const client = new Client({ name: 'odk-personal-agent-memory', version: '1.0.0' })
      client.onerror = () => {}
      client.onclose = () => { if (connection === client) connection = undefined }
      try {
        await client.connect(transport, { signal: lifetime.signal, timeout: 30000 })
        const ready = await execute(client, 'configure', { config }, lifetime.signal, 60000)
        if (ready.ready !== true || closed) throw unavailable()
        connection = client
        return client
      } catch {
        await client.close().catch(() => {})
        throw unavailable()
      }
    })()
    opening = attempt
    try { return await attempt } finally { if (opening === attempt) opening = undefined }
  }

  async function call(name, args, signal, timeout) {
    const cancellation = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    try {
      cancellation.throwIfAborted()
      const client = await connect()
      return await execute(client, name, args, cancellation, timeout)
    } catch {
      cancellation.throwIfAborted()
      throw unavailable()
    }
  }

  return {
    enabled,
    warm: connect,
    scope(owner, kind) {
      const scope = { user_id: 'odk-' + memoryDigest(owner), agent_id: 'odk-' + kind }
      function items(value, limit) {
        if (!Array.isArray(value.results) || value.results.length > limit
          || value.results.some(item => !item || item.user_id !== scope.user_id || item.agent_id !== scope.agent_id
            || typeof item.id !== 'string' || typeof item.memory !== 'string')) throw unavailable()
        return value.results
      }
      return {
        async list(filters = {}, limit = 513, signal = undefined) {
          return items(await call('list_memories', { filters: { ...filters, ...scope }, limit }, signal), limit)
        },
        async search(query, { filters = {}, limit = 32, signal = undefined } = {}) {
          return items(await call('search_memories', { query, filters: { ...filters, ...scope }, limit }, signal, 10000), limit)
        },
        async put(key, text, metadata = {}, { replace = true, signal = undefined } = {}) {
          const result = await call('put', { scope, key, text, metadata, replace }, signal)
          if (typeof result.id !== 'string' || typeof result.created !== 'boolean') throw unavailable()
          return { id: result.id, created: result.created }
        },
        async remove(key, signal = undefined) {
          await call('remove', { scope, key }, signal)
        },
        async updateMetadata(id, metadata, signal = undefined) {
          const result = await call('update_metadata', { scope, memory_id: id, metadata }, signal)
          if (result.updated !== true) throw unavailable()
        },
        async ingest(key, messages, metadata, prompt, signal = undefined) {
          const result = await call('ingest', { scope, key, messages, metadata, prompt }, signal, 120000)
          if (!Array.isArray(result.results)) throw unavailable()
          return result.results
        },
      }
    },
    async close() {
      closed = true
      lifetime.abort()
      await opening?.catch(() => {})
      await connection?.close()
    },
  }
}
