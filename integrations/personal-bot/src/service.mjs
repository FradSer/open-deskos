import { AudioLimitError } from './errors.mjs'
import { randomUUID } from 'node:crypto'

const replyPersistenceFailure = 'Reply status could not be saved. Check its delivery receipt before sending again.'

function replyAcknowledgement(outcome, id) {
  if(outcome?.id===id && ['queued','failed'].includes(outcome.status) && outcome.receipt===undefined)return '这条指令未发送到原会话。'
  if(outcome?.id===id && outcome.status==='delivered' && outcome.receipt?.accepted===true) {
    if(outcome.receipt.delivery==='queued')return '指令已进入原会话队列，尚不代表任务完成。'
    if(outcome.receipt.delivery==='ran')return '原会话已受理指令并开始本轮处理，尚不代表任务完成。'
  }
  return '暂不能确认原会话是否收到指令。'
}

function boundedText(text, limit, label) {
  const notice = `\n\n[${label} truncated]`
  return text.length <= limit ? text : text.slice(0, limit - notice.length) + notice
}

/** @typedef {{stop: () => Promise<string>, cleanup: () => Promise<void>, done: Promise<void>}} Recording */
/** @typedef {{record: (onLevel: (level: number) => void) => Promise<Recording>, transcribe: (path: string, signal: AbortSignal) => Promise<string>, prompt: (text: string, onResponseSnapshot: (snapshot: string) => void, reply?: import('./session-replies.mjs').BoundSessionReply, owner?: import('./session-replies.mjs').OwnerTurn) => Promise<string | void>, failureMessage?: string, getJudgmentStatus?: () => {status: string, provider: string, model?: string} | undefined, checkJev?: (signal: AbortSignal) => Promise<{status: string, reason?: string}>}} Dependencies */

export class PersonalBotService {
  /** @param {Dependencies} dependencies */
  constructor(dependencies) {
    this.dependencies = dependencies
    this.status = { proposalCapabilities: { read: false, respond: false, acknowledge: false }, replyInput: true, textInput: true, v: 1, type: 'status', state: 'idle', message: '', transcript: '', level: 0 }
    this.listeners = new Set()
    this.closed = false
    this.terminated = false
    this.suspending = undefined
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
    this.home = undefined
    this.briefing = { state: 'unavailable', items: [], generatedAt: 0, omittedSources: 0 }
    this.pendingNotifications = []
    this.agentFrame = { state: 'unavailable', tasks: [] }
    if (dependencies.checkJev) {
      this.jev = { status: 'checking' }
      this.publishJev(this.jev)
      // One check per service instance. Client subscriptions and runtime resume do not repeat it.
      const signal = this.controller.signal
      this.jevCheck = Promise.resolve().then(() => {
        signal.throwIfAborted()
        return dependencies.checkJev(signal)
      }).then(jev => {
        if (!this.closed && !signal.aborted) this.publishJev(jev)
      }).catch(() => {
        if (!this.closed && !signal.aborted) this.publishJev({ status: 'unavailable' })
      })
    }
  }

