import { readFile, stat } from 'node:fs/promises'

/** @param {Response} response */
async function readResponse(response) {
  let size = 0
  const chunks = []
  if (!response.body) throw Error('Missing response')
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 65_536) throw Error('Response too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** @param {string} path
 * @param {{url:string, model:string, keyFile:string, maxAudioBytes?:number, timeoutMs?:number}} config
 * @param {AbortSignal} [signal]
 * @param {typeof fetch} [fetcher]
 */
export async function transcribe(path, config, signal, fetcher = fetch) {
  if ((await stat(path)).size > (config.maxAudioBytes ?? 2_000_000)) throw Error('Audio too large')
  const key = (await readFile(config.keyFile, 'utf8')).trim()
  if (!key) throw Error('Missing transcription credential')
  const form = new FormData()
  form.set('model', config.model)
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
    await response.body?.cancel()
    throw Error('Transcription failed')
  }
  const result = await readResponse(response)
  if (typeof result.text !== 'string' || !result.text.trim()) throw Error('Empty transcript')
  return result.text.trim()
}
