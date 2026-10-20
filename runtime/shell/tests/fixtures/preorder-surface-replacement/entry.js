;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.preorder', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 186 },
    kind: 'tile', app: 'Pre-order', state: 'Live', interaction: 'display-only', opensApp: 'preorder',
    mount(element, context) {
      // Static markup, artwork, and Shell styles are shared. Rendering is independent.
      element.innerHTML = `
        <div class="widget-signal preorder-body">
          <div class="preorder-figure" aria-hidden="true">
            <canvas class="preorder-cover"></canvas>
          </div>
          <div class="preorder-panel">
            <span class="widget-heading preorder-heading">Pre-order</span>
            <p class="preorder-count" aria-live="off"><span class="preorder-group"><strong class="preorder-num">--</strong><span class="preorder-unit">d</span></span><span class="preorder-group"><strong class="preorder-num">--</strong><span class="preorder-unit">h</span></span></p>
            <p class="preorder-label">5:00 a.m. PT · October 16</p>
          </div>
        </div>`
      const count = element.querySelector('.preorder-count')
      const figure = element.querySelector('.preorder-figure')
      const canvas = element.querySelector('.preorder-cover')
      let released = false, renderedTheme = '', renderedCount = ''
      context.trackCleanup(() => { released = true })
      const inactive = () => released || context.signal?.aborted
      const theme = () => root.odkTheme?.get?.() || document.documentElement.dataset.theme || ''
      const paint = () => {
        if (inactive()) return
        const image = new Image()
        image.onload = () => {
          if (inactive()) return
          renderedTheme = theme()
          const width = Math.max(1, Math.round(figure.clientWidth || 724))
          const height = Math.max(1, Math.round(figure.clientHeight || 434))
          canvas.width = width
          canvas.height = height
          const sourceWidth = image.naturalWidth || width
          const sourceHeight = image.naturalHeight || height
          // The focus region is a static artwork contract. Derive the source crop independently.
          const regionWidth = sourceWidth * 0.8, regionHeight = sourceHeight * 0.76
          // Retain the cover scale's operation order because raster sampling observes floating-point differences.
          const zoom = Math.max(width / regionWidth, height / regionHeight)
          const cropWidth = width / zoom, cropHeight = height / zoom
          const drawing = canvas.getContext('2d')
          drawing.imageSmoothingEnabled = true
          drawing.drawImage(image, sourceWidth * 0.1 + (regionWidth - cropWidth) / 2,
            (regionHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height)
          if (renderedTheme !== 'pixel') return
          try {
            const pixels = drawing.getImageData(0, 0, width, height)
            const original = new Uint8ClampedArray(pixels.data)
            for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
              const sampleColumn = Math.min(Math.floor(column / 4) * 4 + 2, width - 1)
              const sampleRow = Math.min(Math.floor(row / 4) * 4 + 2, height - 1)
              const source = (sampleRow * width + sampleColumn) * 4
              const destination = (row * width + column) * 4
              for (let channel = 0; channel < 4; channel++) pixels.data[destination + channel] = original[source + channel]
            }
            drawing.putImageData(pixels, 0, 0)
          } catch { /* Preserve the standard image when pixel access is unavailable. */ }
        }
        image.src = 'assets/hero-preorder.jpg'
      }
      paint()
      context.onTick(now => {
        if (inactive()) return
        if (theme() !== renderedTheme) paint()
        const time = now instanceof Date ? now.getTime() : Date.now()
        const hours = Math.floor((Date.UTC(2026, 9, 16, 12) - time) / 3600000)
        const opened = time >= Date.UTC(2026, 9, 16, 12)
        const values = [Math.floor(hours / 24), hours % 24]
        const key = opened ? 'open' : values.join(':')
        if (key === renderedCount) return
        renderedCount = key
        count.classList.toggle('is-open', opened)
        count.textContent = ''
        if (opened) { count.textContent = 'Open now'; return }
        values.forEach((value, index) => {
          const group = document.createElement('span'), numeral = document.createElement('strong'), unit = document.createElement('span')
          group.className = 'preorder-group'
          numeral.className = 'preorder-num'
          numeral.textContent = value
          unit.className = 'preorder-unit'
          unit.textContent = ['d', 'h'][index]
          group.append(numeral, unit)
          count.append(group)
        })
      })
    },
  })
})(window)
