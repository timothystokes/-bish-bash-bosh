import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * @typedef {{
 *   model?: string,
 *   baseUrl?: string,
 *   apiKeyEnv?: string,
 *   env?: Record<string, string | undefined>,
 * }} OpenAiHttpOptions
 */

const FILE_RE = /^<<<FILE (.+)>>>\n([\s\S]*?)\n?^<<<END>>>[ \t]*$/gm;

export const FILE_PROTOCOL = [
  'You cannot run tools. To create or replace a file, reply with a block per file in exactly this form:',
  '<<<FILE relative/path>>>',
  '<full file content>',
  '<<<END>>>',
  'Paths must be relative to the repo root. Any text outside blocks is your commentary.',
].join('\n');

/**
 * Extract file blocks from a model reply; the remainder is the transcript.
 * @param {string} content
 * @returns {{transcript: string, files: Record<string, string>}}
 */
export function parseFileBlocks(content) {
  /** @type {Record<string, string>} */
  const files = {};
  const transcript = content
    .replace(FILE_RE, (_m, path, body) => {
      files[String(path).trim()] = body;
      return '';
    })
    .trim();
  return { transcript, files };
}

/**
 * Adapter for any OpenAI-compatible `/chat/completions` endpoint. The model has
 * no tools, so it returns whole files in the file-block protocol and the adapter
 * writes them. Paths outside cwd are rejected. HTTP error => exit 2, no response
 * => 127, wall-clock timeout => 124 (same convention as process adapters).
 * @param {OpenAiHttpOptions} [opts]
 * @returns {import('../adapter.js').Adapter}
 */
export function createOpenAiHttpAdapter(opts = {}) {
  const baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const env = opts.env ?? process.env;
  return {
    async run({ prompt, cwd, limits }) {
      const fail = (/** @type {number} */ exitStatus, /** @type {string} */ transcript) => ({
        exitStatus,
        transcript,
        changedFiles: /** @type {string[]} */ ([]),
      });
      const headers = { 'content-type': 'application/json', ...(opts.apiKeyEnv && env[opts.apiKeyEnv] ? { authorization: `Bearer ${env[opts.apiKeyEnv]}` } : {}) };
      const body = JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: FILE_PROTOCOL },
          { role: 'user', content: prompt },
        ],
      });
      const signal = limits.maxWallClockSeconds !== undefined ? AbortSignal.timeout(limits.maxWallClockSeconds * 1000) : undefined;
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body, signal });
      } catch (err) {
        const e = /** @type {Error} */ (err);
        return e.name === 'TimeoutError' || e.name === 'AbortError' ? fail(124, 'wall-clock limit exceeded') : fail(127, `request failed: ${e.message}`);
      }
      let json;
      try {
        json = await res.json();
      } catch {
        return fail(res.ok ? 2 : 2, `HTTP ${res.status}: unparseable body`);
      }
      if (!res.ok) return fail(2, `HTTP ${res.status}: ${JSON.stringify(json?.error ?? json)}`);

      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return fail(2, 'response had no message content');

      const { transcript, files } = parseFileBlocks(content);
      const root = resolve(cwd);
      const changedFiles = [];
      const rejected = [];
      for (const [rel, text] of Object.entries(files)) {
        const full = resolve(root, rel);
        const r = relative(root, full);
        if (isAbsolute(rel) || r === '' || r.startsWith('..') || isAbsolute(r)) {
          rejected.push(rel);
          continue;
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(join(root, r), text);
        changedFiles.push(r.split('\\').join('/'));
      }
      const note = rejected.length ? `\n[rejected paths outside repo: ${rejected.join(', ')}]` : '';
      return { exitStatus: rejected.length ? 1 : 0, transcript: transcript + note, changedFiles };
    },
  };
}
