'use strict'

function installPluginShutdown(app, pluginHost, onError) {
  let started = false
  const report = error => {
    try { onError(error) } catch { /* Diagnostics cannot prevent application exit. */ }
  }
  const beforeQuit = event => {
    event.preventDefault()
    if (started) return
    started = true
    let shutdown
    // stop() delivers cancellation synchronously, before its queued cleanup runs.
    try { shutdown = pluginHost.stop() } catch (error) { shutdown = Promise.reject(error) }
    void Promise.resolve(shutdown).catch(report).then(() => {
      app.removeListener('before-quit', beforeQuit)
      app.quit()
    }).catch(report)
  }
  app.on('before-quit', beforeQuit)
}

module.exports = { installPluginShutdown }
