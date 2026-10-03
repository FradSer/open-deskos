;
(function (root) {
  'use strict'

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const NO_BRIEFING = 'No desk briefing is available.'

  function appendParts(doc, clause, parts) {
    for (const part of parts) {
      if (!part.emphasis) {
        clause.append(doc.createTextNode(part.text))
        continue
      }
      const signal = doc.createElement('b')
      if (part.icon) {
        const iconHost = doc.createElement('span')
        iconHost.innerHTML = part.icon
        signal.append(...iconHost.childNodes)
      }
      signal.append(doc.createTextNode(part.text))
      clause.append(signal)
    }
  }

  function renderBriefing(el, statements) {
    const doc = el.ownerDocument
    const narrative = el.querySelector('#dash-narrative')
    narrative.replaceChildren()
    if (statements.length === 0) {
      const clause = doc.createElement('span')
      clause.className = 'dash-clause'
      clause.textContent = NO_BRIEFING
      narrative.append(clause)
      return
    }
    for (const statement of statements) {
      const clause = doc.createElement('span')
      clause.className = 'dash-clause'
      clause.dataset.briefing = statement.id
      appendParts(doc, clause, statement.parts)
      narrative.append(clause)
    }
  }

  root.odkPlugins.register({
    id: 'odk.page.dashboard',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'display',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="dash">
          <header class="dash-head">
            <div class="dash-wd" id="dash-wd"></div>
            <div class="dash-date text-right">
              <span id="dash-md"></span>
              <span id="dash-y"></span>
            </div>
          </header>
          <p class="dash-narrative" id="dash-narrative"></p>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')

      renderBriefing(el, ctx.briefing.list())
      ctx.trackCleanup?.(ctx.briefing.subscribe((statements) => renderBriefing(el, statements)))
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)