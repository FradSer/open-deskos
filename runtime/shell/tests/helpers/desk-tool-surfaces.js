'use strict'

module.exports = [
  { file: 'settings', id: 'odk.tile.settings', app: 'Settings', state: 'Pending integration',
    readings: ['.widget-status-name', '.w-state', '.widget-status-detail'],
    text: ['Settings', 'Pending', 'Integration not available'] },
  { file: 'chat', id: 'odk.tile.chat', app: 'Chatbot', state: 'Pending integration',
    readings: ['.widget-status-name', '.w-state', '.widget-status-detail'],
    text: ['Chatbot', 'Pending', 'Integration not available'] },
  { file: 'pomodoro', id: 'odk.tile.pomodoro', app: 'Pomodoro', state: 'Not started', minCell: 186,
    readings: ['.pomodoro-state', '.ring-mmss', '.pomodoro-context'],
    text: ['Not started', '--:--', 'Focus'] },
]
