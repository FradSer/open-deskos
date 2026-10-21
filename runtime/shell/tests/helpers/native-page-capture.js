'use strict'

async function capturePaintedPage(win, rect, timeoutMs = 5000) {
  const contents = win.webContents
  const [width, height] = win.getContentSize()
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      contents.removeListener('paint', painted)
      contents.removeListener('destroyed', destroyed)
    }
    const painted = (_event, _dirty, frame) => {
      const size = frame.getSize()
      if (frame.isEmpty() || size.width !== width || size.height !== height) return
      cleanup()
      resolve()
    }
    const destroyed = () => { cleanup(); reject(Error('Preview closed before its full viewport painted')) }
    const timer = setTimeout(() => { cleanup(); reject(Error('Preview did not paint its full viewport')) }, timeoutMs)
    contents.on('paint', painted)
    contents.once('destroyed', destroyed)
    try { contents.invalidate() } catch (error) { cleanup(); reject(error) }
  })
  // The paint event acknowledges a native surface. Its image can predate the
  // fixture update, so capture the current compositor pixels after that ACK.
  return rect === undefined ? contents.capturePage() : contents.capturePage(rect)
}

module.exports = { capturePaintedPage }
