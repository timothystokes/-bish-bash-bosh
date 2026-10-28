import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Brownfield changes are spec deltas, so specs must already exist.
export function checkBrownfieldGate(repoDir) {
  const dir = join(repoDir, 'specs');
  const specs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  if (specs.length === 0) {
    return { ok: false, reason: 'brownfield mode needs specs/*.md; run `hodge --reverse` first to recover them from the code' };
  }
  return { ok: true, detail: `${specs.length} spec(s)` };
}
