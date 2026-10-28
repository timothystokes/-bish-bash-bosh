import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = '.hodge.lock';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Take the single-run lock of the project: `<dir>/.hodge.lock` holds the owner's PID.
// A lock whose PID is dead or unreadable is stale and is replaced.
export function acquireRunLock(dir) {
  const file = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      return {
        ok: true,
        release: () => {
          try {
            if (readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, error: `cannot create lock '${file}': ${e.message}` };
    }
    let pid = NaN;
    try {
      pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    } catch {
      continue;
    }
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) return { ok: false, error: `another run holds this project (pid ${pid}, lock '${file}'); wait for it or stop it` };
    try {
      unlinkSync(file);
    } catch {
      // raced with another cleaner; retry
    }
  }
  return { ok: false, error: `cannot acquire lock '${file}'` };
}
