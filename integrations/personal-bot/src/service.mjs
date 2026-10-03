import { AudioLimitError } from './errors.mjs'

function boundedText(text, limit, label) {
  const notice = `\n\n[${label} truncated]`
  return text.length <= limit ? text : text.slice(0, limit - notice.length) + notice
}

/** @typedef {{stop: () => Promise<string>, cleanup: () => Promise<void>, done: Promise<void>}} Recording */
/** @typedef {{record: (onLevel: (level: number) => void) => Promise<Recording>, transcribe: (path: string, signal: AbortSignal) => Promise<string>, prompt: (text: string, onResponseSnapshot: (snapshot: string) => void) => Promise<string | void>, failureMessage?: string}} Dependencies */

export class PersonalBotService {
  /** @param {Dependencies} dependencies */
  constructor(dependencies) {
    this.dependencies = dependencies
    this.status = { v: 1, type: 'status', state: 'idle', message: '', transcript: '', level: 0 }
    this.listeners = new Set()
    this.closed = false
    this.starting = false
    this.controller = new AbortController()
    /** @type {Recording | undefined} */
    this.recording = undefined
    this.captureId = 0
    this.closing = undefined
    this.pending = Promise.resolve()
    this.cancelStreaming = () => {}
    this.proposalFrame = { proposals: [], proposalPopup: false }
    this.watch = undefined
    this.notification = ''
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachWatch(watch) { this.watch = watch }

  servicePush(readingIds) {
    if (this.closed || !this.watch) return false
    return this.watch.push(readingIds)
  }

  propose({ proposals, popup, interaction, hiddenCount, error }) {
    this.proposalFrame = { proposals, proposalPopup: false, proposalHiddenCount: hiddenCount ?? 0, ...(error ? { proposalError: error } : {}) }
    const frame = { ...this.status, ...this.proposalFrame, message: boundedText(this.status.message, proposals.length ? 8192 : 16384, 'Response'), proposalPopup: popup, proposalInteraction: interaction === true, ...(error ? { proposalError: error } : {}) }
    this.status = { ...frame, proposalPopup: false, proposalInteraction: false }
    for (const listener of this.listeners) listener(frame)
  }

  async proposalCommand(command) {
    if (!this.watch || this.closed) throw Error('Suggestions unavailable')
    if (command.type === 'proposal_presented') { await this.watch.presented(command.ids); return }
    if (command.type === 'proposal_list') { this.watch.interact(true); return }
    if (this.starting || !['idle', 'error'].includes(this.status.state)) throw Error('Personal Bot turn is in progress')
    await this.watch.respond(command.id, command.decision, command.confirmation ?? '')
  }

  notify(message) {
    if (this.closed) return
    this.notification = boundedText(message, 4096, 'Ride update')
    if (!this.starting && ['idle', 'error'].includes(this.status.state)) this.setState(this.status.state, this.status.message)
  }

  setState(state, message = '', transcript = this.status.transcript) {
    if (!this.closed && ['idle', 'error'].includes(state) && this.notification) {
      message = [message, this.notification].filter(Boolean).join('\n\n')
      this.notification = ''
    }
    this.status = {
      ...this.proposalFrame, v: 1, type: 'status', state, level: 0,
      message: boundedText(message, this.proposalFrame.proposals.length ? 8192 : 16384, 'Response'),
      transcript: boundedText(transcript, 4096, 'Transcript'),
    }
    for (const listener of this.listeners) listener(this.status)
  }

  async toggle() {
    if (this.closed || this.starting || this.watch?.responding) return
    if (this.status.state === 'recording') return this.finish()
    if (!['idle', 'error'].includes(this.status.state)) return
    this.starting = true
    this.watch?.setBusy(true)
    this.pending = this.start()
    await this.pending
  }

  async start() {
    this.status = { ...this.status, message: '', transcript: '' }
    try {
      const captureId = ++this.captureId
      this.recording = await this.dependencies.record(level => {
        if (this.closed || captureId !== this.captureId || this.status.state !== 'recording') return
        this.status = { ...this.status, level }
        for (const listener of this.listeners) listener(this.status)
      })
      if (this.closed) { await this.discard(); return }
      this.setState('recording')
      void this.recording.done.then(() => this.finish(), () => {
        if (!this.closed && this.status.state === 'recording') this.pending = this.failCapture()
      })
    } catch {
      if (!this.closed) this.setState('error', 'Microphone unavailable')
    } finally {
      this.starting = false
      this.watch?.setBusy(!['idle', 'error'].includes(this.status.state))
    }
  }

  async failCapture() {
    if (this.status.state !== 'recording' || this.closed) return
    this.setState('transcribing')
    await this.discard()
    if (!this.closed) this.setState('error', 'Microphone unavailable')
  }

  finish() {
    if (this.closed || this.status.state !== 'recording') return this.pending
    this.setState('transcribing')
    this.pending = this.submit()
    return this.pending
  }

  async submit() {
    let failure = ''
    let response = ''
    const recording = this.recording
    try {
      if (!recording) return
      const path = await recording.stop()
      if (this.closed) return
      const text = await this.dependencies.transcribe(path, this.controller.signal)
      if (!this.closed) {
        this.setState('thinking', '', text)
        response = await this.promptResponse(text)
      }
    } catch (error) {
      failure = error instanceof AudioLimitError
        ? `Recording exceeds the ${error.limit.toLocaleString('en-US')}-byte upload limit; record a shorter request`
        : this.dependencies.failureMessage || 'Personal Bot request failed; try again'
    } finally {
      if (!await this.discard()) failure = this.dependencies.failureMessage || 'Personal Bot request failed; try again'
      if (!this.closed) {
        this.setState(failure ? 'error' : 'idle', failure || response)
        if (!failure) this.watch?.interact()
      }
    }
  }

  async promptResponse(text) {
    let active = true
    let latest = ''
    let timer
    const stop = () => { active = false; clearTimeout(timer); timer = undefined }
    this.cancelStreaming = stop
    try {
      return await this.dependencies.prompt(text, snapshot => {
        if (!active || this.closed) return
        latest = boundedText(snapshot, 16_384, 'Response')
        if (timer || latest === this.status.message) return
        timer = setTimeout(() => {
          timer = undefined
          if (active && !this.closed && latest !== this.status.message) this.setState('thinking', latest)
        }, 100)
      }) || ''
    } finally {
      stop()
      this.cancelStreaming = () => {}
    }
  }

  async discard() {
    const recording = this.recording
    this.recording = undefined
    try {
      await recording?.cleanup()
      return true
    } catch {
      return false
    }
  }

  close() {
    this.closing ??= this.shutdown()
    return this.closing
  }

  async shutdown() {
    this.closed = true
    this.controller.abort()
    this.cancelStreaming()
    this.setState('idle', '', '')
    await this.discard()
    await this.pending
  }
}
