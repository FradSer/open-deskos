'use strict'

let sequence = 0

async function capturePaintedPage(win, rect, timeoutMs = 5000) {
  const contents = win.webContents
  const [width, height] = win.getContentSize()
  const markerId = `odk-native-capture-${++sequence}`
  const colors = [17, 239, 83 + sequence % 32, 173 - sequence % 32]
  const removeScript = `document.getElementById(${JSON.stringify(markerId)})?.remove()`
  return new Promise((resolve, reject) => {
    let phase = 'marker'
    let settled = false
    const removeMarker = () => {
      try { return Promise.resolve(contents.executeJavaScript(removeScript)) } catch (error) { return Promise.reject(error) }
    }
    const cleanup = () => {
      clearTimeout(timer)
      contents.removeListener('paint', painted)
      contents.removeListener('destroyed', destroyed)
    }
    const fail = error => {
      if (settled) return
      settled = true
      cleanup()
      // Cleanup must not replace the observed failure or hold its deadline open.
      removeMarker().catch(() => {})
      reject(error)
    }
    const hasMarker = frame => {
      const bitmap = frame.crop({ x: 0, y: 0, width: 8, height: 8 }).toBitmap({ scaleFactor: 1 })
      return colors.every((color, index) => {
        const x = (index % 2) * 4 + 1, y = (index >> 1) * 4 + 1
        const offset = (y * 8 + x) * 4
        return bitmap[offset] === color && bitmap[offset + 1] === color && bitmap[offset + 2] === color && bitmap[offset + 3] === 255
      })
    }
    const painted = (_event, _dirty, frame) => {
      if (settled || phase === 'removing') return
      try {
        const size = frame.getSize()
        if (frame.isEmpty() || size.width !== width || size.height !== height) return
        const marked = hasMarker(frame)
        if (phase === 'marker') {
          if (!marked) return
          phase = 'removing'
          removeMarker().then(() => {
            if (settled) return
            phase = 'clean'
            contents.invalidate()
          }).catch(fail)
        } else if (!marked) {
          const image = rect === undefined ? frame : frame.crop(rect)
          settled = true
          cleanup()
          resolve(image)
        }
      } catch (error) { fail(error) }
    }
    const destroyed = () => fail(Error('Preview closed before its full viewport painted'))
    const timer = setTimeout(() => fail(Error('Preview did not paint its full viewport and remove the frame marker')), timeoutMs)
    contents.on('paint', painted)
    contents.once('destroyed', destroyed)
    // This helper runs only in isolated fixtures. The fixed overlay has no input,
    // accessibility, or layout role. Its pixels bind the image to this request.
    const installScript = `(() => {
      const marker = document.createElement('div')
      marker.id = ${JSON.stringify(markerId)}
      marker.setAttribute('aria-hidden', 'true')
      marker.inert = true
      marker.style.cssText = 'position:fixed!important;left:0!important;top:0!important;width:8px!important;height:8px!important;z-index:2147483647!important;pointer-events:none!important;display:grid!important;grid-template-columns:4px 4px!important;contain:strict!important;margin:0!important;padding:0!important;border:0!important;opacity:1!important;transform:none!important;filter:none!important;'
      marker.style.forcedColorAdjust = 'none'
      for (const color of ${JSON.stringify(colors)}) {
        const cell = document.createElement('span')
        cell.style.cssText = 'width:4px!important;height:4px!important;display:block!important;border:0!important;margin:0!important;padding:0!important;'
        cell.style.backgroundColor = 'rgb(' + color + ',' + color + ',' + color + ')'
        marker.append(cell)
      }
      document.documentElement.append(marker)
    })()`
    try {
      Promise.resolve(contents.executeJavaScript(installScript)).then(() => {
        if (settled) return removeMarker().catch(() => {})
        contents.invalidate()
      }).catch(fail)
    } catch (error) { fail(error) }
  })
}

module.exports = { capturePaintedPage }
