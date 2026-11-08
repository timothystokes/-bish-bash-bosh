import { spawn } from 'node:child_process';

export function defaultRun(cmd, args, { cwd } = { cwd: undefined }) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', rej);
    p.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

// Promotion PR opener backed by `gh pr create`. Never merges.
export function createGhPrOpener({ run = defaultRun, cwd = undefined } = {}) {
  return {
    async openPullRequest({ title, body, head, base }) {
      const r = await run('gh', ['pr', 'create', '--title', title, '--body', body, '--head', head, '--base', base], { cwd });
      if (r.code !== 0) throw new Error(`gh pr create failed: ${r.stderr.trim()}`);
      return { url: r.stdout.trim() };
    },
  };
}
