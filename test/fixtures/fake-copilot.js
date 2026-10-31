#!/usr/bin/env node
// Fake agent: emulates `copilot -p ... --output-format json` from a FAKE_AGENT_FIXTURE env var.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const fx = JSON.parse(process.env.FAKE_AGENT_FIXTURE ?? '{}');
if (fx.hang) setInterval(() => {}, 1000);
else {
  for (const line of fx.extraLines ?? []) console.log(line);
  for (const [rel, content] of Object.entries(fx.writes ?? {})) {
    const full = join(process.cwd(), rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  console.log(JSON.stringify({ type: 'assistant.message', data: { content: fx.transcript } }));
  process.exit(fx.exitStatus);
}
