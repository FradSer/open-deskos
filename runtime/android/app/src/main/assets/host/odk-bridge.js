;(function () {
  'use strict'

  /*
   * The host bridge. This is the Android equivalent of Electron's preload: it
   * wraps the JavaScript interface the activity injected into the shape the Shell
   * renderer already reads. It carries no design and no content, so the renderer
   * stays a single source.
   */
  var native = window.ODKAndroid
  var pending = {}
  var nextId = 0
  var frameListeners = []

  window.__odkBridge = {
    /** One frame the desk produced reaches every reader. */
    deliver: function (channel, payload) {
      if (channel !== 'personalAgent') return
      var frame
      try { frame = JSON.parse(payload) } catch (error) { return }
      for (var index = 0; index < frameListeners.length; index++) {
        try { frameListeners[index](frame) } catch (error) { }
      }
    },
    /** An answer that arrives after the JavaScript interface returned. */
    receipt: function (id, payload) {
      var resolve = pending[id]
      if (!resolve) return
      delete pending[id]
      // The host may answer with a JSON text or with an object literal, so both
      // shapes reach the renderer as the same value.
      resolve(typeof payload === 'string' ? JSON.parse(payload) : payload)
    },
  }

  if (native) native.onmessage = function (event) {
    var message
    try { message = JSON.parse(event.data) } catch (_) { return }
    if (!message || typeof message.id !== 'string') return
    window.__odkBridge.receipt(message.id, message.result)
  }

  function request(method, args) {
    return new Promise(function (resolve) {
      var id = 'request-' + (++nextId)
      var timer = setTimeout(function () {
        delete pending[id]
        resolve({ accepted: false, reason: 'The desk did not confirm the turn' })
      }, 22000)
      pending[id] = function (value) { clearTimeout(timer); resolve(value) }
      if (!native || typeof native.postMessage !== 'function') {
        pending[id]({ accepted: false, reason: 'Personal Agent link unavailable' }); delete pending[id]; return
      }
      native.postMessage(JSON.stringify({ id: id, method: method, args: args || [] }))
    })
  }

  window.odkPersonalAgent = {
    supportsReplyTo: true,
    supportsVoiceInput: false,
    subscribe: function (listener) {
      frameListeners.push(listener)
      request('status', []).then(function (frame) { if (frame) listener(frame) })
      return function () {
        var index = frameListeners.indexOf(listener)
        if (index >= 0) frameListeners.splice(index, 1)
      }
    },
    getStatus: function () { return request('status', []) },
    sendText: function (text, replyTo) { return request('sendText', replyTo === undefined ? [text] : [text, replyTo]) },
    toggle: function () { return request('toggle', []) },
    proposalCommand: function (command) { return request('proposalCommand', [command]) },
    onMic: function () { return function () { } },
  }
})()