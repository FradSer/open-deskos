;(function (root) {
  'use strict'

  // Layout and CSS retain the public visual contract; this entry owns behavior.
  root.odkRendererDevelopment.define({
    id: 'odk.tile.weread', manifest: { schemaVersion: 1, minCell: 186 },
    kind: 'tile', css: 'plugins/weread.css', app: 'WeRead', state: 'Loading', interaction: 'display-only', opensApp: 'weread',
    mount(element, context) {
      element.innerHTML = `
        <div class="widget-signal weread-body odk-col">
          <div class="weread-content">
            <div class="weread-copy">
              <p class="weread-text" role="region" aria-label="Highlight excerpt">Syncing highlights...</p>
              <div class="weread-foot">
                <div class="weread-meta">
                  <strong class="weread-title">Loading</strong>
                  <span class="weread-author" hidden></span>
                  <span class="weread-date" hidden></span>
                </div>
                <div class="weread-cover-wrap" hidden>
                  <canvas class="weread-cover"></canvas>
                </div>
              </div>
            </div>
          </div>
        </div>`
      const find = selector => element.querySelector(`.weread-${selector}`)
      const nodes = Object.fromEntries(['body', 'copy', 'text', 'foot', 'title', 'author', 'date', 'cover', 'cover-wrap']
        .map(name => [name, find(name)]))
      let released = false
      let observer
      let frame = null
      let image = null
      let coverSource = ''
      let drawnTheme = ''
      let loadingTheme = null
      const alive = () => !released && !context.signal?.aborted
      const theme = () => root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
      function discardImage() {
        loadingTheme = null
        if (!image) return
        image.onload = image.onerror = null
        image.src = ''
        image = null
      }
      context.trackCleanup(() => {
        released = true
        discardImage()
        if (frame !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frame)
          frame = null
        }
        observer?.disconnect()
      })
      function fit() {
        if (!alive()) return
        const styles = getComputedStyle(nodes.copy)
        const gap = Number.parseFloat(styles.rowGap)
        const available = nodes.copy.clientHeight - nodes.foot.offsetHeight
          - (Number.parseFloat(styles.paddingTop) || 0) - (Number.parseFloat(styles.paddingBottom) || 0)
          - (Number.isFinite(gap) ? gap : 28)
        if (available <= 0) return
        const columns = Math.max(4, Math.sqrt(Math.max(1, nodes.text.textContent.length)) * 2.2)
        let size = Math.max(14, Math.min(element.clientWidth >= 800 && element.clientHeight >= 800 ? 96 : 72, (nodes.copy.clientWidth > 0 ? nodes.copy.clientWidth : 900) / columns))
        nodes.text.style.fontSize = `${size}px`
        for (let attempt = 0; attempt < 60 && size > 14 && nodes.text.scrollHeight > available; attempt++) {
          size = Math.max(14, size - 2)
          nodes.text.style.fontSize = `${size}px`
        }
        nodes.text.tabIndex = nodes.text.scrollHeight > nodes.text.clientHeight + 1 ? 0 : -1
      }
      function schedule() {
        if (!alive()) return
        fit()
        if (frame === null && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(() => {
          frame = null
          fit()
        })
      }
      nodes.text.addEventListener('keydown', event => {
        if (!alive() || nodes.text.scrollHeight <= nodes.text.clientHeight + 1) return
        if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
        event.stopPropagation()
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          nodes.text.scrollTop = event.key === 'Home' ? 0 : nodes.text.scrollHeight
        }
      })
      function draw() {
        if (!alive()) return
        discardImage()
        if (!coverSource) { nodes['cover-wrap'].hidden = true; fit(); return }
        const candidate = new Image()
        image = candidate
        loadingTheme = theme()
        const current = () => alive() && image === candidate
        candidate.onerror = () => {
          if (!current()) return
          loadingTheme = null
          nodes['cover-wrap'].hidden = true
          fit()
        }
        candidate.onload = () => {
          if (!current()) return
          loadingTheme = null
          drawnTheme = theme()
          const width = candidate.naturalWidth || 250
          const height = candidate.naturalHeight || 346
          nodes['cover-wrap'].hidden = false
          const targetWidth = Math.max(1, Math.round(nodes['cover-wrap'].clientWidth || 168))
          const targetHeight = Math.max(1, Math.round(targetWidth * height / width))
          const canvas = nodes.cover
          canvas.width = targetWidth
          canvas.height = targetHeight
          canvas.style.aspectRatio = `${width} / ${height}`
          const paint = canvas.getContext('2d')
          paint.imageSmoothingEnabled = true
          paint.imageSmoothingQuality = 'high'
          paint.drawImage(candidate, 0, 0, targetWidth, targetHeight)
          if (drawnTheme === 'pixel') {
            try {
              const pixels = paint.getImageData(0, 0, targetWidth, targetHeight)
              const original = new Uint8ClampedArray(pixels.data)
              for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
                const sampleX = Math.min(Math.floor(x / 2) * 2 + 1, targetWidth - 1)
                const sampleY = Math.min(Math.floor(y / 2) * 2 + 1, targetHeight - 1)
                const offset = (sampleY * targetWidth + sampleX) * 4
                pixels.data.set(original.subarray(offset, offset + 4), (y * targetWidth + x) * 4)
              }
              paint.putImageData(pixels, 0, 0)
            } catch { /* Keep the decoded cover if pixel processing is unavailable. */ }
          }
          fit()
        }
        candidate.src = coverSource
      }
      function date(value) {
        if (!value) return ''
        const time = new Date(value < 1e12 ? value * 1000 : value)
        if (Number.isNaN(time.getTime())) return ''
        return [time.getFullYear(), String(time.getMonth() + 1).padStart(2, '0'), String(time.getDate()).padStart(2, '0')].join('-')
      }
      function display(state) {
        if (!alive()) return
        const highlight = state.highlight
        nodes.body.classList.toggle('weread-unconfigured', state.status === 'unconfigured')
        const nextCover = highlight?.cover || ''
        if (nextCover !== coverSource) { coverSource = nextCover; draw() }
        const fields = state.status === 'unconfigured'
          ? ['Not configured', '', '', 'Set WEREAD_API_KEY to sync']
          : highlight ? [String(highlight.title || '').replace(/^[\s《〈【『]+|[\s》〉】』]+$/g, '').trim() || 'WeRead',
            highlight.author || '', date(highlight.createTime), highlight.markText]
          : [state.status === 'error' ? 'Sync unavailable' : 'No highlights', '', '', state.error || 'No highlights available']
        ;['title', 'author', 'date', 'text'].forEach((name, index) => { nodes[name].textContent = fields[index] })
        nodes.author.hidden = !nodes.author.textContent
        nodes.date.hidden = !nodes.date.textContent
        schedule()
      }
      function refresh() {
        if (!alive()) return
        return root.odkPlatform?.getWeReadHighlight?.().then(display).catch(() => display({ status: 'error', error: 'Sync failed' }))
      }
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(fit)
        observer.observe(element)
      }
      refresh()
      let ticks = 0
      context.onTick(() => {
        if (!alive()) return
        const selectedTheme = theme()
        if (coverSource && selectedTheme !== drawnTheme && loadingTheme !== selectedTheme) draw()
        schedule()
        if (ticks++ % 60 === 0) refresh()
      })
      if (element.dataset) element.dataset.fixtureSurface = 'independent-weread'
    },
  })
})(window)
