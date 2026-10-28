#!/usr/bin/env node
// Fake agent: emulates `codex exec --json` JSONL from a FAKE_AGENT_FIXTURE env var.
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
  const emit = (/** @type {unknown} */ e) => console.log(JSON.stringify(e));
  emit({ type: 'thread.started', thread_id: 't1' });
  emit({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: fx.transcript } });
  emit({ type: 'turn.completed' });
  process.exit(fx.exitStatus);
}
