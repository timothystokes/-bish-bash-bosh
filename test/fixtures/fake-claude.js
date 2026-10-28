#!/usr/bin/env node
// Fake agent: emulates `claude -p ... --output-format json` from a FAKE_AGENT_FIXTURE env var.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const fx = JSON.parse(process.env.FAKE_AGENT_FIXTURE ?? '{}');
if (fx.hang) setInterval(() => {}, 1000);
else {
  for (const [rel, content] of Object.entries(fx.writes ?? {})) {
    const full = join(process.cwd(), rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: fx.exitStatus === 0 ? 'success' : 'error_during_execution',
      is_error: fx.exitStatus !== 0,
      result: fx.transcript,
    }),
  );
  process.exit(fx.exitStatus);
}
