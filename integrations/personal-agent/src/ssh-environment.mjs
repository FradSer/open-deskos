const allowed = new Set(['path', 'home', 'userprofile', 'homedrive', 'homepath', 'systemroot', 'windir', 'programdata', 'temp', 'tmp', 'ssh_auth_sock'])

/** Keep provider and application settings out of SSH's configurable SendEnv.
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {NodeJS.ProcessEnv}
 */
export function sshEnvironment(source = process.env) {
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allowed.has(name.toLowerCase()))), LC_ALL: 'C' }
}
