import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { linkSync, lstatSync, readFileSync, realpathSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sentinel = Buffer.from('fika.workspace-mutex.v2\n');
const linuxLocalFilesystems = new Set([0xef53, 0x58465342, 0x9123683e, 0x794c7630, 0x01021994]);

export class WorkspaceMutexError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.code = code;
  }
}

function sqlite() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch (error) {
    throw new WorkspaceMutexError('WORKSPACE_MUTEX_UNSUPPORTED', 'The workspace mutex requires Node with built-in SQLite', error);
  }
}

function localStateDirectory(directory) {
  try {
    const resolved = realpathSync.native(directory);
    if (process.platform === 'linux' && linuxLocalFilesystems.has(statfsSync(resolved).type)) return resolved;
    if (process.platform === 'win32' && /^[a-z]:\\/i.test(resolved)) {
      const drive = path.parse(resolved).root.slice(0, 2);
      const tool = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'fsutil.exe');
      const type = execFileSync(tool, ['fsinfo', 'drivetype', drive], { encoding: 'utf8', windowsHide: true }).trim();
      if (type === drive.toUpperCase() + ' - Fixed Drive') return resolved;
    }
  } catch (error) {
    throw new WorkspaceMutexError('WORKSPACE_MUTEX_STORAGE', 'Could not verify the workspace mutex storage', error);
  }
  throw new WorkspaceMutexError('WORKSPACE_MUTEX_UNSUPPORTED', 'The workspace mutex requires supported local storage');
}

function checkRegularFile(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1) {
    throw new WorkspaceMutexError('WORKSPACE_MUTEX_STORAGE', 'Workspace mutex file has an unexpected type or link count');
  }
  return info;
}

function requireSentinel(file) {
  try {
    const info = lstatSync(file);
    if (info.isFile() && info.size === sentinel.length && readFileSync(file).equals(sentinel)) return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new WorkspaceMutexError('WORKSPACE_MUTEX_STORAGE', 'Could not verify the workspace mutex compatibility sentinel', error);
    }
  }
  throw new WorkspaceMutexError('WORKSPACE_MUTEX_LEGACY', 'The workspace mutex compatibility sentinel is absent or unrecognized');
}

// Called only during a governed cutover after writers have drained. No CLI activates it in B1.
export function installWorkspaceMutexSentinel(directory) {
  const resolved = localStateDirectory(directory);
  sqlite();
  const target = path.join(resolved, 'workspaces.lock');
  const pending = path.join(resolved, `workspace-mutex-${randomUUID()}.pending`);
  try {
    writeFileSync(pending, sentinel, { flag: 'wx', mode: 0o600, flush: true });
    try {
      linkSync(pending, target);
    } finally {
      unlinkSync(pending);
    }
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new WorkspaceMutexError('WORKSPACE_MUTEX_LEGACY', 'An existing workspace lock prevents cutover', error);
    }
    throw new WorkspaceMutexError('WORKSPACE_MUTEX_STORAGE', 'Could not install the workspace mutex compatibility sentinel', error);
  }
}

export function withWorkspaceMutex(directory, fn, { timeoutMs = 2000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) {
    throw new RangeError('Workspace mutex timeout must be an integer from 0 to 30000 milliseconds');
  }
  if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') {
    throw new TypeError('The workspace mutex requires a synchronous callback');
  }
  const resolved = localStateDirectory(directory);
  requireSentinel(path.join(resolved, 'workspaces.lock'));
  const DatabaseSync = sqlite();
  const file = path.join(resolved, 'workspace-mutex.sqlite');
  let db;
  try {
    try {
      checkRegularFile(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout = ${timeoutMs}; BEGIN IMMEDIATE; PRAGMA schema_version;`);
  } catch (error) {
    db?.close();
    if (error.code === 'WORKSPACE_MUTEX_STORAGE') throw error;
    const busy = Number.isInteger(error.errcode) && (error.errcode & 0xff) === 5; // SQLITE_BUSY
    if (busy) throw new WorkspaceMutexError('WORKSPACE_MUTEX_BUSY', 'Another process holds the workspace mutex', error);
    throw new WorkspaceMutexError('WORKSPACE_MUTEX_STORAGE', 'Could not open or lock the workspace mutex database', error);
  }

  try {
    const result = fn();
    if (typeof result?.then === 'function') throw new TypeError('The workspace mutex callback returned a promise');
    return result;
  } finally {
    db.close();
  }
}
