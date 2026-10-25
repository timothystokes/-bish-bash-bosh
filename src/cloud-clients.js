import { spawn } from 'node:child_process';

/**
 * @typedef {(cmd: string, args: string[], opts?: {cwd?: string}) => Promise<{code: number, stdout: string, stderr: string}>} Run
 */

/** @type {Run} */
export function defaultRun(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', rej);
    p.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * S3 client backed by the `aws` CLI (no SDK dependency). The sha256 lives in object metadata.
 * @param {{run?: Run}} [opts]
 * @returns {import('./artifacts.js').S3Client}
 */
export function createAwsCliS3Client({ run = defaultRun } = {}) {
  return {
    async headObject({ bucket, key }) {
      const r = await run('aws', ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--output', 'json']);
      if (r.code === 0) return { sha256: JSON.parse(r.stdout || '{}').Metadata?.sha256 ?? '' };
      if (/\b404\b|Not Found|NoSuchKey/.test(r.stderr)) return null;
      throw new Error(`aws head-object failed: ${r.stderr.trim()}`);
    },
    async putObject({ bucket, key, body, sha256 }) {
      const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = mkdtempSync(join(tmpdir(), 'hodge-s3-'));
      try {
        const file = join(dir, 'body');
        writeFileSync(file, body);
        const r = await run('aws', ['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', file, '--metadata', `sha256=${sha256}`]);
        if (r.code !== 0) throw new Error(`aws put-object failed: ${r.stderr.trim()}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Promotion PR opener backed by `gh pr create`. Never merges.
 * @param {{run?: Run, cwd?: string}} [opts]
 * @returns {import('./artifacts.js').PrOpener}
 */
export function createGhPrOpener({ run = defaultRun, cwd } = {}) {
  return {
    async openPullRequest({ title, body, head, base }) {
      const r = await run('gh', ['pr', 'create', '--title', title, '--body', body, '--head', head, '--base', base], { cwd });
      if (r.code !== 0) throw new Error(`gh pr create failed: ${r.stderr.trim()}`);
      return { url: r.stdout.trim() };
    },
  };
}
