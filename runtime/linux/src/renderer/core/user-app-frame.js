;(function (root) {
  'use strict'

  function nonce() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  function mount(container, { id, name, revision, url, timeoutMs = 8000, onError } = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('container is required')
    if (!url) throw new TypeError('user app URL is required')
    const token = nonce()
    const frame = container.ownerDocument.createElement('iframe')
    frame.title = name || id || 'User application'
    frame.className = 'user-app-frame'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.dataset.appId = id || ''
    frame.dataset.revision = revision || ''
    const target = new URL(url, root.location?.href || 'http://localhost/')
    target.searchParams.set('token', token)
    let resolveReady
    let rejectReady
    let settled = false
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    let timer
    const cleanup = () => {
      root.removeEventListener('message', onMessage)
      if (timer) { clearTimeout(timer); timer = null }
    }
    const fail = (message) => {
      if (settled) return
      settled = true
      cleanup()
      const error = new Error(message)
      frame.remove()
      rejectReady(error)
      if (typeof onError === 'function') onError(error)
    }
    const onMessage = (event) => {
      const data = event.data
      if (event.source !== frame.contentWindow || !data || data.token !== token) return
      if (data.type === 'odk-user-app-error') { fail(data.error || 'user app failed during startup'); return }
      if (data.type !== 'odk-user-app-ready') return
      if (!settled) { settled = true; cleanup(); resolveReady(frame) }
    }
    root.addEventListener('message', onMessage)
    timer = setTimeout(() => fail('user app readiness timed out'), timeoutMs)
    frame.src = target.href
    container.appendChild(frame)
    return {
      frame,
      ready,
      dispose() {
        if (!settled) fail('user app disposed')
        frame.remove()
      },
    }
  }

  const api = { mount }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.odkUserAppFrame = api
})(typeof window !== 'undefined' ? window : globalThis)
