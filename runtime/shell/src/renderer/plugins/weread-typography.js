;(function (root) {
  'use strict'

  const references = new WeakMap()
  // Both reading surfaces fit the same excerpt inside the same copy lane.
  root.odkWeReadTypography = {
    fit(frame, copy, text, foot, source) {
      if (!frame || !copy || !text || !foot) return
      const styles = getComputedStyle(copy)
      const measured = {
        width: copy.clientWidth || 900,
        height: copy.clientHeight,
        padding: (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0),
        gap: Number.isFinite(parseFloat(styles.rowGap)) ? parseFloat(styles.rowGap) : 28,
        ceiling: frame.clientWidth >= 800 && frame.clientHeight >= 800 ? 96 : 72,
        textWidth: getComputedStyle(text).width,
        footWidth: getComputedStyle(foot).width,
        fonts: ['title','author','date'].map(key => {
          const node = copy.querySelector?.('.weread-'+key)
          return node ? getComputedStyle(node).fontSize : null
        }),
        coverWidth: copy.querySelector?.('.weread-cover-wrap') ? getComputedStyle(copy.querySelector('.weread-cover-wrap')).width : null,
      }
      // Keep the visible Widget reference while its page is hidden by the App.
      if (!source && getComputedStyle(frame).visibility !== 'hidden') references.set(frame, measured)
      const basis = references.get(source) || measured
      const previous = {textWidth:text.style.width,footWidth:foot.style.width,maxHeight:foot.style.maxHeight}
      if (basis !== measured) {
        for (const [index,key] of ['title','author','date'].entries()) {
          const node = copy.querySelector('.weread-'+key)
          if (node && basis.fonts[index]) node.style.fontSize = basis.fonts[index]
        }
        const cover = copy.querySelector('.weread-cover-wrap')
        if (cover && basis.coverWidth) cover.style.width = basis.coverWidth
        text.style.width = basis.textWidth
        foot.style.width = basis.footWidth
        foot.style.maxHeight = 'none'
      }
      const height = basis.height - basis.padding - foot.offsetHeight - basis.gap
      const columns = Math.max(4, Math.sqrt(Math.max(1, text.textContent.length)) * 2.2)
      let size = height <= 0 ? 14 : Math.min(basis.ceiling, Math.max(14, basis.width / columns))
      text.style.fontSize = `${size}px`
      let remaining = 60
      while (remaining-- > 0 && size > 14 && text.scrollHeight > height) {
        size = Math.max(14, size - 2)
        text.style.fontSize = `${size}px`
      }
      if (basis !== measured) {
        text.style.width = previous.textWidth
        foot.style.width = previous.footWidth
        foot.style.maxHeight = previous.maxHeight
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
