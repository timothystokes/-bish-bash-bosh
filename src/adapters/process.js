import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Hash every file under dir so changes can be detected without requiring git.
function snapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile() && statSync(full).isFile()) {
        out.set(relative(dir, full).split('\\').join('/'), createHash('sha1').update(readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

// Run a CLI agent process under limits and report which files it changed.
export async function runProcessAgent({ command, args, cwd, env, maxWallClockSeconds, onOutput }) {
  const before = snapshot(cwd);
  const res = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer =
      maxWallClockSeconds !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, maxWallClockSeconds * 1000)
        : undefined;
    child.stdout.on('data', (b) => {
      stdout += b;
      onOutput?.('stdout', String(b));
    });
    child.stderr.on('data', (b) => {
      stderr += b;
      onOutput?.('stderr', String(b));
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(e.message), timedOut });
    });
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve({ code: c ?? 1, stdout, stderr, timedOut });
    });
  });
  const after = snapshot(cwd);
  const changedFiles = [...after].filter(([f, h]) => before.get(f) !== h).map(([f]) => f);
  return { ...res, changedFiles };
}
