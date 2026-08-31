;
(function (root) {
  'use strict'

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']

  const ICONS = {
    calendar: '<svg data-tabler="calendar" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path d="M16 3l0 4" /><path d="M8 3l0 4" /><path d="M4 11l16 0" /><path d="M8 15h.01" /><path d="M12 15h.01" /><path d="M16 15h.01" /></svg>',
    task: '<svg data-tabler="square-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3l8 -8" /><path d="M20 12v5a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h9" /></svg>',
    habit: '<svg data-tabler="cloud" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 19a4.5 4.5 0 0 1 -.5 -8.972a5.5 5.5 0 0 1 10.7 -1.26a4 4 0 0 1 1.3 7.758" /></svg>',
    steps: '<svg data-tabler="walk" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v2l-2 1l1 4l-3 2" /><path d="M12 11l4 1l2 3" /><path d="M8 17l-2 3" /><path d="M15 20l-1 -4" /><circle cx="13" cy="3" r="1" /></svg>',
    sleep: '<svg data-tabler="moon-stars" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.132 0 .263 .004 .393 .012a7.5 7.5 0 1 0 8.595 8.595a7.5 7.5 0 0 1 -8.988 -8.607z" /><path d="M16 3l0 2" /><path d="M15 4l2 0" /><path d="M19 7l0 2" /><path d="M18 8l2 0" /></svg>',
  }

  root.odkPlugins.register({
    id: 'dashboard-page',
    kind: 'page',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="dash">
          <header class="dash-head">
            <div class="dash-wd" id="dash-wd"></div>
            <span class="dash-status-dot" aria-label="Status active"></span>
            <div class="dash-date text-right">
              <span id="dash-md"></span>
              <span id="dash-y"></span>
            </div>
          </header>
          <p class="dash-narrative" id="dash-narrative">
            <span>You have ${ICONS.calendar} <b>3 meetings</b>,</span>
            <span>${ICONS.task} <b>2 tasks</b> and ${ICONS.habit} <b>1 habit</b></span>
            <span>today. You're <b>mostly free</b></span>
            <span>after <b>4 pm</b>.</span>
          </p>
          <div class="dash-stats" aria-label="Daily activity">
            <span class="dash-stat dash-stat-steps">${ICONS.steps}<span>4.7K steps</span></span>
            <span class="dash-stat dash-stat-sleep">${ICONS.sleep}<span>7.3 hours</span></span>
          </div>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
