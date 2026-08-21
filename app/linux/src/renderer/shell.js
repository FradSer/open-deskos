const SWIPE_THRESHOLD_RATIO = 0.18
const DRAG_SUPPRESS_PX = 10

function pad2(value) {
  return String(value).padStart(2, '0')
}

function startClock() {
  const timeNodes = document.querySelectorAll('.sb-time, .hero-time')
  const dateNodes = document.querySelectorAll('.sb-date, .hero-date')
  const yearFill = document.getElementById('year-fill')

  function tick() {
    const now = new Date()
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    const date = `${now.getMonth() + 1}/${now.getDate()}`
    for (const node of timeNodes) node.textContent = hhmm
    for (const node of dateNodes) node.textContent = date
    if (yearFill) {
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      const endOfYear = new Date(now.getFullYear() + 1, 0, 1)
      const ratio = (now - startOfYear) / (endOfYear - startOfYear)
      yearFill.style.width = `${(ratio * 100).toFixed(2)}%`
    }
  }

  tick()
  setInterval(tick, 1000)
}

function createPager(viewport, track) {
  let index = 0
  let startX = null
  let dx = 0
  let dragged = false

  function pageCount() {
    return track.children.length
  }

  function pageWidth() {
    return viewport.clientWidth
  }

  function dots() {
    return document.querySelectorAll('#dots .dot')
  }

  function renderDots() {
    for (const [i, dot] of [...dots()].entries()) {
      dot.classList.toggle('active', i === index)
    }
  }

  function setIndex(next) {
    index = Math.max(0, Math.min(pageCount() - 1, next))
    track.style.transform = `translateX(${-index * pageWidth()}px)`
    renderDots()
  }

  function buildDots(container) {
    container.replaceChildren()
    for (let i = 0; i < pageCount(); i += 1) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      container.append(dot)
    }
    renderDots()
  }

  viewport.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return
    startX = event.clientX
    dx = 0
    dragged = false
    track.classList.add('dragging')
    viewport.setPointerCapture(event.pointerId)
  })

  viewport.addEventListener('pointermove', (event) => {
    if (startX === null || !event.isPrimary) return
    dx = event.clientX - startX
    if (Math.abs(dx) > DRAG_SUPPRESS_PX) dragged = true
    track.style.transform = `translateX(${dx - index * pageWidth()}px)`
  })

  function endDrag() {
    if (startX === null) return
    track.classList.remove('dragging')
    const threshold = pageWidth() * SWIPE_THRESHOLD_RATIO
    if (dx < -threshold) setIndex(index + 1)
    else if (dx > threshold) setIndex(index - 1)
    else setIndex(index)
    startX = null
    dx = 0
    setTimeout(() => { dragged = false }, 0)
  }

  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)

  viewport.addEventListener(
    'click',
    (event) => {
      if (dragged) {
        event.stopPropagation()
        event.preventDefault()
      }
    },
    true,
  )

  return { setIndex, buildDots }
}

function openAppView(title, view, appTitleNode) {
  appTitleNode.textContent = title
  view.hidden = false
}

function main() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('kiosk') === '1') document.body.classList.add('kiosk')

  const viewport = document.getElementById('pages-viewport')
  const track = document.getElementById('pages-track')
  const pager = createPager(viewport, track)
  pager.buildDots(document.getElementById('dots'))

  const appView = document.getElementById('app-view')
  const appTitle = document.getElementById('app-title')
  const back = document.getElementById('app-back')

  for (const tile of document.querySelectorAll('.tile')) {
    tile.addEventListener('click', () => openAppView(tile.dataset.app, appView, appTitle))
  }
  back.addEventListener('click', () => { appView.hidden = true })

  startClock()
}

main()
