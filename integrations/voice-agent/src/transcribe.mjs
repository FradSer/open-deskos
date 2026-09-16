import { readFile, stat } from 'node:fs/promises'

/** @param {string} [language] */
export function transcriptionLanguage(language = 'zh') {
  if (language !== 'auto' && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
    throw Error('Invalid transcription language')
  }
  return language
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
 * @param {{url:string, model:string, keyFile:string, language?:string, maxAudioBytes?:number, timeoutMs?:number}} config
 * @param {AbortSignal} [signal]
 * @param {typeof fetch} [fetcher]
 */
export async function transcribe(path, config, signal, fetcher = fetch) {
  const language = transcriptionLanguage(config.language)
  if ((await stat(path)).size > (config.maxAudioBytes ?? 2_000_000)) throw Error('Audio too large')
  const key = (await readFile(config.keyFile, 'utf8')).trim()
  if (!key) throw Error('Missing transcription credential')
  const form = new FormData()
  form.set('model', config.model)
  if (language !== 'auto') form.set('language', language)
  form.set('file', new Blob([await readFile(path)], { type: 'audio/wav' }), 'audio.wav')
  const deadline = AbortSignal.timeout(config.timeoutMs ?? 45_000)
  let response
  try {
    response = await fetcher(config.url, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
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
  return result.text.trim()
}
