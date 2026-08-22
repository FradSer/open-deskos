const SWIPE_THRESHOLD_RATIO = 0.18
const DRAG_SUPPRESS_PX = 10

let geometryRaf = 0
let pagerRef = null

function applyGeometry() {
  const m = odkLayout.compute(window.innerWidth, window.innerHeight)
  const root = document.documentElement.style
  root.setProperty('--status-h', `${m.statusH}px`)
  root.setProperty('--gutter', `${m.gutter}px`)
  root.setProperty('--cell-w', `${m.cellW}px`)
  root.setProperty('--cell-h', `${m.cellH}px`)
  root.setProperty('--radius', `${m.radius}px`)
  root.setProperty('--stroke-w', `${m.stroke}px`)
  root.setProperty('--peek-h', `${m.peekH}px`)
  root.setProperty('--peek-inset', `${m.peekInset}px`)
  root.setProperty('--bar-icon', `${Math.floor(20 * m.fit + 0.5)}px`)
  window.__odkGrid = m
  return m
}

window.addEventListener('resize', () => {
  cancelAnimationFrame(geometryRaf)
  geometryRaf = requestAnimationFrame(() => {
    applyGeometry()
    if (pagerRef) pagerRef.refresh()
  })
})

function pad2(value) {
  return String(value).padStart(2, '0')
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function startClock() {
  const timeNodes = document.querySelectorAll('.sb-time, .hero-time, .w-clock-time')
  const dateNodes = document.querySelectorAll('.hero-date')
  const yearFills = document.querySelectorAll('.meter-fill')

  function tick() {
    const now = new Date()
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    for (const node of timeNodes) node.textContent = hhmm
    for (const node of dateNodes) node.textContent = `${now.getMonth() + 1}/${now.getDate()}`
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const endOfYear = new Date(now.getFullYear() + 1, 0, 1)
    const ratio = (now - startOfYear) / (endOfYear - startOfYear)
    for (const fill of yearFills) fill.style.width = `${(ratio * 100).toFixed(2)}%`
  }

  function tickAlmanac() {
    const now = new Date()
    document.querySelector('.al-weekday').textContent = WEEKDAYS[now.getDay()]
    document.querySelector('.al-day').textContent = now.getDate()
    document.querySelector('.al-month').textContent = `${now.getMonth() + 1} 月`
  }

  tick()
  tickAlmanac()
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

  function setIndex(next) {
    index = Math.max(0, Math.min(pageCount() - 1, next))
    track.style.transform = `translateX(${-index * pageWidth()}px)`
    renderDots()
  }

  function refresh() {
    setIndex(index)
  }

  function renderDots() {
    for (const [i, dot] of [...document.querySelectorAll('#dots .dot')].entries()) {
      dot.classList.toggle('active', i === index)
    }
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
    try {
      viewport.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic pointers (tests) cannot be captured */
    }
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

  return { setIndex, buildDots, refresh }
}

function main() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('kiosk') === '1') document.body.classList.add('kiosk')

  applyGeometry()

  const viewport = document.getElementById('pages-viewport')
  const track = document.getElementById('pages-track')
  const pager = createPager(viewport, track)
  pagerRef = pager
  pager.buildDots(document.getElementById('dots'))

  const appView = document.getElementById('app-view')
  const appTitle = document.getElementById('app-title')

  for (const tile of document.querySelectorAll('.widget')) {
    tile.addEventListener('click', () => {
      appTitle.textContent = tile.dataset.app
      appView.hidden = false
    })
  }
  document.getElementById('app-back').addEventListener('click', () => { appView.hidden = true })

  startClock()
}

main()
