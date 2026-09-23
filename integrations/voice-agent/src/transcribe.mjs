import { readFile, stat } from 'node:fs/promises'
import { Converter } from 'opencc-js/t2cn'
import { AudioLimitError } from './errors.mjs'

const simplify = Converter({ from: 't', to: 'cn' })
const defaultPrompt = '在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。'

/** @param {string} [prompt] */
export function transcriptionPrompt(prompt = defaultPrompt) {
  if (prompt.length > 1024) throw Error('Invalid transcription prompt')
  return prompt
}

/** @param {URL} url */
export function isLoopbackUrl(url) {
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === 'localhost.' || host === '[::1]') return true
  const octets = host.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) < 256)
}

/**
 * The device-local transcription contract: the whisper.cpp inference path on loopback, which ignores
 * a bearer and therefore needs no cloud credential. The provisioned bridge is plain HTTP; an https
 * loopback endpoint at the same path is treated identically because it is still the desk's own
 * service. Nothing outside that path and interface is device-local, so every other endpoint keeps
 * its credential and its cloud request fields.
 * @param {URL} url
 */
export function isDeviceLocalStt(url) {
  return ['http:', 'https:'].includes(url.protocol) && isLoopbackUrl(url) && url.pathname === '/inference'
}

/** @param {string} [language] */
export function transcriptionLanguage(language = 'zh') {
  if (language !== 'auto' && !/^[a-z]{2,3}$/.test(language)) {
    throw Error('Invalid transcription language')
  }
  return language
}

/** @param {string} [keyFile] */
async function credential(keyFile) {
  if (!keyFile) throw Error('Missing transcription credential')
  const key = (await readFile(keyFile, 'utf8')).trim()
  if (!key) throw Error('Missing transcription credential')
  return key
}

/** @param {Response} response */
async function readResponse(response) {
  let size = 0
  const chunks = []
  if (!response.body) throw Error('Missing response')
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 65_536) break
      chunks.push(chunk)
    }
  } catch {
    throw Error('Transcription failed')
  }
  if (size > 65_536) throw Error('Response too large')
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!result || typeof result !== 'object') throw Error('Invalid response')
    return result
  } catch {
    throw Error('Transcription failed')
  }
}

/** @param {string} path
 * @param {{url:string, model:string, keyFile?:string, language?:string, prompt?:string, maxAudioBytes?:number, timeoutMs?:number}} config
 * @param {AbortSignal} [signal]
 * @param {typeof fetch} [fetcher]
 */
export async function transcribe(path, config, signal, fetcher = fetch) {
  const language = transcriptionLanguage(config.language)
  const prompt = transcriptionPrompt(config.prompt)
  const url = new URL(config.url)
  const deviceLocal = isDeviceLocalStt(url)
  const limit = config.maxAudioBytes ?? 25_000_000
  if ((await stat(path)).size > limit) throw new AudioLimitError(limit)
  // A device-local endpoint ignores a bearer, so the desk does not need a credential to reach it.
  const headers = deviceLocal ? {} : { Authorization: `Bearer ${await credential(config.keyFile)}` }
  const form = new FormData()
  form.set('model', config.model)
  if (language !== 'auto' || deviceLocal) form.set('language', language)
  if (deviceLocal) form.set('translate', 'false')
  if (prompt) form.set('prompt', prompt)
  form.set('file', new Blob([await readFile(path)], { type: 'audio/wav' }), 'audio.wav')
  const deadline = AbortSignal.timeout(config.timeoutMs ?? 45_000)
  let response
  try {
    response = await fetcher(config.url, {
      method: 'POST', headers, body: form,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      redirect: 'error',
    })
  } catch {
    throw Error('Transcription failed')
  }
  if (!response.ok) {
    try {
      await response.body?.cancel()
    } finally {
      throw Error('Transcription failed')
    }
  }
  const result = await readResponse(response)
  if (typeof result.text !== 'string' || !result.text.trim()) throw Error('Empty transcript')
  return simplify(result.text.trim())
}
