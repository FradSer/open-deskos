'use strict'

// Revision acceptance launches four Electron processes per surface. It needs
// one representative combination to compare rendered consumers. The complete
// rendering matrix stays with the dedicated full-matrix gate.
const MATRIX_ENV = 'ODK_SURFACE_MATRIX'
const REPRESENTATIVE = 'representative'
const FULL = 'full'

function mode(env = process.env) {
  return env[MATRIX_ENV] === REPRESENTATIVE ? REPRESENTATIVE : FULL
}

function representative(env = process.env) {
  return mode(env) === REPRESENTATIVE
}

function select(values, env = process.env) {
  return representative(env) ? values.slice(0, 1) : values
}

module.exports = { MATRIX_ENV, REPRESENTATIVE, FULL, mode, representative, select }
