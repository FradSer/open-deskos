/** @typedef {{stop: () => Promise<string>, cleanup: () => Promise<void>, done: Promise<void>}} Recording */
/** @typedef {{record: () => Promise<Recording>, transcribe: (path: string, signal: AbortSignal) => Promise<string>, prompt: (text: string) => Promise<string | void>, maxRecordingMs?: number}} Dependencies */

export class VoiceService {
  /** @param {Dependencies} dependencies */
  constructor(dependencies) {
    this.dependencies = dependencies
    this.status = { v: 1, type: 'status', state: 'idle', message: '' }
    this.listeners = new Set()
    this.closed = false
    this.starting = false
    this.controller = new AbortController()
    /** @type {Recording | undefined} */
    this.recording = undefined
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined
    this.pending = Promise.resolve()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setState(state, message = '') {
    this.status = { v: 1, type: 'status', state, message }
    for (const listener of this.listeners) listener(this.status)
  }

  async toggle() {
    if (this.closed || this.starting) return
    if (this.status.state === 'recording') return this.finish()
    if (!['idle', 'error'].includes(this.status.state)) return
    this.starting = true
    this.pending = this.start()
    await this.pending
  }

  async start() {
    try {
      this.recording = await this.dependencies.record()
      if (this.closed) { await this.discard(); return }
      this.setState('recording')
      this.timer = setTimeout(() => { void this.finish() }, this.dependencies.maxRecordingMs ?? 30_000)
      void this.recording.done.then(() => this.finish(), () => this.failCapture())
    } catch {
      this.setState('error', 'Microphone unavailable')
    } finally {
      this.starting = false
    }
  }

  async failCapture() {
    if (this.status.state !== 'recording' || this.closed) return
    this.setState('transcribing')
    await this.discard()
    this.setState('error', 'Microphone unavailable')
  }

  finish() {
    if (this.closed || this.status.state !== 'recording') return this.pending
    this.setState('transcribing')
    clearTimeout(this.timer)
    this.pending = this.submit()
    return this.pending
  }

  async submit() {
    let failed = false
    let response = ''
    const recording = this.recording
    try {
      if (!recording) return
      const path = await recording.stop()
      const text = await this.dependencies.transcribe(path, this.controller.signal)
      if (!this.closed) {
        this.setState('thinking')
        response = (await this.dependencies.prompt(text) || '').slice(0, 1024)
      }
    } catch {
      failed = true
    } finally {
      if (!await this.discard()) failed = true
      if (!this.closed) this.setState(failed ? 'error' : 'idle', failed ? 'Voice request failed; try again' : response)
    }
  }

  async discard() {
    clearTimeout(this.timer)
    const recording = this.recording
    this.recording = undefined
    try {
      await recording?.cleanup()
      return true
    } catch {
      return false
    }
  }

  async close() {
    this.closed = true
    this.controller.abort()
    await this.discard()
    await this.pending
  }
}
