import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, extname } from 'node:path';

/** @typedef {{profile: 'coding'|'personal', skillPaths: string[], memoryFile?: string, didi?: {environment: 'sandbox'|'production', keyFile: string}}} PersonalConfig */

/** @param {unknown} path @returns {path is string} */
export function isLocalAbsolutePath(path) {
  return typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !/[\x00-\x1f]/.test(path);
}

/** Bounded regular-file reads; never return filesystem error details.
 * @param {string} path @param {number} limit @param {boolean} [privateFile]
 */
export function readLocalFile(path, limit, privateFile = false) {
  let fd;
  try {
    if (!isLocalAbsolutePath(path) || realpathSync(path) !== path) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > limit || (privateFile && ((info.mode & 0o077) !== 0 || info.nlink !== 1 || info.uid !== process.getuid?.()))) throw new Error();
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > limit) throw new Error();
    return buffer.subarray(0, size).toString('utf8');
  } catch {
    throw new Error('Local file is unavailable or unsafe.');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** @param {unknown} value @param {string[]} keys */
function objectWithKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

/** Configuration is operator-owned; no model input belongs here.
 * @param {Record<string, string | undefined>} [env] @returns {Promise<PersonalConfig>}
 */
export async function loadPersonalConfig(env = process.env) {
  if (env.ODESK_VOICE_AGENT_CONFIG === undefined) return { profile: 'coding', skillPaths: [] };
  try {
    const value = JSON.parse(readLocalFile(env.ODESK_VOICE_AGENT_CONFIG, 16384));
    if (!objectWithKeys(value, ['profile', 'skillPaths', 'memoryFile', 'didi']) || !['coding', 'personal'].includes(value.profile)) throw new Error();
    const skillPaths = value.skillPaths ?? [];
    if (!Array.isArray(skillPaths) || skillPaths.length > 32 || new Set(skillPaths).size !== skillPaths.length || !skillPaths.every((path) => isLocalAbsolutePath(path) && extname(path) === '.md')) throw new Error();
    if (value.profile === 'personal' && !isLocalAbsolutePath(value.memoryFile)) throw new Error();
    if (value.memoryFile !== undefined && !isLocalAbsolutePath(value.memoryFile)) throw new Error();
    if (value.didi !== undefined && (!objectWithKeys(value.didi, ['environment', 'keyFile']) || !['sandbox', 'production'].includes(value.didi.environment) || !isLocalAbsolutePath(value.didi.keyFile))) throw new Error();
    if (value.profile === 'coding' && (skillPaths.length || value.memoryFile !== undefined || value.didi !== undefined)) throw new Error();
    if (value.memoryFile === env.ODESK_VOICE_AGENT_CONFIG || skillPaths.includes(value.memoryFile) || skillPaths.includes(env.ODESK_VOICE_AGENT_CONFIG) || (value.didi && (skillPaths.includes(value.didi.keyFile) || value.didi.keyFile === value.memoryFile || value.didi.keyFile === env.ODESK_VOICE_AGENT_CONFIG))) throw new Error();
    for (const path of skillPaths) readLocalFile(path, 65536);
    return { ...value, skillPaths };
  } catch {
    throw new Error('Invalid personal assistant configuration. Check profile, reviewed skill paths, private memory path and DiDi settings.');
  }
}
