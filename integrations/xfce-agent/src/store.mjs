import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LIMIT = 1024 * 1024;
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid()))) throw Error('Private runtime directory required.');
}
async function readPrivate(path) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw Error('Invalid private runtime file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (entry.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || entry.ino !== info.ino || info.size > LIMIT || (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid()))) throw Error('Invalid private runtime file.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
const alive = pid => {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};

/** The state owner never steals a live or incomplete lock. */
export async function openDesktopStore(directory) {
  directory = resolve(directory);
  await privateDirectory(directory);
  const evidenceDirectory = join(directory, 'evidence');
  await privateDirectory(evidenceDirectory);
  const lock = join(directory, 'owner.json');
  const claim = join(directory, 'recovery.lock');
  const identity = { pid: process.pid, nonce: randomUUID() };
  async function createOwner() {
    const file = await open(lock, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(identity)); await file.sync(); }
    finally { await file.close(); }
  }
  try { await createOwner(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw Error('Runtime ownership unavailable.');
    let recovery;
    try {
      recovery = await open(claim, 'wx', 0o600);
      // Re-read after acquiring the recovery gate. Another owner may now exist.
      const previous = await readPrivate(lock);
      if (alive(previous.pid)) throw Error('Desktop runtime already has an owner.');
      await unlink(lock);
      await createOwner();
    } catch { throw Error('Desktop runtime already has an owner or requires lock recovery.'); }
    finally { if (recovery) { await recovery.close(); await unlink(claim); } }
  }
  let tail = Promise.resolve(), closed = false;
  const filename = join(directory, 'state.json');
  async function releaseOwner() {
    const owner = await readPrivate(lock);
    if (owner.nonce !== identity.nonce) throw Error('Runtime ownership changed.');
    await unlink(lock);
  }
  async function atomic(value) {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > LIMIT) throw Error('Runtime state capacity reached.');
    try { await lstat(filename); await readPrivate(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = join(directory, '.state-' + randomUUID());
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    try {
      await rename(temporary, filename);
      if (process.platform !== 'win32') {
        const parent = await open(directory, 'r');
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return {
    directory, evidenceDirectory,
    async read() {
      try { return await readPrivate(filename); }
      catch (error) { if (error.code === 'ENOENT') return { version: 1, tasks: [] }; throw Error('Runtime state is unavailable.'); }
    },
    write(value) {
      if (closed) return Promise.reject(Error('Runtime storage is closed.'));
      const copy = structuredClone(value);
      const next = tail.then(() => atomic(copy));
      // A failed write fences future writes until the caller closes the runtime.
      tail = next;
      void next.catch(() => {});
      return next;
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await tail; } finally { await releaseOwner(); }
    },
  };
}
