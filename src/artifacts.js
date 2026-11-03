import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) out.push(...listFiles(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

// Sync a run's records (`.bish-bash-bosh/runs/<runId>/**`) to S3 under the `runs/<runId>/**` key. Idempotent:
// a file whose sha256 matches the stored object is skipped. Git stays the source of truth; this is a copy.
export async function syncArtifacts({ client, bucket, repoDir, runId }) {
  if (!bucket) throw new Error('bucket is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.includes('..')) throw new Error(`invalid runId: ${runId}`);
  const root = join(repoDir, '.bish-bash-bosh', 'runs', runId);
  const result = { uploaded: [], skipped: [] };
  if (!existsSync(root)) return result;
  for (const rel of listFiles(root)) {
    const key = `runs/${runId}/${rel}`;
    const body = readFileSync(join(root, rel));
    const sha256 = createHash('sha256').update(body).digest('hex');
    const existing = await client.headObject({ bucket, key });
    if (existing && existing.sha256 === sha256) {
      result.skipped.push(key);
    } else {
      await client.putObject({ bucket, key, body, sha256 });
      result.uploaded.push(key);
    }
  }
  return result;
}

// Promotion review: open a PR from the sandbox branch for a human to review. Never merges.
export async function requestPromotion({ opener, runId, head, base, artifactsUri, sha }) {
  if (!runId) throw new Error('runId is required');
  if (!head || !base) throw new Error('head and base are required');
  if (head === base) throw new Error('head must differ from base');
  const body = [`Promotion review for run \`${runId}\`.`, '', `- Commit: ${sha}`, `- Artifacts: ${artifactsUri}`, '', 'A human must review and merge; bish never merges.'].join('\n');
  return opener.openPullRequest({ title: `Promote run ${runId}`, body, head, base });
}
