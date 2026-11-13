// Write zones: each agent role may only change certain files, and the harness (not the prompt) enforces it.
// Take a snapshot before an agent runs, then `enforce` afterwards: anything changed outside the role's zone is
// put back exactly as it was, and the offending paths are returned so they can go back to the agent as feedback.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const HARNESS_DIR = '.bish-bash-bosh/';
const TESTS_DIR = `${HARNESS_DIR}tests/`;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_BYTES = 2 * 1024 * 1024;

// Files the harness itself writes while an agent may be running; they are not the agent's to change or to be blamed for.
const harnessOwned = (path) => path === `${HARNESS_DIR}lock` || path === `${HARNESS_DIR}test-results.txt` || /^\.bish-bash-bosh\/[^/]*-log\.md$/.test(path);

export const ZONES = {
  'test-writer': { allows: (path) => path.startsWith(TESTS_DIR), describe: `only the tests under ${TESTS_DIR}` },
  builder: { allows: (path) => !path.startsWith(HARNESS_DIR), describe: `only the project's own files, never anything under ${HARNESS_DIR}` },
  inspector: { allows: () => false, describe: 'nothing: the Inspector only reads and reports' },
};

/** @returns {Map<string, Buffer>} every file under `dir` (relative, forward-slashed) that is small enough to restore. */
export function takeSnapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile() && statSync(full).size <= MAX_BYTES) {
        out.set(full.slice(dir.length + 1).split('\\').join('/'), readFileSync(full));
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Compares the project with `before`, restores every change the role's zone doesn't allow, and reports both kinds.
 * @returns {{ changed: string[], violations: string[] }} `changed` is every file the agent touched that is its to touch.
 */
export function enforce(dir, before, role) {
  const after = takeSnapshot(dir);
  const differs = (p) => {
    const a = before.get(p);
    const b = after.get(p);
    return a && b ? !a.equals(b) : Boolean(a) !== Boolean(b);
  };
  const touched = [...new Set([...before.keys(), ...after.keys()])].filter((p) => !harnessOwned(p) && differs(p));
  const changed = [];
  const violations = [];
  for (const path of touched) {
    if (ZONES[role].allows(path)) {
      changed.push(path);
      continue;
    }
    violations.push(path);
    const full = join(dir, path);
    if (before.has(path)) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, before.get(path));
    } else {
      rmSync(full, { force: true });
    }
  }
  return { changed, violations };
}

export function describeViolations(role, violations) {
  return `You are a ${role.replace('-', ' ')} and may change ${ZONES[role].describe}. These changes were outside that and have been reverted: ${violations.join(', ')}.`;
}
