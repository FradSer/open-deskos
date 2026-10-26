'use strict'

function installPluginShutdown(app, pluginHost, onError) {
  let started = false
  let finished = false
  let exitCode
  let timer
  const report = error => {
    try { onError(error) } catch { /* Diagnostics cannot prevent application exit. */ }
  }
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    app.removeListener('before-quit', beforeQuit)
    if (exitCode === undefined) app.quit()
    else app.exit(exitCode)
  }
  const beforeQuit = event => {
    event.preventDefault()
    if (started) return
    started = true
    let shutdown
    // stop() delivers cancellation synchronously, before its queued cleanup runs.
    try { shutdown = pluginHost.stop() } catch (error) { shutdown = Promise.reject(error) }
    void Promise.resolve(shutdown).then(records => {
      // A resolved Host stop can retain resources after a cleanup failure.
      if (exitCode !== undefined && Array.isArray(records)
        && records.some(record => record.state === 'cleanup-failed' || record.state === 'cleanup-blocked')) {
        throw Error('plugin shutdown retained resources')
      }
    }).catch(error => {
      report(error)
      if (exitCode !== undefined) exitCode = 1
    }).then(finish).catch(report)
  }
  app.on('before-quit', beforeQuit)
  return code => {
    if (finished) return
    if (exitCode === undefined) {
      exitCode = code
      timer = setTimeout(() => {
        report(Error('plugin shutdown timed out'))
        exitCode = 1
        finish()
      }, 5000)
    }
    app.quit()
  }
}

module.exports = { installPluginShutdown }
