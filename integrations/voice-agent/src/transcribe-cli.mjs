// Transcribe one audio file with the desk's own configured provider.
//
// The voice service transcribes what its recorder captured, in a turn, on a
// running desk. This command is the same transcription contract for a file that
// already exists, so an operator can prove a provider endpoint, a model and a
// credential on a host without a microphone, a Shell or a Pi run — and see what
// that provider actually returned for that audio.
//
//   node src/transcribe-cli.mjs capture.wav
//   node src/transcribe-cli.mjs --url https://.../multimodal-generation/generation capture.wav
//
// It prints the normalized transcript and nothing else: no credential, no
// provider response body, and no invented text when a provider fails. A file that
// does not exist, an unreadable credential or a provider error is one line of
// reason on standard error and a non-zero exit.

import process from 'node:process'
import { transcribe, transcriptionProvider, transcriptionLanguage, transcriptionPrompt } from './transcribe.mjs'

/**
 * The transcription configuration this command uses, from the same environment
 * the service reads. The endpoint is never guessed here: a host that has not
 * declared one is told to declare one, because the two defaults the service
 * itself resolves belong to the service's own startup.
 *
 * @param {string[]} [argv] Arguments without the node executable and script.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ path: string, config: import('./transcribe.mjs').TranscriptionConfig }}
 */
export function transcriptionRequest(argv = [], env = process.env) {
  let url = env.ODESK_VOICE_STT_URL
  const files = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--url') {
      const value = argv[index + 1]
      if (value === undefined) throw Error('An endpoint URL is required after --url')
      url = value
      index += 1
      continue
    }
    if (argument.startsWith('--')) throw Error('Unknown option')
    files.push(argument)
  }
  if (files.length !== 1) throw Error('Exactly one audio file is required')
  if (!url) throw Error('Set ODESK_VOICE_STT_URL or pass --url with the endpoint')
  const provider = transcriptionProvider(env.ODESK_VOICE_STT_PROVIDER)
  return {
    path: files[0],
    config: {
      url,
      provider,
      model: env.ODESK_VOICE_STT_MODEL || (provider === 'aliyun' ? 'qwen3-asr-flash' : 'whisper-1'),
      keyFile: env.ODESK_VOICE_STT_KEY_FILE,
      language: transcriptionLanguage(env.ODESK_VOICE_STT_LANGUAGE),
      prompt: transcriptionPrompt(env.ODESK_VOICE_STT_PROMPT),
    },
  }
}

async function main() {
  const { path, config } = transcriptionRequest(process.argv.slice(2))
  process.stdout.write(`${await transcribe(path, config)}\n`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    console.error(error?.message || 'Transcription failed')
    process.exitCode = 1
  })
}
