import { spawnSync } from 'node:child_process';

// Coverage/mutation gate for test-hardening: the injectable command must exit 0
// (it encodes the coverage or mutation-score threshold).
export function checkHardeningGate(repoDir, hardenCommand) {
  if (!hardenCommand || hardenCommand.length === 0) {
    return { ok: false, reason: 'test-hardening mode needs config hardenCommand (coverage/mutation command that exits non-zero below threshold)' };
  }
  const [cmd, ...args] = hardenCommand;
  const r = spawnSync(cmd, args, { cwd: repoDir, encoding: 'utf8' });
  if (r.error) return { ok: false, reason: `hardenCommand could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-2000);
    return { ok: false, reason: `hardening gate failed (exit ${r.status}): ${out}` };
  }
  return { ok: true, detail: hardenCommand.join(' ') };
}
