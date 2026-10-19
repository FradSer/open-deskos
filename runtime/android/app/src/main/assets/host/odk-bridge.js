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

  function request(method, args) {
    return new Promise(function (resolve) {
      var id = 'request-' + (++nextId)
      var immediate = native && typeof native[method] === 'function'
        ? native[method](JSON.stringify({ id: id, args: args || [] }))
        : null
      if (immediate) {
        /*
         * A JavaScript interface answers inside the calling task, but every
         * other host's bridge answers asynchronously. Resolving on a later task
         * keeps that difference out of the renderer: a synchronous answer made
         * the first frame arrive before the surface had laid out, and a
         * conversation taller than the pane then stayed at its oldest message
         * instead of following the newest one.
         */
        setTimeout(function () { resolve(JSON.parse(immediate)) }, 0)
        return
      }
      pending[id] = resolve
    })
  }

  window.odkPersonalBot = {
    subscribe: function (listener) {
      frameListeners.push(listener)
      request('status', []).then(function (frame) { if (frame) listener(frame) })
      return function () {
        var index = frameListeners.indexOf(listener)
        if (index >= 0) frameListeners.splice(index, 1)
      }
    },
    getStatus: function () { return request('status', []) },
    sendText: function (text) { return request('sendText', [text]) },
    toggle: function () { return request('toggle', []) },
    proposalCommand: function (command) { return request('proposalCommand', [command]) },
    onMic: function () { return function () { } },
  }
})()