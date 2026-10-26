import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { bulletsBySection } from './spec-lint.js';

/**
 * @typedef {{
 *   validate: (path: string) => string[],
 *   crossCheck: (paths: string[]) => string[],
 * }} FormatTool
 */

/**
 * @param {string} path
 * @returns {{value: unknown} | {error: string}}
 */
function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Embedded format tools. Each returns problem strings (empty when fine); paths are absolute.
 * @type {Record<string, FormatTool>}
 */
export const FORMATS = {
  'json-schema': {
    validate(path) {
      const r = readJson(path);
      if ('error' in r) return [`invalid JSON: ${r.error}`];
      const v = r.value;
      if (typeof v === 'boolean' || (typeof v === 'object' && v !== null && !Array.isArray(v))) return [];
      return ['invalid schema: must be a JSON object or boolean'];
    },
    crossCheck(paths) {
      /** @type {Map<string, string>} */
      const ids = new Map();
      const problems = [];
      for (const p of paths) {
        const r = readJson(p);
        if ('error' in r || typeof r.value !== 'object' || r.value === null) continue;
        const id = /** @type {{$id?: unknown}} */ (r.value).$id;
        if (typeof id !== 'string') continue;
        const first = ids.get(id);
        if (first === undefined) ids.set(id, p);
        else problems.push(`duplicate $id "${id}" in ${first} and ${p}`);
      }
      return problems;
    },
  },
};

/**
 * Artifacts a spec declares under `## Formats` (`- <format>: <path>`).
 * @param {string} text
 * @returns {{declared: {format: string, path: string}[], malformed: string[]}}
 */
export function parseFormats(text) {
  /** @type {{format: string, path: string}[]} */
  const declared = [];
  /** @type {string[]} */
  const malformed = [];
  for (const b of bulletsBySection(text).get('formats') ?? []) {
    const m = /^([A-Za-z0-9._-]+):\s*(\S+)$/.exec(b);
    if (m) declared.push({ format: m[1].toLowerCase(), path: m[2] });
    else malformed.push(b);
  }
  return { declared, malformed };
}

/**
 * Readiness gaps for declared formats: known format, artifact inside the repo, existing, valid,
 * referenced by a requirement, and consistent across specs.
 * @param {string} repoDir
 * @returns {string[]}
 */
export function checkFormats(repoDir) {
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  const gaps = [];
  /** @type {Map<string, Set<string>>} */
  const valid = new Map();
  for (const f of files) {
    const specPath = `specs/${f}`;
    const text = readFileSync(join(specsDir, f), 'utf8');
    const { declared, malformed } = parseFormats(text);
    for (const m of malformed) gaps.push(`${specPath}: malformed Formats bullet (want "- <format>: <path>"): "${m}"`);
    const reqs = bulletsBySection(text).get('requirements') ?? [];
    for (const { format, path } of declared) {
      const tool = Object.hasOwn(FORMATS, format) ? FORMATS[format] : undefined;
      if (!tool) {
        gaps.push(`${specPath}: unknown format "${format}" for ${path} (known: ${Object.keys(FORMATS).join(', ')})`);
        continue;
      }
      const abs = resolve(repoDir, path);
      const rel = relative(resolve(repoDir), abs);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        gaps.push(`${specPath}: ${format} artifact ${path} is outside the repo`);
        continue;
      }
      if (!existsSync(abs)) {
        gaps.push(`${specPath}: ${format} artifact ${path} is missing`);
        continue;
      }
      const problems = tool.validate(abs);
      for (const p of problems) gaps.push(`${specPath}: ${format} artifact ${path}: ${p}`);
      if (problems.length === 0) {
        if (!valid.has(format)) valid.set(format, new Set());
        valid.get(format)?.add(abs);
      }
      if (!reqs.some((r) => r.includes(path))) gaps.push(`${specPath}: ${format} artifact ${path} is not referenced by any requirement`);
    }
  }
  for (const [format, paths] of valid) {
    for (const p of FORMATS[format].crossCheck([...paths])) gaps.push(`${format}: ${p.replaceAll(`${resolve(repoDir)}/`, '')}`);
  }
  return gaps;
}
