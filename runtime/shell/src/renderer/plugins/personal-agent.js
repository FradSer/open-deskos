;(function (root) {
  'use strict'
  const GLYPHS = {"message": "<svg data-tabler=\"message\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1\" /></svg>", "terminal": "<svg data-tabler=\"terminal-2\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" /></svg>"}
  const CHILD_GLYPHS = {
    agent: GLYPHS.message, code: GLYPHS.terminal,
    book: '<svg data-tabler="book-open" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6l0 13" /><path d="M12 6l0 13" /><path d="M21 6l0 13" /></svg>',
    compass: '<svg data-tabler="compass" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M8 16l2 -6l6 -2l-2 6l-6 2" /><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 3l0 2" /><path d="M12 19l0 2" /><path d="M3 12l2 0" /><path d="M19 12l2 0" /></svg>',
    spark: '<svg data-tabler="sparkles" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" /></svg>',
  }
  root.odkPlugins.register({
    id: 'odk.page.personal-agent', manifest: { schemaVersion: 1 }, kind: 'page', surface: 'app',
    mount(el, ctx) {
      el.innerHTML = `<div class="agent-panel">
        <header class="agent-head"><span class="agent-avatar" data-avatar="onee" aria-hidden="true"><img class="agent-avatar-fallback" src="avatars/onee.svg" alt="" /></span>
          <details class="agent-identity"><summary aria-label="Edit Agent identity"><h1 class="agent-name"></h1><span class="agent-state" role="status">Checking Personal Bot…</span><svg data-tabler="chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M6 9l6 6l6 -6" /></svg></summary><form class="agent-identity-form"><p class="agent-status-detail">Checking Personal Bot…</p>
            <label>Name<input name="name" maxlength="40" required /></label>
            <button type="submit">Save</button></form></details></header>
        <nav class="agent-thread-nav" aria-label="Session thread" hidden><button class="agent-thread-all" type="button">All messages</button><span></span></nav>
        <div class="agent-history"><div class="agent-conversation" tabindex="0" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><p class="agent-empty">Ask about your desk or continue a task.</p></div>
        <button class="agent-latest" type="button" hidden>Jump to latest <svg data-tabler="arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" /></svg></button>
        </div>
        <aside class="agent-reply-context" aria-label="Reply reference" hidden><div><span class="agent-reply-session"></span><span class="agent-reply-preview"></span></div><button class="agent-reply-cancel" type="button">Cancel reply</button></aside>
        <form class="agent-composer" data-mode="voice"><button class="agent-mic" type="button" aria-label="Start voice request"><svg data-tabler="microphone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M8 21l8 0" /><path d="M12 17l0 4" /></svg><span class="agent-mic-label">Tap to talk</span></button><button class="agent-keys" type="button" aria-label="Switch to keyboard input"><svg data-tabler="keyboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2l0 -8" /><path d="M6 10l0 .01" /><path d="M10 10l0 .01" /><path d="M14 10l0 .01" /><path d="M18 10l0 .01" /><path d="M6 14l0 .01" /><path d="M18 14l0 .01" /><path d="M10 14l4 .01" /></svg></button><textarea rows="1" maxlength="3000" aria-label="Message Personal Agent"></textarea><button class="agent-send" type="submit" aria-label="Send message"><svg data-tabler="arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 11l-6 -6" /><path d="M6 11l6 -6" /></svg></button></form>
      </div>`
      const $ = selector => el.querySelector(selector)
      const conversation = $('.agent-conversation')
      const input = $('textarea')
      const composer = $('.agent-composer')
      const micControl = $('.agent-mic')
      const keysControl = $('.agent-keys')
      const voiceLabel = $('.agent-mic-label')
      const sendControl = $('.agent-send')
      const state = $('.agent-state')
      const capsule = $('.agent-identity summary')
      const reducedMotion = root.matchMedia?.('(prefers-reduced-motion: reduce)')
      let capsuleMotion
      function stopCapsuleMotion() { capsuleMotion?.cancel();capsuleMotion = undefined }
      function animateCapsule() {
        stopCapsuleMotion()
        if (reducedMotion?.matches || root.document.hidden) return
        capsuleMotion = capsule.animate?.([{ opacity: 0.78, transform: 'scale(0.985)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      }
      const pauseCapsule = () => { if (root.document.hidden) stopCapsuleMotion() }
      root.document.addEventListener('visibilitychange', pauseCapsule)
      reducedMotion?.addEventListener('change', stopCapsuleMotion)
      ctx.trackCleanup?.(() => { stopCapsuleMotion();root.document.removeEventListener('visibilitychange', pauseCapsule);reducedMotion?.removeEventListener('change', stopCapsuleMotion) })
      const avatar = root.odkPersonalAgentAvatar.mount($('.agent-avatar'))
      const busyStates = ['starting', 'sending', 'recording', 'transcribing', 'thinking']
      const stateLabels = { idle: 'Ready', thinking: 'Working…', recording: 'Listening…', starting: 'Preparing microphone…', sending: 'Submitting…', transcribing: 'Transcribing…', unavailable: 'Personal Bot unavailable', error: 'Request failed. You can try again.' }
      const voiceFailures = new Set(['Microphone unavailable', 'Recording timed out. Try again.', 'Recording connection lost. Try again.', 'Recording transfer failed. Try again.', 'Recording audio is invalid. Try again.', 'Recording cleanup failed'])
      let composerMode = 'keyboard'
      let voiceStarted = false
      function voiceAvailable() { return root.odkPersonalBot?.supportsVoiceInput !== false }
      function fieldControl() { return composerMode === 'keyboard' ? input : micControl }
      // The voice control states the next action of its own mode. A host that
      // declares no voice input states that condition instead.
      function renderVoiceControl() {
        const ready = voiceAvailable(), busy = busyStates.includes(lastStatus)
        micControl.disabled = !ready || (busy && lastStatus !== 'recording')
        micControl.setAttribute('aria-label', !ready ? 'Microphone unavailable on this host'
          : lastStatus === 'recording' ? 'Stop recording'
            : composerMode === 'keyboard' ? 'Record voice request'
              : voiceStarted ? 'Switch to keyboard input'
                : 'Start voice request')
        voiceLabel.textContent = !ready ? 'Voice unavailable'
          : composerMode === 'keyboard' ? 'Voice'
            : busy ? stateLabels[lastStatus] || 'Tap to talk'
              : voiceStarted ? 'Type instead'
                : 'Tap to talk'
        micControl.dataset.recording = String(lastStatus === 'recording')
      }
      // Voice is the default composer. The field itself is the voice control, and
      // the keyboard is the explicit alternative next to it.
      function setComposerMode(mode, focus = false) {
        composerMode = mode === 'voice' ? 'voice' : 'keyboard'
        const voice = composerMode === 'voice'
        composer.dataset.mode = composerMode
        input.hidden = voice
        sendControl.hidden = voice
        keysControl.hidden = !voice
        if (voice) voiceStarted = false
        renderVoiceControl()
        if (focus) fieldControl().focus({ preventScroll: true })
      }
      let identity = { name: 'Personal Agent' }
      try { const saved = JSON.parse(localStorage.getItem('odk.agent.identity')); if (typeof saved?.name === 'string' && saved.name.trim()) identity = { name: saved.name.slice(0, 40) } } catch {}
      let released = false
      let scrollIdle
      let revision = 0
      let turn = null
      const ownerTurns = new Map()
      const seenNotifications = new Set()
      const remoteMessages = new Map()
      const durableReplies = new Map()
      const remoteRecords = new Map()
      const timeline = new Map()
      const remoteArchive = new Map()
      const remoteObservedAt = new Map()
      const ownerArchive = new Map()
      const replyArchive = new Map()
      let allowedHistory = new Set()
      let historyEntries = []
      let lastSnapshot
      let lastScrollTop = 0
      let selectedReply = null
      let selectedThread = null
      const children = new Map()
      let lastStatus = 'unknown'
      setComposerMode(voiceAvailable() ? 'voice' : 'keyboard')
      let pending = false
      function setState(message, caption = message) {
        const changed = state.textContent !== caption
        if (changed) state.textContent = caption
        if ($('.agent-status-detail').textContent !== message) $('.agent-status-detail').textContent = message
        state.hidden = !caption
        if (changed) animateCapsule()
        $('.agent-identity summary').setAttribute('aria-label', `${identity.name}${caption ? ', ' + caption : ''}. View status and edit identity`)
      }
      function applyIdentity() {
        $('.agent-name').textContent = identity.name
        $('.agent-identity summary').setAttribute('aria-label', `${identity.name}${state.textContent ? ', ' + state.textContent : ''}. View status and edit identity`)
        for (const node of el.querySelectorAll('.agent-message-assistant')) node.setAttribute('aria-label', identity.name)
        root.odkIcons?.apply?.(el)
        input.placeholder = 'Message…'
        input.setAttribute('aria-label', `Message ${identity.name}`)
        $('.agent-identity-form [name="name"]').value = identity.name
      }
      applyIdentity()
      function remoteKey(item) { return JSON.stringify([item.id,item.at??null,item.text,(item.sources || []).map(source => [source.key,source.revision])]) }
      function replyThread(reply) {
        const origins = [...remoteArchive.values()].filter(item=>item.id===reply.replyTo.messageId)
          .flatMap(item=>item.sources.filter(source=>source.key===reply.replyTo.sourceKey && source.revision===reply.replyTo.sourceRevision))
        return origins.length===1 && origins[0].threadId ? origins[0].threadId : reply.threadId
      }
      function removeMessage(article) { if (article) { timeline.delete(article);article.remove() } }
      function expireOwner(id) {
        const owner = ownerTurns.get(id)
        ownerArchive.delete(id)
        if (owner === turn) return
        ownerTurns.delete(id)
        if (owner && !durableReplies.has(id)) for (const body of [owner.user, owner.response]) removeMessage(body.closest('article'))
      }
      function trimOwnerTurns() {
        while (ownerTurns.size > 128) expireOwner([...ownerTurns].find(([,owner])=>owner !== turn)[0])
      }
      function prepareHistory(status) {
        for (const item of status.conversation?.turns || []) ownerArchive.set(item.id, item)
        for (const item of [...(status.remote?.replies || [])].reverse()) replyArchive.set(item.id, item)
        while (ownerArchive.size > 128) {
          expireOwner(ownerArchive.keys().next().value)
        }
        while (replyArchive.size > 128) {
          const id = replyArchive.keys().next().value, row = durableReplies.get(id)
          replyArchive.delete(id);durableReplies.delete(id)
          if (!row) continue
          if (ownerTurns.has(id) || turn?.user?.closest('article') === row.article) {
            delete row.article.dataset.replyId;row.details.remove();row.status.remove()
          } else {
            removeMessage(row.article)
            if (row.answer) removeMessage(row.answer.closest('article'))
          }
        }
        for (const item of [...(status.remote?.messages || [])].reverse()) {
          const key = remoteKey(item)
          if (!remoteObservedAt.has(key)) remoteObservedAt.set(key, item.at ?? Date.now())
          remoteArchive.set(key, item)
        }
        while (remoteArchive.size > 64) {
          const key = remoteArchive.keys().next().value
          const article = remoteMessages.get(key)
          if (article) { timeline.delete(article);article.remove();remoteMessages.delete(key) }
          remoteArchive.delete(key);remoteObservedAt.delete(key);remoteRecords.delete(key)
        }
        const entries = new Map()
        for (const [key, item] of remoteArchive) entries.set(`remote:${key}`, {key:`remote:${key}`,at:remoteObservedAt.get(key),threads:(item.sources || []).map(source=>source.threadId)})
        for (const item of ownerArchive.values()) entries.set(`owner:${item.id}`, {key:`owner:${item.id}`,at:item.at,threads:[item.threadId]})
        for (const item of replyArchive.values()) entries.set(`owner:${item.id}`, {key:`owner:${item.id}`,at:item.at,threads:[replyThread(item)]})
        allowedHistory = new Set([...allowedHistory].filter(key=>entries.has(key)))
        historyEntries = [...entries.values()].filter(item=>!selectedThread || item.threads.includes(selectedThread.id)).sort((a,b)=>a.at-b.at)
        for (const item of historyEntries.slice(-12)) allowedHistory.add(item.key)
        if (status.ownerTurnId) allowedHistory.add(`owner:${status.ownerTurnId}`)
      }
      function loadEarlier() {
        if (released || !lastSnapshot || !historyEntries.some(item=>!allowedHistory.has(item.key))) return
        const top = conversation.getBoundingClientRect().top
        const anchor = [...conversation.querySelectorAll('.agent-message')].find(node=>!node.hidden && node.getBoundingClientRect().bottom>top)
        const before = anchor?.getBoundingClientRect().top
        for (const item of historyEntries.filter(item=>!allowedHistory.has(item.key)).slice(-12)) allowedHistory.add(item.key)
        render(lastSnapshot, false)
        if (anchor?.isConnected) conversation.scrollTop += anchor.getBoundingClientRect().top-before
        lastScrollTop = conversation.scrollTop
      }
      function openThread(thread) {
        selectedThread = thread
        if (lastSnapshot) render(lastSnapshot, false)
        showThread(thread)
      }
      function latest() {
        conversation.scrollTop = conversation.scrollHeight
        lastScrollTop = conversation.scrollTop
        const button=$('.agent-latest')
        if(document.activeElement===button)conversation.focus({ preventScroll: true })
        button.hidden = true
      }
      function message(role, text) {
        $('.agent-empty')?.remove()
        const article = document.createElement('article')
        article.className = `agent-message agent-message-${role}`
        if (role === 'assistant') {
          article.innerHTML = '<div class="agent-message-bubble"><div class="agent-message-body"></div></div>'
          article.setAttribute('aria-label', identity.name)
        } else article.innerHTML = '<div class="agent-message-body"></div>'
        const body = article.querySelector('.agent-message-body')
        body.textContent = text
        conversation.append(article)
        root.odkIcons?.apply?.(article)
        return body
      }
      function renderAgents(frame) {
        if (frame?.state !== 'live' || !Array.isArray(frame.tasks)) {
          for (const row of children.values()) row.querySelector('.agent-child-state').textContent = 'Status unavailable'
          return
        }
        const active = new Set()
        for (const task of frame.tasks) {
          active.add(task.taskId)
          let row = children.get(task.taskId)
          if (!row) {
            $('.agent-empty')?.remove()
            row = document.createElement('article')
            row.className = 'agent-child'
            row.innerHTML = '<span class="agent-child-avatar" aria-hidden="true"></span><div class="agent-child-details"><span class="agent-child-name"></span><span class="agent-child-state"></span></div>'
            children.set(task.taskId, row)
            conversation.append(row)
          }
          const avatar = Object.hasOwn(CHILD_GLYPHS, task.identity?.avatar) ? task.identity.avatar : 'agent'
          if (row.dataset.avatar !== avatar) { row.dataset.avatar = avatar; row.querySelector('.agent-child-avatar').innerHTML = CHILD_GLYPHS[avatar]; root.odkIcons?.apply?.(row) }
          row.querySelector('.agent-child-name').textContent = task.identity?.name || 'Temporary agent'
          row.querySelector('.agent-child-state').textContent = { starting: 'Starting', running: 'Running', cancelling: 'Cancelling' }[task.state] || 'Status unavailable'
        }
        for (const [id, row] of children) if (!active.has(id)) { row.remove(); children.delete(id) }
      }
      function taskName(source) {
        if (source.taskName) return source.taskName
        const project = source.project?.split(/[\\/]/).filter(Boolean).at(-1)
        return project ? `${project} task` : 'Pi task'
      }
      function replySource(reply) {
        const matches = [...remoteArchive.values()].filter(item=>item.id===reply.replyTo.messageId).flatMap(item=>item.sources).filter(source=>source.key===reply.replyTo.sourceKey && source.revision===reply.replyTo.sourceRevision)
        return matches.length === 1 ? matches[0] : undefined
      }
      function showThread(thread) {
        selectedThread = thread
        const navigation = $('.agent-thread-nav')
        navigation.hidden = !thread || Boolean(selectedReply && selectedReply.threadId === thread.id)
        navigation.querySelector('span').textContent = thread ? thread.name || 'Task messages' : ''
        navigation.querySelector('span').title = thread?.name || ''
        for (const article of conversation.querySelectorAll('.agent-message')) {
          const ids = JSON.parse(article.dataset.threadIds || '[]')
          article.hidden = Boolean(thread && !ids.includes(thread.id))
        }
        for (const row of children.values()) row.hidden = Boolean(thread)
      }
      function replyContext() {
        const context = $('.agent-reply-context')
        context.hidden = !selectedReply
        const navigation = $('.agent-thread-nav')
        navigation.hidden = !selectedThread || Boolean(selectedReply && selectedReply.threadId === selectedThread.id)
        $('.agent-reply-session').textContent = selectedReply ? `Reply to ${selectedReply.taskName}` : ''
        $('.agent-reply-session').title = selectedReply?.taskName || ''
        $('.agent-reply-preview').textContent = selectedReply?.preview || ''
      }
      function referenceCount(item, source) {
        let count = 0
        for (const record of remoteRecords.values()) if (record.id === item.id) {
          count += record.sources.filter(value => value.key === source.key && value.revision === source.revision).length
        }
        return count
      }
      function updateReplyChoices() {
        for (const button of conversation.querySelectorAll('.agent-session-reply')) {
          const item = remoteRecords.get(button.dataset.recordKey)
          const source = item?.sources.find(source => source.key === button.dataset.sourceKey && source.revision === button.dataset.sourceRevision)
          const ambiguous = !source || referenceCount(item, source) !== 1
          const unsupported = root.odkPersonalBot?.supportsReplyTo !== true
          button.disabled = pending || unsupported || ambiguous
          const note = button.parentElement.querySelector('.agent-reply-unavailable')
          note.textContent = ambiguous ? 'Reply reference is ambiguous.' : unsupported ? 'Session replies need an updated host.' : ''
          note.hidden = !note.textContent
        }
      }
      function selectReply(item, source) {
        if (pending || root.odkPersonalBot?.supportsReplyTo !== true || referenceCount(item, source) !== 1) return
        selectedReply = Object.freeze({ reference: Object.freeze({ messageId: item.id, sourceKey: source.key, sourceRevision: source.revision }),
          sessionId: source.sessionId, taskName: taskName(source), threadId: source.threadId, preview: item.text.length > 100 ? item.text.slice(0, 100) + '…' : item.text })
        if (source.threadId) openThread({ id: source.threadId, sessionId: source.sessionId, name: taskName(source) })
        replyContext()
        // A reply reference is answered by typing, so the reference opens the keyboard.
        setComposerMode('keyboard', true)
      }
      function sessionLabel(source, item, recordKey) {
        const row = document.createElement('div')
        row.className = 'agent-message-session'
        const label = document.createElement(source.threadId ? 'button' : 'span')
        label.className = 'agent-session-open'
        label.innerHTML = GLYPHS.terminal
        const name = document.createElement('span')
        name.className = 'agent-session-name'
        name.textContent = taskName(source)
        label.append(name)
        label.title = taskName(source)
        if (source.threadId) {
          label.type = 'button'
          label.setAttribute('aria-label', `View task: ${taskName(source)}`)
          label.addEventListener('click', () => { openThread({ id: source.threadId, sessionId: source.sessionId, name: taskName(source) }); latest() })
        }
        row.append(label)
        if (/^[a-f0-9]{64}$/.test(item.id) && typeof source.key === 'string' && source.key.trim() && /^[a-f0-9]{64}$/.test(source.revision)) {
          const button = document.createElement('button')
          button.type = 'button';button.className = 'agent-session-reply'
          button.textContent = 'Reply';button.dataset.sourceKey = source.key
          button.dataset.sourceRevision = source.revision;button.dataset.replyMessageId = item.id;button.dataset.recordKey = recordKey
          button.disabled = root.odkPersonalBot?.supportsReplyTo !== true
          if (button.disabled) button.title = 'Session replies need an updated host.'
          button.setAttribute('aria-label', `Reply to ${taskName(source)}`)
          button.addEventListener('click', () => selectReply(item, source))
          const note = document.createElement('span');note.className = 'agent-reply-unavailable';note.hidden = true
          row.append(button, note)
        }
        return row
      }
      function timelineEntry(article, at, ids) {
        const threads = [...new Set(ids.filter(Boolean))]
        article.dataset.threadIds = JSON.stringify(threads)
        if (threads.length === 1) article.dataset.threadId = threads[0]
        else delete article.dataset.threadId
        if (Number.isFinite(at)) timeline.set(article, at)
      }
      function renderHistory(frame) {
        for (const item of ownerArchive.values()) {
          if (!allowedHistory.has(`owner:${item.id}`) && !ownerTurns.has(item.id)) continue
          const durable = durableReplies.get(item.id)
          let owner = ownerTurns.get(item.id)
          if (!owner) {
            owner = { ownerTurnId: item.id, prompt: item.transcript, user: durable?.article.querySelector('.agent-message-body') || message('user', item.transcript),
              response: durable?.answer || message('assistant', ''), bound: Boolean(durable), live: false }
            ownerTurns.set(item.id, owner)
            if (durable) durable.answer = owner.response
          }
          owner.user.closest('article').dataset.ownerTurnId = item.id
          owner.response.closest('article').dataset.ownerTurnId = item.id
          const threadId = durable?.threadId || item.threadId
          timelineEntry(owner.user.closest('article'), item.at, [threadId])
          timelineEntry(owner.response.closest('article'), item.at + 0.5, [threadId])
          // Central history supplies replay, never a replacement for already observed live output.
          const terminal = ['idle', 'error', 'unconfirmed'].includes(item.state)
          if (!durable && ((!owner.live && !owner.historyTerminal) || (terminal && !owner.completed))) {
            owner.prompt = item.transcript;owner.user.textContent = item.transcript
            root.odkPersonalBotReply.render(owner.response, item.message)
            owner.response.setAttribute('aria-busy', String(['thinking', 'transcribing'].includes(item.state)))
            owner.completed = terminal
            owner.historyTerminal = terminal
          }
          let notice = owner.response.closest('article').querySelector('.agent-history-state')
          if (item.state === 'unconfirmed') {
            if (!notice) { notice = document.createElement('p');notice.className = 'agent-history-state agent-reply-status';notice.setAttribute('role', 'status');owner.response.closest('article').append(notice) }
            notice.textContent = 'Response not confirmed. Check before retrying.'
            owner.response.setAttribute('aria-busy', 'false')
          } else notice?.remove()
        }
        trimOwnerTurns()
        orderTimeline();showThread(selectedThread)
      }
      function renderReplies() {
        for (const reply of replyArchive.values()) {
          if (!allowedHistory.has(`owner:${reply.id}`) && !durableReplies.has(reply.id)) continue
          let row = durableReplies.get(reply.id)
          if (!row) {
            const owner = ownerTurns.get(reply.id)
            const body = owner?.user || message('user', reply.text)
            if (owner) owner.bound = true
            const article = body.closest('article');article.dataset.replyId = reply.id
            const details = document.createElement('div');details.className = 'agent-reply-details';article.append(details)
            const status = document.createElement('span');status.className = 'agent-reply-status';details.append(status)
            row = { article, status, details, answer: owner?.response || null };durableReplies.set(reply.id, row)
            timelineEntry(article, reply.at, [reply.threadId])
          }
          const threadId = replyThread(reply)
          timelineEntry(row.article, reply.at, [threadId])
          if (row.answer) timelineEntry(row.answer.closest('article'), reply.at + 0.5, [threadId])
          if (row.threadId !== threadId || row.taskName !== taskName(replySource(reply) || {})) {
            row.article.querySelector('.agent-message-session')?.remove()
            if (reply.sessionId) row.details.append(sessionLabel({ ...replySource(reply), sessionId: reply.sessionId, threadId }, {}))
            row.threadId = threadId;row.taskName = taskName(replySource(reply) || {})
          }
          row.status.textContent = ({ queued: 'Queued for this session', dispatching: 'Sending to this session', delivered: 'Sent to this session', unknown: 'Delivery not confirmed. Check the session before retrying.', answered: 'Personal Agent replied', failed: 'Reply failed. Check connection details before retrying.' })[reply.status] || 'Status unavailable'
          row.status.hidden = !['queued', 'dispatching', 'unknown', 'failed'].includes(reply.status)
          row.article.append(row.status)
          if (reply.answer) {
            if (!row.answer) { row.answer = message('assistant', '');timelineEntry(row.answer.closest('article'), reply.at + 0.5, [threadId]) }
            timelineEntry(row.answer.closest('article'), reply.at + 0.5, [threadId])
            root.odkPersonalBotReply.render(row.answer, reply.answer)
          }
        }
        while (durableReplies.size > 128) {
          const key = durableReplies.keys().next().value, row = durableReplies.get(key)
          timeline.delete(row.article);row.article.remove()
          if (row.answer) { timeline.delete(row.answer.closest('article'));row.answer.closest('article').remove() }
          durableReplies.delete(key)
        }
      }
      function orderTimeline() {
        const ordered = [...timeline].filter(([article]) => article.parentElement === conversation).sort((a, b) => a[1] - b[1])
        // A retained origin precedes replies to it, including legacy messages without a timestamp.
        for (const reply of [...replyArchive.values()].sort((a,b)=>a.at-b.at)) {
          const row=durableReplies.get(reply.id)
          const origins=[...remoteRecords].filter(([,item])=>item.id===reply.replyTo.messageId && item.sources.some(source=>source.key===reply.replyTo.sourceKey && source.revision===reply.replyTo.sourceRevision))
          if(!row || origins.length!==1 || origins[0][1].at!==undefined)continue
          const origin=remoteMessages.get(origins[0][0]),from=ordered.findIndex(([article])=>article===origin),to=ordered.findIndex(([article])=>article===row.article)
          if(to>=0 && from>to)ordered.splice(to,0,...ordered.splice(from,1))
        }
        for (let index = ordered.length - 2; index >= 0; index--) {
          const node = ordered[index][0], next = ordered[index + 1][0]
          const children = [...conversation.children]
          if (children.indexOf(node) > children.indexOf(next)) conversation.insertBefore(node, next)
        }
      }
      function renderRemote(frame) {
        if (!frame || frame.state === 'disabled') return
        for (const item of remoteArchive.values()) {
          const recordKey = remoteKey(item)
          if (remoteMessages.has(recordKey)) {
            const previous = remoteRecords.get(recordKey)
            remoteRecords.set(recordKey, item)
            if (item.sources.some((source, index) => source.threadId !== previous.sources[index].threadId || source.taskName !== previous.sources[index].taskName)) {
              const article = remoteMessages.get(recordKey), body = article.querySelector('.agent-message-body')
              const focused = [...body.querySelectorAll('.agent-message-session')].findIndex(row => row.contains(document.activeElement))
              const replyFocused = document.activeElement?.classList.contains('agent-session-reply')
              for (const row of body.querySelectorAll('.agent-message-session')) row.remove()
              for (const source of item.sources) body.querySelector('.agent-update-sources').append(sessionLabel(source, item, recordKey))
              timelineEntry(article, remoteObservedAt.get(recordKey), item.sources.map(source => source.threadId))
              for (const [index, source] of item.sources.entries()) {
                const oldThread = previous.sources[index].threadId
                if (selectedThread && selectedThread.id === oldThread) selectedThread = source.threadId ? { id: source.threadId, sessionId: source.sessionId, name: taskName(source) } : null
                if (selectedReply?.reference.messageId === item.id && selectedReply.reference.sourceKey === source.key && selectedReply.reference.sourceRevision === source.revision) {
                  selectedReply = Object.freeze({ ...selectedReply, threadId: source.threadId, sessionId: source.sessionId, taskName: taskName(source) })
                }
              }
              if (focused >= 0) body.querySelectorAll('.agent-message-session')[focused]?.querySelector(replyFocused ? '.agent-session-reply' : '.agent-session-open')?.focus({ preventScroll: true })
              replyContext()
            }
            continue
          }
          remoteRecords.set(recordKey, item)
          if (!allowedHistory.has(`remote:${recordKey}`)) continue
          const body = message('assistant', item.text)
          const article = body.closest('article')
          article.dataset.remoteId = item.id
          timelineEntry(article, remoteObservedAt.get(recordKey), (item.sources || []).map(source => source.threadId))
          remoteMessages.set(recordKey, article)
          article.classList.add('agent-update')
          while (remoteMessages.size > 64) {
            const first = remoteMessages.keys().next().value
            timeline.delete(remoteMessages.get(first));remoteMessages.get(first)?.remove(); remoteMessages.delete(first);remoteRecords.delete(first)
          }
          const details = document.createElement('div')
          details.className = 'agent-message-actions agent-update-sources'
          details.setAttribute('role','group')
          details.setAttribute('aria-label','Related tasks')
          for (const source of item.sources || []) details.append(sessionLabel(source, item, recordKey))
          body.append(details)
        }
        updateReplyChoices()
        renderReplies()
        orderTimeline()
        showThread(selectedThread)
      }

      function readinessCaption(value, judgment) {
        if (judgment !== undefined) return judgment.status === 'ready' && ['model', 'jev'].includes(judgment.provider) ? '' : 'Connection unavailable'
        return value?.status === 'verified' ? '' : value?.status === 'checking' ? 'Connecting…' : 'Connection unavailable'
      }
      function render(status, authoritative = true) {
        if (released || ctx.signal?.aborted || !status?.state) return
        if (authoritative) avatar.update(status)
        const bottom = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < 40
        lastSnapshot = status
        prepareHistory(status)
        if (authoritative) revision++
        const readyCaption = readinessCaption(status.jev, status.judgment)
        renderAgents(status.agents)
        const busy = ['starting', 'sending', 'recording', 'transcribing', 'thinking'].includes(status.state)
        if (status.state === 'unavailable') for (const owner of ownerTurns.values()) owner.live = false
        renderRemote(status.remote)
        renderHistory(status.conversation)
        const newTurn = !status.replyTo && status.transcript && (!turn || (status.ownerTurnId ? status.ownerTurnId !== turn.ownerTurnId : status.transcript !== turn.prompt || (turn.completed && status.state === 'thinking')))
        if (newTurn) {
          const durable = durableReplies.get(status.ownerTurnId)
          turn = ownerTurns.get(status.ownerTurnId) || { ownerTurnId: status.ownerTurnId, prompt: status.transcript,
            user: durable?.article.querySelector('.agent-message-body') || message('user', status.transcript),
            response: durable?.answer || message('assistant', ''), bound: Boolean(durable) }
          if (durable) {
            durable.answer = turn.response
            timelineEntry(turn.response.closest('article'), timeline.get(durable.article) + 0.5, [durable.threadId])
            orderTimeline();showThread(selectedThread)
          }
          if (status.ownerTurnId) {
            ownerTurns.set(status.ownerTurnId, turn)
            trimOwnerTurns()
          }
        }
        if (turn && status.ownerTurnId === turn.ownerTurnId && ['idle', 'error'].includes(status.state)) turn.historyTerminal = false
        if (turn && status.ownerTurnId === turn.ownerTurnId && status.state !== 'unavailable') { turn.live = true;if (!status.conversation?.turns?.some(item => item.id === turn.ownerTurnId && item.state === 'unconfirmed')) turn.response.closest('article').querySelector('.agent-history-state')?.remove() }
        const reply = status.message
        if (!status.replyTo && !turn?.bound && !turn?.historyTerminal && reply && ['thinking', 'idle', 'error'].includes(status.state)) {
          if (!turn) turn = { prompt: '', response: message('assistant', '') }
          root.odkPersonalBotReply.render(turn.response, reply)
        }
        for (const notification of Array.isArray(status.notifications) ? status.notifications : []) {
          if (!notification || typeof notification.id !== 'string' || !notification.id || typeof notification.message !== 'string' || !notification.message || seenNotifications.has(notification.id)) continue
          seenNotifications.add(notification.id)
          message('assistant', notification.message)
        }
        if (turn && !turn.historyTerminal) {
          turn.response.setAttribute('aria-busy', String(status.state === 'thinking'))
          if (['idle', 'error'].includes(status.state)) turn.completed = true
        }
        const caption = status.state === 'idle' ? (readyCaption || ({unavailable:'Task updates unavailable',stale:'Task updates may be out of date'}[status.remote?.state] || '')) : status.state === 'thinking' ? 'Thinking…' : status.state === 'error' && voiceFailures.has(status.message) ? status.message : stateLabels[status.state] || 'Personal Bot status unknown'
        setState(status.proposalError || caption || 'Ready', status.proposalError ? 'Suggestions unavailable' : caption)
        sendControl.disabled = busy || status.state === 'unavailable' || pending

        lastStatus = status.state
        // A host that declares no voice input opens the keyboard and never traps
        // the owner in a microphone it cannot use.
        if (!voiceAvailable() && !busy && composerMode === 'voice') setComposerMode('keyboard')
        renderVoiceControl()
        if (bottom) latest()
        else $('.agent-latest').hidden = false
      }
      const unsub = root.odkPersonalBot?.subscribe(render)
      ctx.trackCleanup?.(() => {
        released = true;avatar.destroy();composer.removeEventListener('focusin', engageAvatar);composer.removeEventListener('focusout', disengageAvatar);clearTimeout(scrollIdle);delete conversation.dataset.scrolling;unsub?.()
        conversation.removeEventListener('scroll', handleScroll)
        conversation.removeEventListener('wheel', handleHistoryWheel)
        conversation.removeEventListener('keydown', handleHistoryKey)
        lastSnapshot = undefined;remoteArchive.clear();remoteObservedAt.clear();ownerArchive.clear();replyArchive.clear();allowedHistory.clear();historyEntries = []
      })
      const initialRevision = revision
      root.odkPersonalBot?.getStatus().then(status => { if (revision === initialRevision) render(status) }).catch(() => { if (revision === initialRevision) render({ state: 'unavailable' }) })
      $('.agent-identity-form').addEventListener('submit', event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const name = String(form.get('name')).trim()
        if (!name) return
        identity = { name: name.slice(0, 40) }
        try { localStorage.setItem('odk.agent.identity', JSON.stringify(identity)) } catch { setState('Identity changed for this window. Storage unavailable.', 'Identity changed for this window') }
        applyIdentity()
        $('.agent-identity').open = false
        fieldControl().focus({ preventScroll: true })
      })
      $('.agent-composer').addEventListener('submit', async event => {
        event.preventDefault()
        const text = input.value.trim()
        if (!text || pending || $('.agent-send').disabled) return
        pending = true
        const avatarIntent = avatar.intent('sending')
        const submittedRevision = revision
        $('.agent-reply-cancel').disabled = true
        updateReplyChoices()
        $('.agent-send').disabled = true
        try {
          const submittedReply = selectedReply
          if (submittedReply && root.odkPersonalBot?.supportsReplyTo !== true) throw Error('unsupported')
          if (!submittedReply) openThread(null)
          const receipt = await (submittedReply ? root.odkPersonalBot.sendText(text, submittedReply.reference) : root.odkPersonalBot.sendText(text))
          if (released) return
          if (!receipt?.accepted) throw Error('refused')
          if (input.value.trim() === text) input.value = ''
          if (selectedReply === submittedReply || (submittedReply && selectedReply?.reference === submittedReply.reference)) { selectedReply = null;replyContext() }
          if (revision === submittedRevision) setState('Submitted. Waiting for the resident session…', 'Waiting for response…')
        } catch {
          if (!released && revision === submittedRevision) {
            setState('Message delivery was not confirmed. Draft kept; check the service before sending again.', 'Delivery not confirmed')
            avatar.fail(avatarIntent)
          }
        } finally {
          pending = false
          if (!released) { $('.agent-reply-cancel').disabled = false;updateReplyChoices() }
          if (!released) $('.agent-send').disabled = !['idle', 'error'].includes(lastStatus)
        }
      })
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('.agent-composer').requestSubmit() }
      })
      $('.agent-reply-cancel').addEventListener('click', () => { if (!pending) { selectedReply = null;openThread(null);replyContext();fieldControl().focus({ preventScroll: true }) } })
      $('.agent-thread-all').addEventListener('click', () => { openThread(null);conversation.focus({ preventScroll: true }) })
      // Voice is the default composer, so the first tap on the voice field starts
      // the request. A later tap while the composer is idle opens the keyboard,
      // and the microphone of the keyboard opens voice and records in one tap.
      micControl.addEventListener('click', async () => {
        if (composerMode === 'voice' && voiceAvailable() && voiceStarted && !busyStates.includes(lastStatus)) {
          setComposerMode('keyboard', true)
          return
        }
        if (composerMode === 'keyboard') setComposerMode('voice')
        voiceStarted = true
        const requestRevision = revision
        const avatarIntent = avatar.intent(lastStatus === 'recording' ? 'transcribing' : 'preparing')
        try {
          const receipt = await root.odkPersonalBotStatus?.mic()
          if (receipt?.accepted === false) throw Error('Recording control refused')
        } catch {
          if (!released && revision === requestRevision) {
            setState('Unable to control recording. You can use keyboard input.', 'Microphone unavailable')
            avatar.fail(avatarIntent)
          }
        }
      })
      function engageAvatar() { avatar.engage(composerMode === 'keyboard') }
      function disengageAvatar() { avatar.engage(false) }
      composer.addEventListener('focusin', engageAvatar)
      composer.addEventListener('focusout', disengageAvatar)
      keysControl.addEventListener('click', () => setComposerMode('keyboard', true))
      $('.agent-latest').addEventListener('click', latest)
      function handleScroll() {
        if(released)return
        const upward = conversation.scrollTop < lastScrollTop
        lastScrollTop = conversation.scrollTop
        if (upward && conversation.scrollTop < 80) loadEarlier()
        $('.agent-latest').hidden = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < 40
        conversation.dataset.scrolling = 'true'
        clearTimeout(scrollIdle)
        scrollIdle = setTimeout(() => { delete conversation.dataset.scrolling }, 700)
      }
      function handleHistoryWheel(event) { if(event.deltaY<0 && conversation.scrollTop<80)loadEarlier() }
      function handleHistoryKey(event) {
        if(event.target===conversation && (event.key==='Home' || ['PageUp','ArrowUp'].includes(event.key) && conversation.scrollTop<80))loadEarlier()
      }
      conversation.addEventListener('scroll', handleScroll, { passive: true })
      conversation.addEventListener('wheel', handleHistoryWheel, { passive: true })
      conversation.addEventListener('keydown', handleHistoryKey)
    },
  })
})(window)
