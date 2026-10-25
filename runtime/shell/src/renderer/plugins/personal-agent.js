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
          <div class="agent-identity"><div class="agent-capsule" role="group" aria-label="Personal Agent"><h1 class="agent-name"></h1><span class="agent-state" role="status">Checking Personal Agent…</span></div></div></header>
        <nav class="agent-thread-nav" aria-label="Session thread" hidden><button class="agent-thread-all" type="button">All messages</button><span></span></nav>
        <div class="agent-history"><div class="agent-conversation" tabindex="0" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><p class="agent-empty">Ask about your desk or continue a task.</p></div>
        <button class="agent-latest" type="button" hidden>Jump to latest <svg data-tabler="arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" /></svg></button>
        </div>
        <aside class="agent-reply-context" aria-label="Reply reference" hidden><div><span class="agent-reply-session"></span><span class="agent-reply-preview"></span></div><button class="agent-reply-cancel" type="button">Cancel reply</button></aside>
        <p class="agent-input-notice" role="status" hidden></p>
        <div class="agent-input-row"><section class="agent-pi-config" aria-label="Pi configuration">
          <label class="agent-pi-command-label"><span class="sr-only">Pi commands</span><select class="agent-pi-command" aria-label="Pi commands"><option value="">Pi</option><option value="login">/login</option><option value="model">/model</option><option value="thinking">/thinking</option></select></label>
          <form class="agent-pi-form" hidden><label class="agent-pi-choice-label"><span></span><select class="agent-pi-choice"></select></label><label class="agent-pi-secret-label" hidden><span></span><input class="agent-pi-value" autocomplete="off" maxlength="3000" /></label><p class="agent-pi-status" role="status"></p><a class="agent-pi-auth-link" target="_blank" rel="noreferrer" hidden>Open Pi sign-in</a><div class="agent-pi-actions"><button type="submit">Apply</button><button type="button" class="agent-pi-close">Close</button></div></form>
        </section>
        <form class="agent-composer" data-mode="voice"><div class="agent-suggestions" hidden></div><div class="agent-composer-controls"><button class="agent-keys" type="button" aria-label="Switch to keyboard input"><svg data-tabler="keyboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2l0 -8" /><path d="M6 10l0 .01" /><path d="M10 10l0 .01" /><path d="M14 10l0 .01" /><path d="M18 10l0 .01" /><path d="M6 14l0 .01" /><path d="M18 14l0 .01" /><path d="M10 14l4 .01" /></svg></button><button class="agent-mic" type="button" aria-label="Start voice request"><svg data-tabler="microphone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M8 21l8 0" /><path d="M12 17l0 4" /></svg><span class="agent-mic-label">Tap to talk</span></button><button class="agent-cancel" type="button" aria-label="Cancel recording" title="Cancel recording · Escape" hidden><svg data-tabler="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg></button><div class="agent-recording-feedback" hidden><div class="agent-input-level" role="meter" aria-label="Microphone input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div></div><textarea rows="1" maxlength="3000" aria-label="Message Personal Agent"></textarea><button class="agent-send" type="submit" aria-label="Send message"><svg data-tabler="arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 11l-6 -6" /><path d="M6 11l6 -6" /></svg></button></div></form></div>
      </div>`
      const $ = selector => el.querySelector(selector)
      const conversation = $('.agent-conversation')
      const input = $('textarea')
      const composer = $('.agent-composer')
      let closePiConfig = () => {}
      const composerControls = $('.agent-composer-controls')
      const suggestions = root.odkPersonalAgentSuggestions?.mount($('.agent-suggestions'), { focusInput: () => fieldControl().focus({ preventScroll: true }) })
      ctx.trackCleanup?.(() => suggestions?.destroy())
      const micControl = $('.agent-mic')
      const keysControl = $('.agent-keys')
      const voiceLabel = $('.agent-mic-label')
      const sendControl = $('.agent-send')
      const cancelControl = $('.agent-cancel')
      const recordingFeedback = $('.agent-recording-feedback')
      const inputLevel = $('.agent-input-level')
      const notice = $('.agent-input-notice')
      const state = $('.agent-state')
      const capsule = $('.agent-capsule')
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
      const voiceFailures = {microphone:'Microphone unavailable',timeout:'Recording timed out.',unavailable:'Recording connection lost.',protocol:'Recording transfer failed.',invalid_audio:'Recording audio is invalid.',cleanup:'Recording cleanup failed'}
      function captionFor(status) {
        if (status.state === 'recording') return 'Listening...'
        if (busyStates.includes(status.state) || root.odkPersonalAgentAvatar.phaseFor(status) === 'working') return 'Thinking...'
        return ''
      }
      let composerMode = 'keyboard'
      let voicePending = false
      let voiceFocusRequested = false
      let voiceSubmissionPending = false
      let cancelling = false
      let cancelRequested = false
      let activeSubmission = null
      let inputRevision = 0
      function voiceAvailable() { return root.odkPersonalAgent?.supportsVoiceInput !== false }
      function fieldControl() { return composerMode === 'keyboard' ? input : micControl }
      function resizeInput() {
        if (input.hidden) return
        input.style.height = '46px'
        const style = getComputedStyle(input)
        const limit = parseFloat(style.lineHeight) * 4 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        input.style.height = Math.min(limit, Math.max(46, input.scrollHeight)) + 'px'
        input.style.overflowY = input.scrollHeight > limit ? 'auto' : 'hidden'
      }
      let noticeAction
      function showNotice(text = '', label, action) {
        notice.hidden = !text
        if (!text) {
          if (notice.childNodes.length) notice.replaceChildren()
          noticeAction = undefined
          return
        }
        let detail = notice.querySelector('span')
        if (!detail) { detail = document.createElement('span');notice.prepend(detail) }
        if (detail.textContent !== text) detail.textContent = text
        let button = notice.querySelector('button')
        if (!label) { button?.remove();noticeAction = undefined;return }
        if (button && noticeAction !== action) { button.remove();button = null }
        if (!button) {
          button = document.createElement('button')
          button.type = 'button';button.addEventListener('click', action)
          notice.append(button);noticeAction = action
        }
        if (button.textContent !== label) button.textContent = label
      }
      async function checkStatus() {
        const checkedRevision = revision
        try {
          const status = await root.odkPersonalAgent.getStatus()
          if (!released && revision === checkedRevision) render(status)
        } catch { if (!released) showNotice('Connection unavailable. Your draft is kept.', 'Check status', checkStatus) }
      }
      function renderVoiceControl() {
        const recording = lastStatus === 'recording' && voiceAvailable(), keyboard = composerMode === 'keyboard'
        const busy = busyStates.includes(lastStatus) || pending || voicePending || voiceSubmissionPending || cancelling || cancelRequested || Boolean(activeSubmission) || lastSnapshot?.voiceFailure === 'cleanup'
        composer.dataset.state = recording ? 'listening' : busy ? 'thinking' : 'idle'
        micControl.hidden = recording
        micControl.disabled = !voiceAvailable() || busy || lastStatus === 'unavailable'
        micControl.setAttribute('aria-label', !voiceAvailable() ? 'Microphone unavailable on this host' : 'Start voice request')
        voiceLabel.textContent = voiceAvailable() ? 'Tap to talk' : 'Voice unavailable'
        keysControl.hidden = recording || keyboard
        cancelControl.hidden = !recording
        cancelControl.disabled = !recording || cancelling || cancelRequested || lastSnapshot?.cancelInput !== true || typeof root.odkPersonalAgent?.cancelRecording !== 'function'
        recordingFeedback.hidden = !recording
        input.hidden = recording || !keyboard
        sendControl.hidden = false
        sendControl.disabled = recording ? voicePending || voiceSubmissionPending || cancelling || cancelRequested : busy || lastStatus === 'unavailable' || !keyboard || !input.value.trim()
        const label = recording ? 'Send voice request' : 'Send message'
        sendControl.setAttribute('aria-label', label);sendControl.title = label
        const level = recording && Number.isFinite(lastSnapshot?.level) ? Math.round(Math.max(0, Math.min(1, lastSnapshot.level)) * 100) : 0
        inputLevel.setAttribute('aria-valuenow', String(level))
        inputLevel.style.setProperty('--agent-input-level', level + '%')
        resizeInput()
        if (recording && voiceFocusRequested && root.document.getElementById('app-view')?.hidden !== false) {
          voiceFocusRequested = false
          ;(cancelControl.disabled ? sendControl : cancelControl).focus({ preventScroll: true })
        }
      }
      function setComposerMode(mode, focus = false) {
        if (lastStatus === 'recording') return
        composerMode = mode === 'voice' ? 'voice' : 'keyboard'
        composer.dataset.mode = composerMode
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
      let pending = false
      setComposerMode(voiceAvailable() ? 'voice' : 'keyboard')
      function setState(caption) {
        const changed = state.textContent !== caption
        if (changed) state.textContent = caption
        state.hidden = !caption
        if (changed) animateCapsule()
        capsule.setAttribute('aria-label', `${identity.name}${caption ? ', ' + caption : ''}`)
      }
      function applyIdentity() {
        $('.agent-name').textContent = identity.name
        capsule.setAttribute('aria-label', `${identity.name}${state.textContent ? ', ' + state.textContent : ''}`)
        for (const node of el.querySelectorAll('.agent-message-assistant')) node.setAttribute('aria-label', identity.name)
        root.odkIcons?.apply?.(el)
        input.placeholder = 'Message…'
        input.setAttribute('aria-label', `Message ${identity.name}`)
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
          const unsupported = root.odkPersonalAgent?.supportsReplyTo !== true
          button.disabled = pending || unsupported || ambiguous
          const note = button.parentElement.querySelector('.agent-reply-unavailable')
          note.textContent = ambiguous ? 'Reply reference is ambiguous.' : unsupported ? 'Session replies need an updated host.' : ''
          note.hidden = !note.textContent
        }
      }
      function selectReply(item, source) {
        if (pending || root.odkPersonalAgent?.supportsReplyTo !== true || referenceCount(item, source) !== 1) return
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
          button.disabled = root.odkPersonalAgent?.supportsReplyTo !== true
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
            root.odkPersonalAgentReply.render(owner.response, item.message)
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
            root.odkPersonalAgentReply.render(row.answer, reply.answer)
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
        suggestions?.update(status)
        const restoreVoiceFocus = lastStatus === 'recording' && status.state !== 'recording' && composerControls.contains(root.document.activeElement)
        if (['error','unavailable'].includes(status.state)) voiceFocusRequested = false
        if (authoritative) avatar.update(status)
        if (activeSubmission) {
          const request = activeSubmission
          const matches = status.transcript === request.text && (status.ownerTurnId !== request.previousOwner || !status.ownerTurnId)
          const history = status.conversation?.turns?.find(item => item.transcript === request.text && !request.previousTurns.has(item.id))
          const reply = request.reference && status.remote?.replies?.find(item=>item.text===request.text && !request.previousReplies.has(item.id) && ['messageId','sourceKey','sourceRevision'].every(key=>item.replyTo?.[key]===request.reference[key]))
          if (reply && ['delivered','answered','failed'].includes(reply.status) && status.state==='idle') activeSubmission = null
          if (matches && ['thinking', 'transcribing'].includes(status.state)) request.observed = true
          if ((matches && ['idle', 'error'].includes(status.state) && (request.observed || status.ownerTurnId)) || history && ['idle', 'error'].includes(history.state)) activeSubmission = null
          else if (status.state === 'unavailable' || history?.state === 'unconfirmed') request.uncertain = true
        }
        if (status.state !== 'recording') voiceSubmissionPending = false
        const restoreRecordingFocus = cancelRequested && ['idle', 'error'].includes(status.state)
        if (restoreRecordingFocus) cancelRequested = false
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
          root.odkPersonalAgentReply.render(turn.response, reply)
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
        const caption = activeSubmission && !activeSubmission.uncertain ? 'Thinking...'
          : status.state === 'idle' ? (readyCaption || ({unavailable:'Task updates unavailable',stale:'Task updates may be out of date'}[status.remote?.state] || '') || captionFor(status)) : captionFor(status)
        setState(status.proposalError ? 'Suggestions unavailable' : caption)
        lastStatus = status.state
        if (activeSubmission?.uncertain) {
          setState('')
          showNotice('Delivery not confirmed. Check before sending again.', 'Check status', checkStatus)
        } else if (status.state === 'unavailable') {
          showNotice('Connection unavailable. Your draft is kept.', 'Check status', checkStatus)
        } else if (status.state === 'error') {
          const detail = voiceFailures[status.voiceFailure] || status.message || 'Request failed.'
          const retry = Boolean(status.voiceFailure && status.voiceFailure !== 'cleanup' && voiceAvailable())
          showNotice(detail, retry ? 'Record again' : 'Check status', retry ? startVoice : checkStatus)
        } else showNotice()
        if (!voiceAvailable() && !busy && composerMode === 'voice') setComposerMode('keyboard')
        renderVoiceControl()
        if ((restoreRecordingFocus || restoreVoiceFocus) && !cancelling && root.document.getElementById('app-view')?.hidden !== false) fieldControl().focus({ preventScroll: true })
        if (bottom) latest()
        else $('.agent-latest').hidden = false
      }
      const unsub = root.odkPersonalAgent?.subscribe(render)
      ctx.trackCleanup?.(() => {
        released = true;closePiConfig();avatar.destroy();inputObserver?.disconnect();root.removeEventListener('keydown', cancelKey, true);composer.removeEventListener('focusin', engageAvatar);composer.removeEventListener('focusout', disengageAvatar);clearTimeout(scrollIdle);delete conversation.dataset.scrolling;unsub?.()
        conversation.removeEventListener('scroll', handleScroll)
        conversation.removeEventListener('wheel', handleHistoryWheel)
        conversation.removeEventListener('keydown', handleHistoryKey)
        lastSnapshot = undefined;remoteArchive.clear();remoteObservedAt.clear();ownerArchive.clear();replyArchive.clear();allowedHistory.clear();historyEntries = []
      })
      const initialRevision = revision
      root.odkPersonalAgent?.getStatus().then(status => { if (revision === initialRevision) render(status) }).catch(() => { if (revision === initialRevision) render({ state: 'unavailable' }) })
      composer.addEventListener('submit', async event => {
        event.preventDefault()
        if (lastStatus === 'recording' && voiceAvailable()) { await submitVoice(); return }
        const text = input.value.trim()
        if (new TextEncoder().encode(text).length > 3000) { showNotice('Message is too long. Shorten it before sending.');input.focus({preventScroll:true});return }
        if (!text || composerMode !== 'keyboard' || pending || activeSubmission || busyStates.includes(lastStatus) || lastStatus === 'unavailable' || lastSnapshot?.voiceFailure === 'cleanup') return
        if(/^\/(login|model|thinking)$/.test(text)){input.value='';openPiConfig(text.slice(1));return}
        pending = true
        const avatarIntent = avatar.intent('sending')
        const request = { text, inputRevision, previousOwner: lastSnapshot?.ownerTurnId, previousTurns: new Set((lastSnapshot?.conversation?.turns || []).map(item=>item.id)), previousReplies: new Set((lastSnapshot?.remote?.replies || []).map(item=>item.id)), reference: selectedReply?.reference, observed: false, uncertain: false }
        activeSubmission = request
        const submittedRevision = revision
        let refused = false
        $('.agent-reply-cancel').disabled = true
        updateReplyChoices();renderVoiceControl();setState('Thinking...');showNotice()
        try {
          const submittedReply = selectedReply
          if (submittedReply && root.odkPersonalAgent?.supportsReplyTo !== true) throw Error('unsupported')
          if (!submittedReply) openThread(null)
          const receipt = await (submittedReply ? root.odkPersonalAgent.sendText(text, submittedReply.reference) : root.odkPersonalAgent.sendText(text))
          if (released) return
          if (!receipt?.accepted) { refused = receipt?.delivery === 'refused';throw Error('unconfirmed') }
          if (inputRevision === request.inputRevision && input.value.trim() === text) input.value = ''
          if (selectedReply === submittedReply || (submittedReply && selectedReply?.reference === submittedReply.reference)) { selectedReply = null;replyContext() }
        } catch {
          if (!released && activeSubmission === request) {
            if (refused) { activeSubmission = null;setState('');showNotice('Message was not sent. You can edit and send again.') }
            else { request.uncertain = true;setState('');showNotice('Delivery not confirmed. Check before sending again.', 'Check status', checkStatus) }
            if (revision === submittedRevision) avatar.fail(avatarIntent)
          }
        } finally {
          pending = false
          if (!released) {
            $('.agent-reply-cancel').disabled = false;updateReplyChoices();renderVoiceControl()
          }
        }
      })
      input.addEventListener('input', () => { inputRevision++;renderVoiceControl() })
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault();composer.requestSubmit() }
      })
      const inputObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resizeInput) : null
      inputObserver?.observe(composer)
      $('.agent-reply-cancel').addEventListener('click', () => { if (!pending) { selectedReply = null;openThread(null);replyContext();fieldControl().focus({ preventScroll: true }) } })
      $('.agent-thread-all').addEventListener('click', () => { openThread(null);conversation.focus({ preventScroll: true }) })
      async function startVoice() {
        if (released || micControl.disabled || !voiceAvailable() || voicePending) return
        voicePending = true;voiceFocusRequested = true
        const requestRevision = revision
        const avatarIntent = avatar.intent('preparing')
        showNotice();renderVoiceControl();setState('Thinking...')
        try {
          const receipt = await root.odkPersonalAgentStatus?.mic()
          if (!receipt || receipt.accepted === false) throw Error('Recording control refused')
        } catch {
          if (!released && revision === requestRevision) {
            voiceFocusRequested = false
            setState('');showNotice('Microphone unavailable.', 'Record again', startVoice)
            avatar.fail(avatarIntent)
          }
        } finally { voicePending = false;if (!released) renderVoiceControl() }
      }
      async function submitVoice() {
        if (released || lastStatus !== 'recording' || sendControl.disabled || voicePending) return
        voicePending = true;voiceSubmissionPending = true;renderVoiceControl()
        try {
          const receipt = await root.odkPersonalAgentStatus?.mic()
          if (!receipt || receipt.accepted === false) throw Error('Recording submission refused')
        } catch { if (!released) showNotice('Recording submission not confirmed.', 'Check status', checkStatus) }
        finally { voicePending = false;if (!released) renderVoiceControl() }
      }
      async function cancelRecording() {
        if (released || lastStatus !== 'recording' || cancelControl.disabled) return
        cancelling = true;cancelRequested = true;renderVoiceControl()
        try {
          const receipt = await root.odkPersonalAgent.cancelRecording()
          if (receipt?.accepted === false) {
            cancelRequested = false
            showNotice('Recording is still active. Cancel again or send it.')
          } else if (!receipt?.accepted) throw Error('Cancellation not confirmed')
        } catch { if (!released) showNotice('Recording cancellation not confirmed.', 'Check status', checkStatus) }
        finally {
          cancelling = false
          if (!released) {
            renderVoiceControl()
            if (!cancelRequested && ['idle','error'].includes(lastStatus)) fieldControl().focus({ preventScroll: true })
          }
        }
      }
      function cancelKey(event) {
        if (event.key !== 'Escape' || lastStatus !== 'recording' || root.document.getElementById('app-view')?.hidden === false || cancelControl.disabled) return
        event.preventDefault();event.stopImmediatePropagation();void cancelRecording()
      }
      root.addEventListener('keydown', cancelKey, true)
      micControl.addEventListener('click', startVoice)
      cancelControl.addEventListener('click', cancelRecording)
      const piCommand=$('.agent-pi-command'),piForm=$('.agent-pi-form'),piChoice=$('.agent-pi-choice')
      const piValue=$('.agent-pi-value'),piStatus=$('.agent-pi-status'),piLink=$('.agent-pi-auth-link')
      let piSnapshot,piMode='',piPoll,piRevision=0,piPending=null
      function setPiOptions(items,label) {
        piChoice.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.value;option.textContent=item.label;return option}))
        $('.agent-pi-choice-label span').textContent=label
        piChoice.setAttribute('aria-label',label)
      }
      function showPi(snapshot) {
        piSnapshot=snapshot
        piChoice.hidden=false;$('.agent-pi-choice-label').hidden=false;$('.agent-pi-secret-label').hidden=true
        piLink.hidden=true;piStatus.textContent=''
        const submit=piForm.querySelector('[type="submit"]');submit.disabled=false;submit.textContent='Apply'
        if(piMode==='login' && snapshot.login && !['done','error'].includes(snapshot.login.state)) {
          const login=snapshot.login,prompt=login.prompt
          piStatus.textContent=login.event?.message || 'Complete Pi sign-in.'
          if(login.event?.url){piLink.href=login.event.url;piLink.textContent='Open Pi sign-in';piLink.hidden=false}
          if(prompt?.type==='select')setPiOptions(prompt.options.map(o=>({value:o.id,label:o.label})),prompt.message)
          else {
            $('.agent-pi-choice-label').hidden=true
            if(prompt){$('.agent-pi-secret-label').hidden=false;$('.agent-pi-secret-label span').textContent=prompt.message;piValue.type=prompt.type==='secret'?'password':'text';piValue.setAttribute('aria-label',prompt.message);piValue.focus()}
            else submit.disabled=true
          }
          if(login.state==='working')piPoll=setTimeout(()=>runPi({action:'list'}),1000)
        } else if(piMode==='login') {
          const options=snapshot.providers.flatMap(p=>p.methods.map(method=>({value:JSON.stringify([p.id,method]),label:`${p.name} · ${method==='oauth'?'Sign in':'API key'}`})))
          setPiOptions(options,'Provider')
          if(snapshot.login)piStatus.textContent=snapshot.login.state==='done'?'Signed in with Pi.':snapshot.login.message
          submit.disabled=!options.length
        } else if(piMode==='model') {
          setPiOptions(snapshot.models.map(m=>({value:JSON.stringify([m.provider,m.id]),label:`${m.name || m.id} · ${m.provider}`})),'Model')
          if(snapshot.selected)piChoice.value=JSON.stringify([snapshot.selected.provider,snapshot.selected.id])
          if(!snapshot.models.length)piStatus.textContent='No authenticated models. Use /login first.'
          submit.disabled=!snapshot.models.length || snapshot.busy
        } else {
          setPiOptions((snapshot.thinkingLevels || []).map(level=>({value:level,label:level})),'Thinking level')
          piChoice.value=snapshot.thinkingLevel || 'off'
          submit.disabled=!(snapshot.thinkingLevels || []).length || snapshot.busy
          if(submit.disabled)piStatus.textContent='Select an available model first.'
        }
      }
      async function runPi(command) {
        const revision=piRevision
        if(piPending?.revision===revision)return
        const pending={revision};piPending=pending;piCommand.disabled=true
        piForm.querySelector('[type="submit"]').disabled=true
        try {
          if(!root.odkPersonalAgent?.configure)throw Error('Pi configuration is unavailable on this display.')
          const snapshot=await root.odkPersonalAgent.configure(command)
          if(released || revision!==piRevision)return
          showPi(snapshot)
        } catch(error) {
          if(!released && revision===piRevision){piStatus.textContent=error.message || 'Pi configuration failed. Retry.';piForm.querySelector('[type="submit"]').disabled=false}
        } finally {
          if(piPending===pending){piPending=null;if(!released)piCommand.disabled=false}
        }
      }
      async function openPiConfig(mode) {
        if(!['login','model','thinking'].includes(mode))return
        if(piMode==='login' && piSnapshot?.login && !['done','error'].includes(piSnapshot.login.state))return
        piRevision++;clearTimeout(piPoll);piMode=mode;piCommand.value=mode;piForm.hidden=false
        piValue.value='';piStatus.textContent='Loading Pi configuration…'
        await runPi({action:'list'})
        if(!released && !piForm.hidden)piChoice.focus()
      }
      closePiConfig=()=>{
        piRevision++;clearTimeout(piPoll);piPending=null;piCommand.disabled=false
        if(piMode==='login')void root.odkPersonalAgent?.configure?.({action:'cancel'}).catch(()=>{})
        piValue.value='';piForm.hidden=true;piCommand.value='';piMode=''
        if(!released){setComposerMode('keyboard');input.focus()}
      }
      piLink.addEventListener('click',event=>{
        event.preventDefault()
        const revision=piRevision,url=piLink.href
        const current=()=>!released && revision===piRevision && piMode==='login'
        void (async()=>{
          try {
            const opened=await root.odkPersonalAgent?.openAuthUrl?.(url)
            if(!opened && current())piStatus.textContent=`Open this URL in your browser: ${url}`
          } catch {
            if(current())piStatus.textContent=`Open this URL in your browser: ${url}`
          }
        })()
      })
      piCommand.addEventListener('change',()=>openPiConfig(piCommand.value))
      piForm.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePiConfig()}})
      $('.agent-pi-close').addEventListener('click',closePiConfig)
      piForm.addEventListener('submit',event=>{
        event.preventDefault();if(piPending?.revision===piRevision)return
        let command
        if(piMode==='login') {
          if(piSnapshot?.login?.state==='prompt'){command={action:'answer',value:piSnapshot.login.prompt.type==='select'?piChoice.value:piValue.value};piValue.value=''}
          else {const [provider,method]=JSON.parse(piChoice.value);command={action:'login',provider,method}}
        } else if(piMode==='model'){const [provider,model]=JSON.parse(piChoice.value);command={action:'model',provider,model}}
        else command={action:'thinking',level:piChoice.value}
        void runPi(command)
      })
      input.addEventListener('input',()=>{if(/^\/(login|model|thinking)$/.test(input.value.trim()))piCommand.value=input.value.trim().slice(1)})
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
