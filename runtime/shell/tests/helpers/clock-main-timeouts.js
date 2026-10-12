'use strict'

function clockMainTimeouts(mode, platform = process.platform, arch = process.arch) {
  // The combined case includes signed calendar, tool, and Pre-order consumers plus shared Tick transitions.
  return mode === 'calendar' && platform === 'linux' && arch === 'arm64'
    ? { fixture: 60000, child: 65000, test: 90000 }
    : { fixture: 40000, child: 45000, test: 60000 }
}

module.exports = { clockMainTimeouts }