  publishJev(jev) {
    this.jev = jev
    this.status = { ...this.status, jev }
    for (const listener of this.listeners) listener(this.status)
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachWatch(watch) {
    this.watch = watch
    this.status = { ...this.status, proposalCapabilities: { read: Boolean(watch), respond: Boolean(watch), acknowledge: Boolean(watch) } }
    for (const listener of this.listeners) listener(this.status)
  }

  attachHome(home) { this.home = home }

  attachRemoteUpdates(remote) {
    this.remoteUnsubscribe?.()
    this.remote = remote
    this.remoteRefreshQueued = Boolean(remote)
    this.publishRemote(remote?.snapshot() ?? { state: 'disabled', messages: [] })
    this.remoteUnsubscribe = remote?.subscribe?.(() => this.refreshRemote())
    this.drainRemote()
  }

  refreshRemote() {
    if(this.closed || !this.remote)return
    this.remoteRefreshQueued=true
    return this.drainRemote()
  }

  drainRemote() {
    if(this.closed || this.starting || !['idle','error'].includes(this.status.state) || !this.remoteRefreshQueued || !this.remote || this.remoteRefreshing)return this.remoteRefreshing
    const remote=this.remote
    this.remoteRefreshQueued=false
    const pending=Promise.resolve().then(()=>remote.drain?.()??remote.poll()).catch(()=>{}).finally(()=>{
      if(this.remoteRefreshing!==pending)return
      this.remoteRefreshing=undefined
      this.drainRemote()
    })
    this.remoteRefreshing=pending
    return pending
  }

  publishRemote(remote) {
    if (this.closed) return
    this.remoteFrame = structuredClone(remote)
    this.home?.invalidate()
    this.status = { ...this.status, ...this.replyFrame, remote: this.remoteFrame }
    for (const listener of this.listeners) listener(this.status)
  }

  publishAgents(tasks) {
    if (this.closed) return
    this.agentFrame = Array.isArray(tasks) ? { state: 'live', tasks: structuredClone(tasks) } : { state: 'unavailable', tasks: [] }
    this.home?.invalidate()
    this.status = { ...this.status, agents: this.agentFrame }
    for (const listener of this.listeners) listener(this.status)
  }

  publishBriefing(briefing) {
    if (this.closed) return
    this.briefing = briefing
    this.status = { ...this.status, briefing }
    for (const listener of this.listeners) listener(this.status)
  }

  servicePush(readingIds) {
    this.home?.invalidate()
    if (readingIds?.includes('odk.app.pi-sessions.completed')) this.refreshRemote()
    if (this.closed || !this.watch) return false
    return this.watch.push(readingIds)
  }

  propose({ proposals, popup, interaction, hiddenCount, error }) {
    this.proposalFrame = { proposals, proposalPopup: false, proposalHiddenCount: hiddenCount ?? 0, ...(error ? { proposalError: error } : {}) }
    const frame = { ...this.status, ...this.proposalFrame, message: boundedText(this.status.message, proposals.length ? 8192 : 16384, 'Response'), proposalPopup: popup, proposalInteraction: interaction === true, ...(error ? { proposalError: error } : {}) }
    if (!error) delete frame.proposalError
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
    this.pendingNotifications.push({ id: randomUUID(), message: boundedText(message, 4096, 'Ride update') })
    if (!this.starting && ['idle', 'error'].includes(this.status.state)) this.setState(this.status.state, this.status.message, this.status.transcript, this.status.voiceFailure)
  }

  setState(state, message = '', transcript = this.status.transcript, voiceFailure = undefined) {
    const limit = this.proposalFrame.proposals.length ? 8192 : 16384
    const reply = boundedText(message, limit, 'Response')
    const notifications = !this.starting && ['idle', 'error'].includes(state) ? this.pendingNotifications.splice(0) : []
    const judgment = this.dependencies.getJudgmentStatus?.()
    this.status = {
      ...(judgment ? {judgment} : {}), proposalCapabilities: { read: Boolean(this.watch), respond: Boolean(this.watch), acknowledge: Boolean(this.watch) }, ...this.proposalFrame, ...this.replyFrame, ...(this.jev ? { jev: this.jev } : {}), agents: this.agentFrame, ...(this.remoteFrame ? { remote: this.remoteFrame } : {}), ...(this.home || this.status.briefing ? { briefing: this.briefing } : {}), replyInput: true, textInput: true, v: 1, type: 'status', state, level: 0,
      message: reply, ...(state === 'error' && ['microphone','timeout','unavailable','protocol','invalid_audio','cleanup'].includes(voiceFailure) ? {voiceFailure} : {}), ...(notifications.length ? { notifications } : {}),
      transcript: boundedText(transcript, 4096, 'Transcript'),
    }
    for (const listener of this.listeners) listener(this.status)
    this.drainRemote()
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
    this.replyFrame={}
    this.status = { ...this.status, message: '', notifications: [], transcript: '' }
    delete this.status.voiceFailure
    try {
      const captureId = ++this.captureId
      this.recording = await this.dependencies.record(level => {
        if (this.closed || captureId !== this.captureId || this.status.state !== 'recording') return
        this.status = { ...this.status, level }
        for (const listener of this.listeners) listener(this.status)
      })
      if (this.closed) { await this.discard(); return }
      this.setState('recording')
      this.observeRecording(this.recording,captureId)
    } catch {
      if (!this.closed) this.setState('error', 'Microphone unavailable', this.status.transcript, 'microphone')
    } finally {
      this.starting = false
      this.drainRemote()
      if (['idle', 'error'].includes(this.status.state) && this.pendingNotifications.length) this.setState(this.status.state, this.status.message, this.status.transcript, this.status.voiceFailure)
      this.watch?.setBusy(!['idle', 'error'].includes(this.status.state))
    }
  }

  observeRecording(recording,captureId) {
    void recording.done.then(() => {
      if(this.closed || captureId!==this.captureId || this.recording!==recording)return
      if(this.remoteRecording?.recording===recording)this.remoteRecording=undefined
      return this.finish()
    },() => {
      if(!this.closed && captureId===this.captureId && this.status.state==='recording')this.pending=this.failCapture()
    })
  }

  /** Reserve synchronously before a remote display receives capture permission. */
  reserveRemoteRecording(recording,requestStop) {
    if(this.closed || this.starting || this.watch?.responding || !['idle','error'].includes(this.status.state))return false
    this.replyFrame={}
    this.recording=recording
    this.remoteRecording={recording,requestStop}
    this.watch?.setBusy(true)
    this.setState('recording','','')
    this.observeRecording(recording,++this.captureId)
    return true
  }

  cancelRemoteRecording(recording, reason = 'cancelled') {
    if(this.recording!==recording || this.remoteRecording?.recording!==recording)return Promise.resolve(false)
    const failures = { microphone: 'Microphone unavailable', timeout: 'Recording timed out. Try again.', unavailable: 'Recording connection lost. Try again.', protocol: 'Recording transfer failed. Try again.', invalid_audio: 'Recording audio is invalid. Try again.' }
    if(reason!=='cancelled' && !Object.hasOwn(failures,reason))return Promise.resolve(false)
    this.captureId++
    this.remoteRecording=undefined
    this.starting=true
    const cancellation=(async()=>{
      const cleaned=await this.discard()
      if(!cleaned)this.recording=recording
      this.starting=!cleaned
      if(!this.closed)this.setState(cleaned && reason==='cancelled'?'idle':'error',cleaned?failures[reason] ?? '':'Recording cleanup failed',this.status.transcript,cleaned?reason:'cleanup')
      this.watch?.setBusy(!cleaned)
      return cleaned
    })()
    this.pending=cancellation.then(()=>{})
    return cancellation
  }

  async failCapture() {
    if (this.status.state !== 'recording' || this.closed) return
    this.setState('transcribing')
    await this.discard()
    if (!this.closed) this.setState('error', 'Microphone unavailable', this.status.transcript, 'microphone')
  }

  finish() {
    if (this.closed || this.status.state !== 'recording') return this.pending
    if(this.remoteRecording) {
      try{this.remoteRecording.requestStop()}catch{this.pending=this.cancelRemoteRecording(this.recording,'unavailable').then(()=>{})}
      return this.pending
    }
    this.setState('transcribing')
    this.pending = this.submit()
    return this.pending
  }

  async submit() {
    let failure = ''
    let response = ''
    let reply
    const recording = this.recording
    try {
      if (!recording) return
      const path = await recording.stop()
      if (this.closed) return
      const text = await this.dependencies.transcribe(path, this.controller.signal)
      if (!this.closed) {
        const ownerTurnId=randomUUID();this.replyFrame={ownerTurnId}
        this.setState('thinking', '', text)
        response = await this.promptResponse(text,undefined,this.ownerContext(ownerTurnId,bound=>{reply=bound}))
        if(reply)this.remote?.completeReply(reply.id,{status:'answered',answer:boundedText(response,4000,'Response')})
      }
    } catch (error) {
      failure = error instanceof AudioLimitError
        ? `Recording exceeds the ${error.limit.toLocaleString('en-US')}-byte upload limit; record a shorter request`
        : this.dependencies.failureMessage || 'Personal Bot request failed; try again'
      if(reply)try{this.remote?.completeReply(reply.id,{status:'failed'})}catch{failure=replyPersistenceFailure}
    } finally {
      if (!await this.discard()) failure = this.dependencies.failureMessage || 'Personal Bot request failed; try again'
      if (!this.closed) {
        this.setState(failure ? 'error' : 'idle', failure || response)
        if (!failure) this.watch?.interact()
      }
    }
  }

  /** Submit a typed turn through the same resident session as voice. */
  sendText(text, replyTo = undefined) {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 3000
      || this.closed || this.starting || this.watch?.responding || !['idle', 'error'].includes(this.status.state)) return false
    let reply
    try { if(replyTo!==undefined) { if(!this.remote) return false;reply=this.remote.beginReply(replyTo,text.trim()) } }catch{return false}
    const ownerTurnId=reply?.id??randomUUID()
    this.replyFrame={ownerTurnId,...(reply?{replyTo:reply.replyTo,threadId:reply.threadId}:{})}
    this.watch?.setBusy(true)
    this.setState('thinking', '', text.trim())
    this.pending = this.submitText(text.trim(),reply,ownerTurnId)
    return true
  }

