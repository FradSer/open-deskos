const { collectWidgetContent } = require('./helpers/widget-density.js')

async function verifyCollector(win) {
  const results = await win.webContents.executeJavaScript(`(() => {
    const container = document.createElement('div')
    document.body.append(container)
    const widget = () => {
      const el = document.createElement('div')
      el.className = 'widget'
      el.dataset.widget = 'density-test'
      el.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:100px;padding:0;display:block;border-style:solid;border-width:2px 4px 6px 8px;overflow:hidden'
      container.append(el)
      return el
    }
    try {
      const empty = widget()
      const spacer = document.createElement('div')
      spacer.style.cssText = 'width:80px;height:80px'
      empty.append(spacer)
      const first = (${collectWidgetContent.toString()})().find(el => el.id === 'density-test')
      empty.remove()
      const clipped = widget()
      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'width:12px;height:12px;overflow:hidden'
      const graphic = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      graphic.style.cssText = 'display:block;width:60px;height:60px'
      wrapper.append(graphic)
      clipped.append(wrapper)
      const second = (${collectWidgetContent.toString()})().find(el => el.id === 'density-test')
      return { empty: first.boxes.length === 0, borders: first.frame.x === 8 && first.frame.y === 2 && first.frame.width === 88 && first.frame.height === 92, clipped: second.clipped === true }
    } finally {
      container.remove()
    }
  })()`)
  for (const [name, passed] of Object.entries(results)) {
    if (!passed) throw new Error(`Density DOM regression failed: ${name}`)
  }
}

module.exports = { verifyCollector }
