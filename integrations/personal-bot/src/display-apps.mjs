import { randomUUID, createHash } from 'node:crypto'
import { mkdir, lstat, realpath, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { hostname } from 'node:os'
import { loadShellModule } from './plugin-composition.mjs'
import { userAppsRequest } from './apps-control.mjs'
import { createWindowsPrivatePaths } from './proactive-private-windows.mjs'

const { readBoundedFile, writeExclusive } = loadShellModule('user-app-files.js', import.meta.url)
export const APPS_FRAME_BYTES = 600 * 1024
const commands = new Set(['list', 'desktop', 'install', 'place', 'rollback', 'remove'])
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key))
const appId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
const digestOf = (manifest, html) => createHash('sha256').update(manifest).update(html).digest('hex')

export function validDisplayHost(host) {
  return keys(host, ['name', 'platform']) && typeof host.name === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(host.name) && host.platform === 'win32'
}

function validParams(command, params) {
  return commands.has(command) && keys(params, ['appId', 'placement', 'bundle'])
    && (['list', 'desktop'].includes(command) ? Object.keys(params).length === 0 : appId(params.appId))
    && (params.placement === undefined || ['install', 'place'].includes(command))
    && (params.bundle === undefined || command === 'install')
}

/** One authenticated connection owns every request and receipt in this broker. */
export function createDisplayAppsBroker({ send, timeoutMs = 35000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 35000) throw Error('Invalid application deadline')
  const pending = new Map()
  let binding, closed = false
  function finish(id, error, result) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id); clearTimeout(entry.timer)
    entry.signal?.removeEventListener('abort', entry.abort)
    error ? entry.reject(error) : entry.resolve(result)
  }
  return {
    get binding() { return binding },
    async handle(frame) {
      if (frame.type === 'host_apps_hello') {
        if (closed || binding || !keys(frame, ['v', 'type', 'host']) || !validDisplayHost(frame.host)) throw Error('Invalid display registration')
        const host = Object.freeze({ ...frame.host })
        binding = Object.freeze({ host, request(command, params = {}, signal = undefined) {
          if (closed) return Promise.reject(Error('Originating display unavailable; application outcome unknown, do not retry'))
          if (!validParams(command, params) || pending.size >= 8) return Promise.reject(Error('Invalid display application request'))
          if (signal?.aborted) return Promise.reject(Error('Application request aborted'))
          const requestId = randomUUID()
          return new Promise((resolve, reject) => {
            const abort = () => finish(requestId, Error('Application outcome unknown; do not retry'))
            const timer = setTimeout(abort, timeoutMs); timer.unref?.()
            pending.set(requestId, { resolve, reject, timer, signal, abort })
            signal?.addEventListener('abort', abort, { once: true })
            void Promise.resolve().then(() => {
              if (pending.has(requestId) && !closed) return send({ v: 1, type: 'host_apps_request', requestId, command, params })
            })
              .catch(() => finish(requestId, Error('Application outcome unknown; do not retry')))
          })
        } })
        await send({ v: 1, type: 'host_apps_ready' })
        return true
      }
      if (frame.type !== 'host_apps_response') return false
      if (!binding || !keys(frame, ['v', 'type', 'requestId', 'result']) || !uuid(frame.requestId)
        || !object(frame.result) || typeof frame.result.ok !== 'boolean') throw Error('Invalid application receipt')
      // Unknown and late receipts cannot acquire authority over another request.
      finish(frame.requestId, frame.result.ok ? null : Error(frame.result.error || 'Display application request failed'),
        { ...frame.result, host: binding.host })
      return true
    },
    close() {
      closed = true
      for (const id of pending.keys()) finish(id, Error('Originating display unavailable; application outcome unknown, do not retry'))
    },
  }
}

/** Only the configured source workspace supplies package bytes, never a model-selected path. */
export async function originatingAppsRequest(binding, command, params, workspace) {
  if (!binding) return userAppsRequest(command, params)
  const { signal } = params
  const request = Object.fromEntries(Object.entries(params).filter(([key, value]) => key !== 'signal' && value !== undefined))
  if (command === 'install') {
    if (!appId(request.appId) || !isAbsolute(workspace ?? '')) throw Error('Application source workspace unavailable')
    const manifest = await readBoundedFile(workspace, `apps/${request.appId}/manifest.json`, 8192)
    const html = await readBoundedFile(workspace, `apps/${request.appId}/index.html`, 256 * 1024)
    if (JSON.parse(manifest.toString('utf8')).id !== request.appId) throw Error('Application draft identity mismatch')
    request.bundle = { manifest: manifest.toString('base64'), html: html.toString('base64'), digest: digestOf(manifest, html) }
  }
  return binding.request(command, request, signal)
}

/** The display calls only its authenticated local Shell. Its verifier owns publication. */
export function createDisplayApplications({ stateDir, env = process.env, request = userAppsRequest }) {
  let privatePaths
  async function secure(directory, created, container = false) {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw Error('Unsafe application import directory')
    if (process.platform === 'win32') {
      privatePaths ??= createWindowsPrivatePaths()
      privatePaths(container ? 'CheckContainer' : created ? 'Protect' : 'Check', directory, true)
    } else if (info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw Error('Unsafe application import directory')
  }
  return {
    host: { name: hostname(), platform: 'win32' },
    async request(command, params) {
      if (!validParams(command, params)) throw Error('Invalid display application request')
      if (command !== 'install') return request(command, { ...params, env })
      const bundle = params.bundle
      if (!keys(bundle, ['manifest', 'html', 'digest']) || typeof bundle.digest !== 'string'
        || !/^[a-f0-9]{64}$/.test(bundle.digest)) throw Error('Invalid application bundle')
      const decode = (text, max) => {
        if (typeof text !== 'string' || !text.length || text.length > 4 * Math.ceil(max / 3)) throw Error('Invalid application bundle')
        const bytes = Buffer.from(text, 'base64')
        if (bytes.length > max || bytes.toString('base64') !== text) throw Error('Invalid application bundle')
        return bytes
      }
      const manifest = decode(bundle.manifest, 8192), html = decode(bundle.html, 256 * 1024)
      if (digestOf(manifest, html) !== bundle.digest || JSON.parse(manifest.toString('utf8')).id !== params.appId) throw Error('Application bundle identity mismatch')
      const root = join(stateDir, 'application-imports')
      await secure(stateDir, false, true)
      let created = false
      try { await mkdir(root, { mode: 0o700 }); created = true } catch (error) { if (error.code !== 'EEXIST') throw error }
      await secure(root, created)
      const directory = await mkdtemp(join(root, 'package-'))
      try {
        await secure(directory, true)
        await writeExclusive(directory, 'manifest.json', manifest)
        await writeExclusive(directory, 'index.html', html)
        const result = await request('add', { sourcePath: directory, placement: params.placement, env })
        if (!result?.ok || result.app?.id !== params.appId || result.app?.revision !== bundle.digest.slice(0, 32)) throw Error('Application publication receipt mismatch; outcome unknown, do not retry')
        return result
      } finally { await rm(directory, { recursive: true, force: true }) }
    },
  }
}