  ownerContext(id,onBound) {
    return Object.freeze({id,bind:reply=>{
      if(this.closed || this.status.state!=='thinking' || this.replyFrame.ownerTurnId!==id || reply.id!==id)throw Error('Owner reply binding is no longer active')
      onBound(reply)
      this.replyFrame={ownerTurnId:id,replyTo:reply.replyTo,threadId:reply.threadId}
    }})
  }

  async submitText(text, reply = undefined, ownerTurnId = randomUUID()) {
    try {
      const response = await this.promptResponse(text,reply,this.ownerContext(ownerTurnId,bound=>{reply=bound}))
      if(reply)this.remote?.completeReply(reply.id,{status:'answered',answer:boundedText(response,4000,'Response')})
      if (!this.closed) { this.setState('idle', response); this.watch?.interact() }
    } catch {
      let failure=reply?'Reply did not complete. Check its delivery receipt before sending again.':this.dependencies.failureMessage || 'Personal Bot request failed; try again'
      if(reply)try{this.remote?.completeReply(reply.id,{status:'failed'})}catch{failure=replyPersistenceFailure}
      if (!this.closed) this.setState('error', failure)
    } finally {
      this.watch?.setBusy(false)
    }
  }

  async promptResponse(text, reply = undefined, owner = undefined) {
    let active = true
    let latest = ''
    let timer
    const stop = () => { active = false; clearTimeout(timer); timer = undefined }
    this.cancelStreaming = stop
    let bound=reply
    let acknowledge=false
    const clearDraft=()=>{
      clearTimeout(timer);timer=undefined;latest=''
      if(this.status.message)this.setState('thinking','')
    }
    const currentOwner=owner?Object.freeze({...owner,requireDeliveryAcknowledgement:()=>{
      if(!active || this.closed || this.status.state!=='thinking' || this.replyFrame.ownerTurnId!==owner.id)throw Error('Owner reply binding is no longer active')
      acknowledge=true;clearDraft()
    },bind:value=>{
      owner.bind(value)
      bound=value
      if(acknowledge)clearDraft()
    }}):undefined
    try {
      const response=await this.dependencies.prompt(text, snapshot => {
        if (!active || this.closed || acknowledge) return
        latest = boundedText(snapshot, 16_384, 'Response')
        if (timer || latest === this.status.message) return
        timer = setTimeout(() => {
          timer = undefined
          if (active && !this.closed && !acknowledge && latest !== this.status.message) this.setState('thinking', latest)
        }, 100)
      },reply,currentOwner) || ''
      if(!acknowledge || !bound)return response
      if(this.closed || !owner || bound.id!==owner.id || this.replyFrame.ownerTurnId!==owner.id)throw Error('Owner reply binding is no longer active')
      return replyAcknowledgement(this.remote?.replyOutcome?.(owner.id),owner.id)
    } finally {
      stop()
      this.cancelStreaming = () => {}
    }
  }

