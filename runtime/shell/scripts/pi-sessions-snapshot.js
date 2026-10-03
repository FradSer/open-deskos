#!/usr/bin/env node
const { scanPiSessions } = require('../src/pi-sessions')

scanPiSessions({ strictProcessInspection: true }).then((snapshot) => {
  process.stdout.write(`${JSON.stringify(snapshot)}\n`)
}).catch(() => {
  process.stderr.write('Pi snapshot collection failed\n')
  process.exitCode = 1
})
