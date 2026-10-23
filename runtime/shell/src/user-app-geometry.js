const { isDeepStrictEqual } = require('node:util')

// Only the trusted Shell frame supplies measured grid geometry. Package frames have no bridge.
function createDesktopGeometry() {
  let current = null
  return {
    read: () => current,
    update(pages) {
      if (!Array.isArray(pages) || pages.length > 64) return false
      const ids = new Set()
      for (const page of pages) {
        if (!page || typeof page.id !== 'string' || page.id.length > 128 || ids.has(page.id)
          || !Number.isInteger(page.columns) || page.columns < 0 || page.columns > 32
          || !Number.isInteger(page.rows) || page.rows < 0 || page.rows > 32
          || !Array.isArray(page.occupied) || page.occupied.length > 64) return false
        if ((!page.columns || !page.rows) && (page.columns !== 0 || page.rows !== 0 || page.occupied.length)) return false
        if (page.index !== undefined && (!Number.isInteger(page.index) || page.index < 1 || page.index > 64)) return false
        ids.add(page.id)
        const widgets = new Set()
        for (const item of page.occupied) {
          if (!item || typeof item.id !== 'string' || item.id.length > 128 || widgets.has(item.id)) return false
          widgets.add(item.id)
          for (const value of [item.col, item.row]) {
            const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(value)
            if (typeof value !== 'string' || value.length > 32 || !match || +match[1] < 1 || +match[1] > 32 || (match[2] && (+match[2] <= +match[1] || +match[2] > 33))) return false
          }
        }
      }
      const next = pages.map(({ id, index, columns, rows, occupied }) => ({ id, ...(index === undefined ? {} : { index }), columns, rows,
        occupied: occupied.map(({ id, col, row }) => ({ id, col, row })) }))
      if (isDeepStrictEqual(current, next)) return false
      current = next
      return true
    },
  }
}
module.exports = { createDesktopGeometry }
