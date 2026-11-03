// Shipped by bish-bash-bosh (`bosh` writes this file once, if missing) as
// `.bish-bash-bosh/test-harness.js`: a few generic, black-box verification helpers built only on
// Node's own standard library (no extra dependency, so it works no matter what language or stack
// the project itself is built in). Pair it with `node:test` in files under `.bish-bash-bosh/tests/`:
// each test should exercise the project from the outside — run the command or server a user would
// actually run, then check its exit status, output, or an HTTP response — never import the
// project's internals directly.
import { spawnSync } from 'node:child_process';

export { strict as assert } from 'node:assert';

// Runs `command args...` synchronously (defaults to the current working directory) and returns its
// exit status and captured output. Works for any stack: a compiled binary, `python3 app.py`,
// `go run .`, a CLI entry point, or a short-lived script that starts a server and curls it.
export function runCommand(command, args = [], opts = {}) {
  const res = spawnSync(command, args, { encoding: 'utf8', ...opts });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Minimal HTTP request helper, built on Node's own global `fetch`, for verifying a running server's
// behaviour without adding a dependency.
export async function httpRequest(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, text };
}
