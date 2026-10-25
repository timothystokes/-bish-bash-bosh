import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

/**
 * @typedef {{id: string, pattern: string, flags?: string}} SecretRule
 * @typedef {{rule: string, count: number}} Finding
 */

/** @type {SecretRule[]} */
export const DEFAULT_RULES = [
  { id: 'private-key', pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----' },
  { id: 'aws-access-key-id', pattern: '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b' },
  { id: 'github-token', pattern: '\\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\\b' },
  { id: 'api-key', pattern: '\\bsk-[A-Za-z0-9_-]{20,}\\b' },
  { id: 'slack-token', pattern: '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b' },
  { id: 'bearer-token', pattern: '\\bBearer\\s+[A-Za-z0-9._~+/=-]{16,}' },
];

/**
 * Replace every rule match with `[REDACTED:rule-id]`. Rules run in order.
 * @param {string} text
 * @param {SecretRule[]} [rules]
 * @returns {{text: string, findings: Finding[]}}
 */
export function redactSecrets(text, rules = DEFAULT_RULES) {
  /** @type {Finding[]} */
  const findings = [];
  let out = text;
  for (const rule of rules) {
    const flags = (rule.flags ?? '').replace('g', '') + 'g';
    let count = 0;
    out = out.replace(new RegExp(rule.pattern, flags), () => {
      count++;
      return `[REDACTED:${rule.id}]`;
    });
    if (count) findings.push({ rule: rule.id, count });
  }
  return { text: out, findings };
}

/**
 * @typedef {{
 *   upstream: string,
 *   rules?: SecretRule[],
 *   auditFile?: string,
 *   maxBodyBytes?: number,
 * }} SecretProxyOptions
 */

class Blocked extends Error {
  /** @param {number} status @param {string} reason */
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Local proxy between an agent and a model endpoint. Each request and response is
 * buffered whole, redacted, then passed on; anything that cannot be fully inspected
 * (too large, audit log unwritable, upstream failure) is blocked, never forwarded.
 * The audit log (JSONL) records rule ids and counts, never secret values.
 * @param {SecretProxyOptions} opts
 */
export function createSecretProxy(opts) {
  const rules = opts.rules ?? DEFAULT_RULES;
  const max = opts.maxBodyBytes ?? 10 * 1024 * 1024;
  const upstream = opts.upstream.replace(/\/+$/, '');

  /** @param {Record<string, unknown>} entry */
  const audit = (entry) => {
    if (!opts.auditFile) return;
    appendFileSync(opts.auditFile, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  };

  /** @param {import('node:http').IncomingMessage} req */
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > max) tooLarge = true;
        else chunks.push(c);
      });
      req.on('end', () => (tooLarge ? reject(new Blocked(413, 'too-large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
      req.on('error', reject);
    });

  const server = createServer(async (req, res) => {
    const target = `${req.method} ${req.url}`;
    try {
      const raw = /** @type {string} */ (await readBody(req));
      const inReq = redactSecrets(raw, rules);
      audit({ direction: 'request', target, findings: inReq.findings });

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding'].includes(k)) continue;
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      headers.set('accept-encoding', 'identity');
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      /** @type {Response} */
      let up;
      try {
        up = await fetch(upstream + req.url, { method: req.method, headers, body: hasBody ? inReq.text : undefined });
      } catch {
        throw new Blocked(502, 'upstream-error');
      }
      const buf = Buffer.from(await up.arrayBuffer());
      if (buf.length > max) throw new Blocked(502, 'too-large');
      const outRes = redactSecrets(buf.toString('utf8'), rules);
      audit({ direction: 'response', target, status: up.status, findings: outRes.findings });

      const ct = up.headers.get('content-type');
      res.writeHead(up.status, ct ? { 'content-type': ct } : {});
      res.end(outRes.text);
    } catch (e) {
      const blocked = e instanceof Blocked ? e : new Blocked(502, 'audit-failure');
      try {
        audit({ direction: 'blocked', target, blocked: blocked.reason });
      } catch {
        // audit unavailable: the block itself still applies
      }
      if (!res.headersSent) res.writeHead(blocked.status, { 'content-type': 'text/plain' });
      res.end(`blocked by secret proxy: ${blocked.reason}`);
    }
  });

  return {
    /** @param {number} [port] @returns {Promise<number>} */
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port));
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      }),
  };
}
