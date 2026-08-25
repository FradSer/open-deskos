;
(function (root) {
  'use strict'

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  // Sunday-first header, matching the tile's weekday ordering.
  const WEEKDAY_INITIALS = ['日', '一', '二', '三', '四', '五', '六']

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  function monthMatrix(now) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return { leading: first.getDay(), days }
  }

  function renderCalendar(el, now) {
    const { leading, days } = monthMatrix(now)
    const cells = [WEEKDAY_INITIALS.map((wd) => `<span class="cal-wd">${wd}</span>`).join('')]
    for (let i = 0; i < leading; i += 1) cells.push('<span></span>')
    for (let day = 1; day <= days; day += 1) {
      const today = day === now.getDate() ? ' is-today' : ''
      cells.push(`<span class="cal-day${today}">${day}</span>`)
    }
    el.querySelector('#cal-title').textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`
    el.querySelector('.cal-grid').innerHTML = cells.join('')
  }

  root.odkPlugins.register({
    id: 'almanac',
    kind: 'tile',
    app: '日历',
    state: '可查看',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="al-weekday text-odk-red"></span>
        <span class="al-day"></span>
        <span class="al-month"></span>
        <span class="w-state">${this.state}</span>`

      const weekday = el.querySelector('.al-weekday')
      const day = el.querySelector('.al-day')
      const month = el.querySelector('.al-month')
      ctx.onTick((now) => {
        weekday.textContent = WEEKDAYS[now.getDay()]
        day.textContent = now.getDate()
        month.textContent = `${now.getMonth() + 1} 月`
      })
    },

    // Fullscreen month calendar: real dates only — the live month grid with
    // today inverted, no fabricated schedule data.
    appView: {
      mount(el, ctx) {
        el.innerHTML = `
          <div class="cal odk-stack-center">
            <span class="cal-title" id="cal-title"></span>
            <div class="cal-grid"></div>
          </div>`
        let renderedKey = ''
        const renderIfChanged = (now) => {
          const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
          if (key === renderedKey) return
          renderedKey = key
          renderCalendar(el, now)
        }
        const unsub = ctx.onTick(renderIfChanged)
        return unsub
      },
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
