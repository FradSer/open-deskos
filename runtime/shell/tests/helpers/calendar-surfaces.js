'use strict'

module.exports = [
  { name: 'Almanac', file: 'almanac', id: 'odk.tile.almanac', kind: 'tile',
    selector: '[data-widget="odk.tile.almanac"]', className: 'widget widget-display-only w-almanac',
    readings: ['.al-weekday', '.al-day', '.al-month'] },
  { name: 'Year', file: 'year', id: 'odk.tile.year', kind: 'tile',
    selector: '[data-widget="odk.tile.year"]', className: 'widget widget-display-only w-year',
    readings: ['.year-pct', '.year-context', '.meter-fill'] },
  { name: 'State Bar Clock', file: 'status-clock', id: 'odk.status.clock', kind: 'status', slot: 'right',
    selector: '[data-status-plugin="odk.status.clock"]', className: 'status-plugin status-clock',
    readings: ['.sb-time'] },
]
