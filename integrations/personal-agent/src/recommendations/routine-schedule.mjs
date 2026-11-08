const MINUTE = 60000
const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function minuteOfDay(time) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function validInterval(schedule) {
  return schedule && Object.keys(schedule).sort().join(',') === 'days,end,everyMinutes,start'
    && ['daily', 'weekdays'].includes(schedule.days) && typeof schedule.start === 'string' && typeof schedule.end === 'string'
    && WALL_TIME.test(schedule.start) && WALL_TIME.test(schedule.end)
    && Number.isInteger(schedule.everyMinutes) && schedule.everyMinutes >= 1 && schedule.everyMinutes <= 1440
    && minuteOfDay(schedule.start) < minuteOfDay(schedule.end)
}

export function createIntervalClock(schedule, timeZone) {
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const start = minuteOfDay(schedule.start), end = minuteOfDay(schedule.end), interval = schedule.everyMinutes
  function at(now) {
    const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]))
    return { date: parts.year + '-' + parts.month + '-' + parts.day, weekday: parts.weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) }
  }
  const open = ({ weekday, minute }) => (schedule.days === 'daily' || (weekday !== 'Sat' && weekday !== 'Sun'))
    && minute >= start && minute < end
  let wake
  return {
    slot(now) {
      const time = at(now)
      if (!open(time)) return undefined
      const offset = Math.floor((time.minute - start) / interval) * interval
      return time.date + ':' + String(start + offset).padStart(4, '0')
    },
    nextWake(now, includeClosing = false) {
      if (wake?.includeClosing === includeClosing && now >= wake.from && now < wake.at) return wake.at
      const watchClosing = includeClosing && open(at(now))
      // Scan UTC minutes so daylight-saving changes do not invent a local slot.
      for (let candidate = (Math.floor(now / MINUTE) + 1) * MINUTE; candidate <= now + 8 * 1440 * MINUTE; candidate += MINUTE) {
        const time = at(candidate)
        if (open(time) ? (time.minute - start) % interval === 0 : watchClosing) {
          wake = { from: now, at: candidate, includeClosing }
          return candidate
        }
      }
      return Infinity
    },
  }
}
