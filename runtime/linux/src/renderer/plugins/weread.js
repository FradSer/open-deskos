;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.weread',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'WeRead',
    state: 'Loading',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-signal weread-body odk-col">
          <div class="weread-content">
            <div class="weread-cover-wrap" hidden>
              <canvas class="weread-cover"></canvas>
            </div>
            <div class="weread-copy">
              <p class="weread-text">Syncing highlights...</p>
              <strong class="weread-title">Loading</strong>
            </div>
          </div>
        </div>`
      const body = el.querySelector('.weread-body')
      const coverWrap = el.querySelector('.weread-cover-wrap')
      const cover = el.querySelector('.weread-cover')
      const copy = el.querySelector('.weread-copy')
      const textEl = () => el.querySelector('.weread-text')
      const titleEl = () => el.querySelector('.weread-title')
      const MIN_TEXT_SIZE = 14
      const MAX_TEXT_SIZE = 84
      const FIT_GAP = 28
      const baseTextSize = (length) => {
        if (length <= 12) return 84
        if (length <= 30) return 68
        if (length <= 60) return 56
        if (length <= 100) return 46
        if (length <= 160) return 38
        return 30
      }
      const fitText = (text, title) => {
        if (!el || !copy || !text || !title) return
        const copyStyles = getComputedStyle(copy)
        const copyGaps = (Number.parseFloat(copyStyles.paddingTop) || 0)
          + (Number.parseFloat(copyStyles.paddingBottom) || 0)
        const maxH = el.clientHeight - copyGaps - FIT_GAP
        if (maxH <= 0) return
        let size = Math.min(MAX_TEXT_SIZE, baseTextSize(text.textContent.length))
        text.style.fontSize = `${size}px`
        let guard = 60
        while (guard-- > 0 && size > MIN_TEXT_SIZE) {
          const needed = text.scrollHeight + title.offsetHeight + FIT_GAP
          if (needed <= maxH) break
          size -= 2
          text.style.fontSize = `${size}px`
        }
      }
      const scheduleFit = () => {
        const text = textEl()
        const title = titleEl()
        fitText(text, title)
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => fitText(textEl(), titleEl()))
        }
      }
      const observeResize = () => {
        if (typeof ResizeObserver === 'undefined' || !el) return
        if (el.__wereadResizeObserver) return
        el.__wereadResizeObserver = new ResizeObserver(() => {
          fitText(textEl(), titleEl())
        })
        el.__wereadResizeObserver.observe(el)
      }
      let currentCoverSrc = ''
      let currentTheme = ''
      const drawCover = () => {
        if (!currentCoverSrc) {
          coverWrap.hidden = true
          fitText(textEl(), titleEl())
          return
        }
        const img = new Image()
        img.onload = () => {
          const theme = root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
          currentTheme = theme
          const isPixel = theme === 'pixel'
          const naturalW = img.naturalWidth || 250
          const naturalH = img.naturalHeight || 346
          const ratio = naturalW / naturalH
          coverWrap.hidden = false
          const targetH = Math.max(1, Math.round(coverWrap.clientHeight || 724))
          const targetW = Math.max(1, Math.round(coverWrap.clientWidth || targetH * ratio))
          cover.width = targetW
          cover.height = targetH
          const ctx = cover.getContext('2d')
          ctx.imageSmoothingEnabled = true
          ctx.drawImage(img, 0, 0, targetW, targetH)
          if (isPixel) {
            const blockSize = 4
            try {
              const imgData = ctx.getImageData(0, 0, targetW, targetH)
              const data = imgData.data
              for (let y = 0; y < targetH; y += blockSize) {
                for (let x = 0; x < targetW; x += blockSize) {
                  const sampleX = Math.min(x + (blockSize >> 1), targetW - 1)
                  const sampleY = Math.min(y + (blockSize >> 1), targetH - 1)
                  const sampleIdx = (sampleY * targetW + sampleX) * 4
                  const r = data[sampleIdx]
                  const g = data[sampleIdx + 1]
                  const b = data[sampleIdx + 2]
                  const a = data[sampleIdx + 3]
                  for (let dy = 0; dy < blockSize; dy++) {
                    const py = y + dy
                    if (py >= targetH) break
                    const rowOffset = py * targetW
                    for (let dx = 0; dx < blockSize; dx++) {
                      const px = x + dx
                      if (px >= targetW) break
                      const idx = (rowOffset + px) * 4
                      data[idx] = r
                      data[idx + 1] = g
                      data[idx + 2] = b
                      data[idx + 3] = a
                    }
                  }
                }
              }
              ctx.putImageData(imgData, 0, 0)
            } catch { /* fallback to standard drawImage on security/buffer error */ }
          }
          coverWrap.hidden = false
          fitText(textEl(), titleEl())
        }
        img.onerror = () => {
          coverWrap.hidden = true
          fitText(textEl(), titleEl())
        }
        img.src = currentCoverSrc
      }
      const render = (state) => {
        const title = el.querySelector('.weread-title')
        const text = el.querySelector('.weread-text')
        if (!title || !text) return
        const highlight = state.highlight
        body.classList.toggle('weread-unconfigured', state.status === 'unconfigured')
        const newCover = highlight?.cover || ''
        if (newCover !== currentCoverSrc) {
          currentCoverSrc = newCover
          drawCover()
        }
        if (state.status === 'unconfigured') {
          title.textContent = 'Not configured'
          text.textContent = 'Set WEREAD_API_KEY to sync'
        } else if (highlight) {
          title.textContent = `——《${highlight.title}》${highlight.author ? `· ${highlight.author}` : ''}`
          text.textContent = highlight.markText
        } else {
          title.textContent = state.status === 'error' ? 'Sync unavailable' : 'No highlights'
          text.textContent = state.error || 'No highlights available'
        }
        scheduleFit()
      }
      const refresh = () => root.odkPlatform?.getWeReadHighlight?.().then(render).catch(() => render({ status: 'error', error: 'Sync failed' }))
      observeResize()
      refresh()
      let tickCount = 0
      ctx.onTick(() => {
        const theme = root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
        if (theme !== currentTheme && currentCoverSrc) {
          drawCover()
        }
        scheduleFit()
        tickCount = (tickCount + 1) % 60
        if (tickCount === 1) refresh()
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