  async discard() {
    const recording = this.recording
    this.recording = undefined
    if(this.remoteRecording?.recording===recording)this.remoteRecording=undefined
    try {
      await recording?.cleanup()
      return true
    } catch {
      if (this.closed) this.recording = recording
      return false
    }
  }

  close() {
    this.terminated = true
    if (!this.closing) {
      const attempt = this.suspending
        ? this.suspending.catch(() => {}).then(() => this.shutdown())
        : this.shutdown()
      this.closing = attempt
      void attempt.catch(() => { if (this.closing === attempt) this.closing = undefined })
    }
    return this.closing
  }

  suspend() {
    if (this.terminated) return this.close()
    if (!this.suspending) {
      const attempt = this.shutdown()
      this.suspending = attempt
      void attempt.catch(() => { if (this.suspending === attempt) this.suspending = undefined })
    }
    return this.suspending
  }

  async resume() {
    await this.suspending
    if (this.terminated || !this.suspending) return
    this.controller = new AbortController()
    this.closed = false
    this.suspending = undefined
  }

  async shutdown() {
    this.remoteUnsubscribe?.()
    this.remoteUnsubscribe=undefined
    this.remoteRefreshQueued=false
    this.remote = undefined
    this.closed = true
    if (this.jev?.status === 'checking') this.jev = { status: 'unavailable' }
    this.agentFrame = { state: 'unavailable', tasks: [] }
    this.captureId++
    this.controller.abort()
    this.cancelStreaming()
    this.setState('idle', '', '')
    if (!await this.discard()) throw Error('Recording cleanup failed')
    await this.pending
    if (this.recording) throw Error('Recording cleanup failed')
  }
}
