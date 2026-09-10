;
(function (root) {
  'use strict'

  // Pre-order opens 5:00 a.m. Pacific on Oct 16 (PDT, UTC-7).
  const TARGET_MS = Date.UTC(2026, 9, 16, 12, 0, 0)

  // Art-directed focus window in normalized source coordinates. The hero shot
  // places the device over an empty white studio floor whose upper edge dips to
  // 0.76 of the height at the centre; the figure stops just above it so the
  // product rests on the panel rule instead of bleeding white into it.
  const FOCUS = { x: 0.1, y: 0, w: 0.8, h: 0.76 }

  function remaining(nowMs) {
    const diff = TARGET_MS - nowMs
    if (diff <= 0) return null
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    return { days, hours }
  }

  root.odkPlugins.register({
    id: 'odk.tile.preorder',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Pre-order',
    state: 'Live',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-signal preorder-body">
          <div class="preorder-figure" aria-hidden="true">
            <canvas class="preorder-cover"></canvas>
          </div>
          <div class="preorder-panel">
            <p class="preorder-count" aria-live="off"><span class="preorder-group"><strong class="preorder-num">--</strong><span class="preorder-unit">d</span></span><span class="preorder-group"><strong class="preorder-num">--</strong><span class="preorder-unit">h</span></span></p>
            <p class="preorder-label">Pre-order &middot; 5:00 a.m. PT 10.16</p>
          </div>
        </div>`
      const count = el.querySelector('.preorder-count')
      const coverWrap = el.querySelector('.preorder-figure')
      const cover = el.querySelector('.preorder-cover')
      let currentTheme = ''
      const drawHero = () => {
        const img = new Image()
        img.onload = () => {
          const theme = root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
          currentTheme = theme
          const targetH = Math.max(1, Math.round(coverWrap.clientHeight || 434))
          const targetW = Math.max(1, Math.round(coverWrap.clientWidth || 724))
          cover.width = targetW
          cover.height = targetH
          const ctx2d = cover.getContext('2d')
          ctx2d.imageSmoothingEnabled = true
          // Cover-fit the focus window without distortion: scale it to fill the
          // box, then center-crop whichever axis overflows.
          const iw = img.naturalWidth || targetW
          const ih = img.naturalHeight || targetH
          const fx = iw * FOCUS.x
          const fy = ih * FOCUS.y
          const fw = iw * FOCUS.w
          const fh = ih * FOCUS.h
          const scale = Math.max(targetW / fw, targetH / fh)
          const sw = targetW / scale
          const sh = targetH / scale
          ctx2d.drawImage(img, fx + (fw - sw) / 2, fy + (fh - sh) / 2, sw, sh, 0, 0, targetW, targetH)
          if (theme === 'pixel') {
            const blockSize = 4
            try {
              const imgData = ctx2d.getImageData(0, 0, targetW, targetH)
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
              ctx2d.putImageData(imgData, 0, 0)
            } catch { /* fallback to standard drawImage on security/buffer error */ }
          }
        }
        img.src = 'assets/hero-preorder.jpg'
      }
      drawHero()
      let shown = ''
      ctx.onTick((now) => {
        const theme = root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
        if (theme !== currentTheme) drawHero()
        const left = remaining(now instanceof Date ? now.getTime() : Date.now())
        const key = left ? `${left.days}d${left.hours}h` : 'open'
        if (key === shown) return
        shown = key
        count.classList.toggle('is-open', !left)
        count.textContent = ''
        if (!left) {
          count.textContent = 'Open now'
          return
        }
        for (const [value, unit] of [[left.days, 'd'], [left.hours, 'h']]) {
          const group = document.createElement('span')
          group.className = 'preorder-group'
          const num = document.createElement('strong')
          num.className = 'preorder-num'
          num.textContent = value
          const unitEl = document.createElement('span')
          unitEl.className = 'preorder-unit'
          unitEl.textContent = unit
          group.append(num, unitEl)
          count.append(group)
        }
      })
    },
  })

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TARGET_MS, remaining, FOCUS }
  }
})(typeof window !== 'undefined' ? window : globalThis)
