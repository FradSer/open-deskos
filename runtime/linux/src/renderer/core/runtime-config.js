;
(function (root) {
  'use strict'

  /*
   * Launch configuration the main process resolved from the device's runtime
   * environment and passed on the renderer URL. It is read here once, handed to
   * every plugin through ctx.runtimeConfig, and never read from the environment
   * inside a plugin.
   *
   * The Pi reasoning display is the folded default unless the device explicitly
   * asks for it: a value this desk does not recognize stays folded rather than
   * becoming a second way to publish what Pi was thinking.
   */
  function resolveRuntimeConfig(search) {
    const params = new URLSearchParams(search || '')
    return Object.freeze({
      piSessionReasoning: params.get('piReasoning') === 'shown' ? 'shown' : 'hidden',
    })
  }

  root.odkRuntimeConfig = {
    resolve: resolveRuntimeConfig,
    current: resolveRuntimeConfig(root.location?.search),
  }
})(typeof window !== 'undefined' ? window : globalThis)