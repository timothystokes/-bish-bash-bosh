import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const SMOKE_FILE = 'fizzbuzz.js';

export const SMOKE_PROMPT = [
  `Create a file named ${SMOKE_FILE} in the current directory.`,
  'It must print FizzBuzz for the numbers 1 to 15, one line each: "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for multiples of both, otherwise the number.',
  `Run it with \`node ${SMOKE_FILE}\` and check the output is right.`,
  'Create no other files. Do not use git.',
].join('\n');

export function expectedSmokeOutput() {
  let s = '';
  for (let i = 1; i <= 15; i++) s += `${i % 15 === 0 ? 'FizzBuzz' : i % 3 === 0 ? 'Fizz' : i % 5 === 0 ? 'Buzz' : i}\n`;
  return s;
}

// Tiny adapter smoke check for live use: the agent writes and runs fizzbuzz; the harness re-runs the file and compares.
export async function runSmoke(adapter, { cwd, limits }) {
  const target = join(cwd, SMOKE_FILE);
  rmSync(target, { force: true });
  const result = await adapter.run({ prompt: SMOKE_PROMPT, cwd, limits });
  const errors = [];
  if (result.exitStatus !== 0) errors.push(`agent exited ${result.exitStatus}`);
  const extra = result.changedFiles.filter((f) => f !== SMOKE_FILE);
  if (extra.length) errors.push(`unexpected files: ${extra.join(', ')}`);
  if (!result.changedFiles.includes(SMOKE_FILE) || !existsSync(target)) {
    errors.push(`${SMOKE_FILE} was not created`);
  } else {
    const run = spawnSync(process.execPath, [SMOKE_FILE], { cwd, encoding: 'utf8', timeout: 10_000 });
    if (run.status !== 0) errors.push(`${SMOKE_FILE} exited non-zero`);
    else if (run.stdout !== expectedSmokeOutput()) errors.push(`${SMOKE_FILE} output differs from expected FizzBuzz 1..15`);
  }
  return { ok: errors.length === 0, errors, changedFiles: result.changedFiles, result };
}
