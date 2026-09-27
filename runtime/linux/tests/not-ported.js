'use strict'

// A Windows Shell Host ports the base Shell and the user-application lifecycle.
// The rest of this runtime — the Unix-socket links, POSIX file ownership and
// modes, and the CM5 deployment tooling — is not ported there (see
// docs/WINDOWS_HOST.md), so the suites and assertions that exercise it state
// that instead of failing as if the code were broken.
//
// Every guard is keyed on the host, never on a build flag, so the reference host
// runs every suite and the ports stay honest about what they do not cover.

const REASONS = {
  'unix-socket': 'Unix domain sockets are not ported to a Windows Shell Host',
  'posix-ownership': 'POSIX file ownership is not ported to a Windows Shell Host',
  'posix-modes': 'POSIX file modes are not enforced on a Windows Shell Host; the profile ACL carries that protection instead',
  symlinks: 'Creating a symlink needs elevation or Developer Mode on a Windows Shell Host, so a link-based attack cannot be staged there',
  'cm5-tooling': 'CM5 deployment and acceptance tooling does not run on a Windows Shell Host',
  'process-inspection': 'A Windows Shell Host reports process inspection through its own source, so this unavailable-inspection simulation does not apply',
}

function isWindowsHost() {
  return process.platform === 'win32'
}

/**
 * Skip a whole suite on a Windows Shell Host. Returns true when the caller
 * should stop registering tests, so a file starts with:
 *
 *   const { notPortedOnWindows } = require('./not-ported')
 *   if (notPortedOnWindows(require('node:test').test, 'unix-socket')) return
 */
function notPortedOnWindows(test, kind = 'unix-socket') {
  if (!isWindowsHost()) return false
  test(`not ported to a Windows Shell Host (${kind})`, { skip: REASONS[kind] || kind }, () => {})
  return true
}

/**
 * The reason one assertion cannot hold on a Windows Shell Host, or `false` where
 * it can. Used for the few tests that are otherwise worth running there.
 */
function posixOnlyReason(kind = 'posix-modes') {
  return isWindowsHost() ? (REASONS[kind] || kind) : false
}

module.exports = { notPortedOnWindows, posixOnlyReason, REASONS }
