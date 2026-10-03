import { readFile, stat } from 'node:fs/promises'
import { Converter } from 'opencc-js/t2cn'
import { AudioLimitError } from './errors.mjs'

const simplify = Converter({ from: 't', to: 'cn' })
const defaultPrompt = '在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。'

/**
 * @typedef {object} TranscriptionConfig
 * @property {string} url The endpoint the declared provider expects.
 * @property {string} [provider] `openai` for the multipart upload, `aliyun` for the cloud JSON request.
 * @property {string} model The provider's own model name.
 * @property {string} [keyFile] Credential file; the `aliyun` provider reads its bearer from the environment instead.
 * @property {string} [language] A provider language code, or `auto` to ask the provider to identify it.
 * @property {string} [prompt] Transcription context; empty omits it.
 * @property {number} [maxAudioBytes] Upload bound, checked before the credential or the audio is read.
 * @property {number} [timeoutMs]
 */
// The one cloud request shape Aliyun/Qwen accepts on both dashscope.aliyuncs.com and the MaaS
// proxy: a multimodal generation call whose only user content is the recording. `/chat/completions`
// and a top-level `messages` field are rejected by those endpoints, so the model is declared by the
// desk and the audio is inlined as a WAV data URI because these endpoints do not read local paths.
const cloudModel = 'qwen3-asr-flash'
const cloudAudioUri = 'data:audio/wav;x-pcm-16bit;base64,'

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

/**
 * The declared transcription transport. `openai` is the multipart contract, `aliyun` the verified
 * cloud JSON contract; a desk without a local model declares `aliyun` explicitly rather than
 * letting the endpoint imply it. Anything else is refused before the recording or the credential
 * is touched, and the configured value never appears in the error.
 * @param {string} [provider]
 */
export function transcriptionProvider(provider = 'openai') {
  if (provider !== 'openai' && provider !== 'aliyun') throw Error('Invalid transcription provider')
  return provider
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

/** The cloud bearer comes from the environment, so a desk can transcribe without a credential file. */
function cloudCredential(environment) {
  const key = typeof environment.ALIYUNCS_TOKEN === 'string' ? environment.ALIYUNCS_TOKEN.trim() : ''
  if (!key) throw Error('Missing transcription credential')
  return key
}

/**
 * This transport sends the recorded audio and a bearer to a third party, so it applies the endpoint
 * rule Open DeskOS startup applies: no credentials in the URL, HTTPS, and plain HTTP only for a
 * declared loopback proxy.
 * @param {URL} url
 */
function checkEndpoint(url) {
  if (url.username || url.password) throw Error('Invalid transcription URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackUrl(url))) throw Error('Invalid transcription URL')
}

/** @param {string} path @param {number} [maxAudioBytes] */
async function assertRecordingSize(path, maxAudioBytes) {
  const limit = maxAudioBytes ?? 25_000_000
  if ((await stat(path)).size > limit) throw new AudioLimitError(limit)
}

/**
 * `enable_itn: false` is always sent: inverse text normalization would rewrite the digits inside
 * product vocabulary that the transcription context exists to protect. An explicit language is sent
 * as the provider language code; `auto` asks the provider to identify the language instead.
 * @param {string} model
 * @param {Buffer} audio
 * @param {string} language
 * @param {string} prompt
 */
function cloudRequest(model, audio, language, prompt) {
  const context = prompt ? [{ role: 'system', content: [{ text: prompt }] }] : []
  const speech = [{ role: 'user', content: [{ audio: `${cloudAudioUri}${audio.toString('base64')}` }] }]
  const asrOptions = language === 'auto' ? { enable_itn: false, enable_lid: true } : { enable_itn: false, language }
  return JSON.stringify({ model, input: { messages: [...context, ...speech] }, parameters: { result_format: 'message', asr_options: asrOptions } })
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

/**
 * One bounded POST for both transports: the deadline composes with the caller's signal, redirects
 * are refused, an error status cancels the body instead of reading it, and nothing from the request
 * or the provider reaches an error message.
 * @param {string} url
 * @param {{headers:Record<string,string>, body:FormData|string, timeoutMs?:number}} request
 * @param {typeof fetch} fetcher
 * @param {AbortSignal} [signal]
 */
async function sendRequest(url, request, fetcher, signal) {
  const deadline = AbortSignal.timeout(request.timeoutMs ?? 45_000)
  let response
  try {
    response = await fetcher(url, {
      method: 'POST', headers: request.headers, body: request.body,
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
  return response
}

/**
 * The cloud path answers every rejected request with one vocabulary, so an oversize, truncated or
 * unexpected provider payload cannot reach the display as a size or shape specific message. Only a
 * provider that returned a message with blank text reports an empty transcript.
 * @param {Response} response
 */
async function readTranscript(response) {
  let result
  try {
    result = await readResponse(response)
  } catch {
    throw Error('Transcription failed')
  }
  const text = result?.output?.choices?.[0]?.message?.content?.[0]?.text
  if (typeof text !== 'string') throw Error('Transcription failed')
  if (!text.trim()) throw Error('Empty transcript')
  return text.trim()
}

/** @param {string} path
 * @param {TranscriptionConfig} config
 * @param {AbortSignal} [signal]
 * @param {typeof fetch} [fetcher]
 * @param {NodeJS.ProcessEnv} [environment]
 */
export async function transcribe(path, config, signal, fetcher = fetch, environment = process.env) {
  const cloud = transcriptionProvider(config.provider) === 'aliyun'
  const language = transcriptionLanguage(config.language)
  const prompt = transcriptionPrompt(config.prompt)
  const url = new URL(config.url)
  if (cloud) checkEndpoint(url)
  await assertRecordingSize(path, config.maxAudioBytes)
  if (cloud) {
    // The credential is proven only after the recording is bounded, the audio is read only once
    // the credential exists, and a configured key file is never opened on this transport.
    const headers = { Authorization: `Bearer ${cloudCredential(environment)}`, 'Content-Type': 'application/json' }
    const body = cloudRequest(config.model || cloudModel, await readFile(path), language, prompt)
    return simplify(await readTranscript(await sendRequest(url.href, { headers, body, timeoutMs: config.timeoutMs }, fetcher, signal)))
  }
  const deviceLocal = isDeviceLocalStt(url)
  // A device-local endpoint ignores a bearer, so the desk does not need a credential to reach it.
  const headers = deviceLocal ? {} : { Authorization: `Bearer ${await credential(config.keyFile)}` }
  const form = new FormData()
  form.set('model', config.model)
  if (language !== 'auto' || deviceLocal) form.set('language', language)
  if (deviceLocal) form.set('translate', 'false')
  if (prompt) form.set('prompt', prompt)
  form.set('file', new Blob([await readFile(path)], { type: 'audio/wav' }), 'audio.wav')
  const result = await readResponse(await sendRequest(config.url, { headers, body: form, timeoutMs: config.timeoutMs }, fetcher, signal))
  if (typeof result.text !== 'string' || !result.text.trim()) throw Error('Empty transcript')
  return simplify(result.text.trim())
}
