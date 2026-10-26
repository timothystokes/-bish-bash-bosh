import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import Ajv04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { AstBuilder, GherkinClassicTokenMatcher, Parser as GherkinParser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { Grammars } from 'ebnf';
import { bulletsBySection } from './spec-lint.js';

/**
 * @typedef {{
 *   validate: (path: string) => string[],
 *   crossCheck: (paths: string[]) => string[],
 *   conform?: (schemaPath: string, dataPath: string, schemaPaths: string[]) => string[],
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

/** @returns {import('ajv/dist/2020.js').default} */
function newAjv() {
  const ajv = new Ajv2020.default({ strict: false, allErrors: true, logger: false });
  addFormats.default(ajv);
  return ajv;
}

/**
 * Registers each readable schema object under its path; the first of a duplicate `$id` wins.
 * @param {string[]} paths
 * @returns {{ajv: import('ajv/dist/2020.js').default, duplicates: string[], loaded: string[]}}
 */
function loadSchemas(paths) {
  const ajv = newAjv();
  /** @type {Map<string, string>} */
  const ids = new Map();
  /** @type {string[]} */
  const duplicates = [];
  /** @type {string[]} */
  const loaded = [];
  for (const p of paths) {
    const r = readJson(p);
    if ('error' in r || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) continue;
    const schema = /** @type {{$id?: unknown}} */ (r.value);
    if (typeof schema.$id === 'string') {
      const first = ids.get(schema.$id);
      if (first !== undefined) {
        duplicates.push(`duplicate $id "${schema.$id}" in ${first} and ${p}`);
        continue;
      }
      ids.set(schema.$id, p);
    }
    try {
      ajv.addSchema(/** @type {object} */ (r.value), p);
      loaded.push(p);
    } catch {
      // an invalid schema is reported by validate()
    }
  }
  return { ajv, duplicates, loaded };
}

const require = createRequire(import.meta.url);
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** @type {Map<string, import('ajv/dist/core.js').ValidateFunction>} */
const oasValidators = new Map();

/**
 * @param {string} version `3.0`, `3.1` or `3.2`
 * @returns {import('ajv/dist/core.js').ValidateFunction}
 */
function oasValidator(version) {
  let v = oasValidators.get(version);
  if (!v) {
    const schema = require(`@seriousme/openapi-schema-validator/schemas/v${version}/schema.json`);
    const Ctor = /** @type {typeof import('ajv/dist/2020.js').default} */ (
      version === '3.0' ? /** @type {any} */ (Ajv04).default ?? Ajv04 : Ajv2020.default
    );
    const ajv = new Ctor({ strict: false, allErrors: true, logger: false });
    addFormats.default(ajv);
    v = ajv.compile(schema);
    oasValidators.set(version, v);
  }
  return v;
}

/**
 * @param {string} path
 * @returns {{doc: Record<string, unknown>} | {error: string}}
 */
function readOpenApi(path) {
  let value;
  try {
    value = parseYaml(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: `invalid YAML/JSON: ${message(e)}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'document must be an object' };
  return { doc: /** @type {Record<string, unknown>} */ (value) };
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {{id: string, where: string}[]}
 */
function operationIds(doc) {
  const out = [];
  const paths = doc.paths;
  if (typeof paths !== 'object' || paths === null) return [];
  for (const [route, item] of Object.entries(paths)) {
    if (typeof item !== 'object' || item === null) continue;
    for (const m of HTTP_METHODS) {
      const op = /** @type {Record<string, unknown>} */ (item)[m];
      const id = typeof op === 'object' && op !== null ? /** @type {{operationId?: unknown}} */ (op).operationId : undefined;
      if (typeof id === 'string') out.push({ id, where: `${m.toUpperCase()} ${route}` });
    }
  }
  return out;
}

/**
 * Local `$ref`s (`#/...`) that point nowhere.
 * @param {unknown} node
 * @param {unknown} root
 * @param {Set<string>} bad
 */
function collectBadRefs(node, root, bad) {
  if (Array.isArray(node)) {
    for (const n of node) collectBadRefs(n, root, bad);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'example' || k === 'examples') continue;
    if (k === '$ref' && typeof v === 'string' && v.startsWith('#')) {
      if (!resolvePointer(root, v.slice(1))) bad.add(v);
    } else collectBadRefs(v, root, bad);
  }
}

/**
 * @param {unknown} root
 * @param {string} pointer
 * @returns {boolean}
 */
function resolvePointer(root, pointer) {
  if (pointer === '') return true;
  if (!pointer.startsWith('/')) return false;
  let cur = root;
  for (const raw of pointer.slice(1).split('/')) {
    let key;
    try {
      key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
    } catch {
      return false;
    }
    if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, key)) return false;
    cur = /** @type {Record<string, unknown>} */ (cur)[key];
  }
  return true;
}

/** @param {unknown} e */
const message = (e) => (e instanceof Error ? e.message : String(e));

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
      if (typeof v !== 'boolean' && (typeof v !== 'object' || v === null || Array.isArray(v))) {
        return ['invalid schema: must be a JSON object or boolean'];
      }
      try {
        const ajv = newAjv();
        if (!ajv.validateSchema(/** @type {object | boolean} */ (v))) {
          return [`invalid schema: ${ajv.errorsText(ajv.errors)}`];
        }
      } catch (e) {
        return [`invalid schema: ${message(e)}`];
      }
      return [];
    },
    crossCheck(paths) {
      const { ajv, duplicates, loaded } = loadSchemas(paths);
      const problems = [...duplicates];
      for (const p of loaded) {
        try {
          ajv.getSchema(p);
        } catch (e) {
          const ref = /** @type {{missingRef?: string}} */ (e).missingRef;
          problems.push(ref ? `unresolved $ref "${ref}" in ${p}` : `${p}: ${message(e)}`);
        }
      }
      return problems;
    },
    conform(schemaPath, dataPath, schemaPaths) {
      const data = readJson(dataPath);
      if ('error' in data) return [`invalid JSON: ${data.error}`];
      const { ajv } = loadSchemas(schemaPaths);
      try {
        const validate = ajv.getSchema(schemaPath);
        if (!validate) return [`schema ${schemaPath} could not be loaded`];
        if (validate(data.value)) return [];
        return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
      } catch (e) {
        return [`schema ${schemaPath} could not be compiled: ${message(e)}`];
      }
    },
  },
};

FORMATS.openapi = {
  validate(path) {
    const r = readOpenApi(path);
    if ('error' in r) return [r.error];
    const doc = r.doc;
    const version = typeof doc.openapi === 'string' ? /^3\.[012]\./.exec(`${doc.openapi}.`)?.[0].slice(0, 3) : undefined;
    if (!version) return [`unsupported or missing openapi version ${JSON.stringify(doc.openapi)} (want 3.0, 3.1 or 3.2)`];
    const check = oasValidator(version);
    const problems = [];
    if (!check(doc)) {
      for (const e of check.errors ?? []) problems.push(`invalid OpenAPI: ${e.instancePath || '/'} ${e.message}`);
      return [...new Set(problems)].slice(0, 20);
    }
    const bad = new Set();
    collectBadRefs(doc, doc, bad);
    for (const ref of bad) problems.push(`unresolved $ref "${ref}"`);
    /** @type {Map<string, string>} */
    const seen = new Map();
    for (const { id, where } of operationIds(doc)) {
      const first = seen.get(id);
      if (first !== undefined) problems.push(`duplicate operationId "${id}" in ${first} and ${where}`);
      else seen.set(id, where);
    }
    return problems;
  },
  crossCheck(paths) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    const problems = [];
    for (const p of paths) {
      const r = readOpenApi(p);
      if ('error' in r) continue;
      for (const id of new Set(operationIds(r.doc).map((o) => o.id))) {
        const first = seen.get(id);
        if (first !== undefined) problems.push(`duplicate operationId "${id}" in ${first} and ${p}`);
        else seen.set(id, p);
      }
    }
    return problems;
  },
};

/** @type {Map<string, import('ajv').ValidateFunction>} */
const asyncValidators = new Map();

/**
 * @param {string} version e.g. `3.0.0`
 * @returns {import('ajv').ValidateFunction | undefined} undefined when the release is unknown
 */
function asyncValidator(version) {
  let v = asyncValidators.get(version);
  if (!v) {
    /** @type {Record<string, object>} */
    const schemas = require('@asyncapi/specs').schemasWithoutId;
    if (!Object.hasOwn(schemas, version)) return undefined;
    const schema = schemas[version];
    const ajv = new Ajv.default({ strict: false, allErrors: true, logger: false });
    addFormats.default(ajv);
    v = ajv.compile(schema);
    asyncValidators.set(version, v);
  }
  return v;
}

/**
 * Operation ids: 2.x `operationId`s on publish/subscribe; 3.x operations are keyed by their id.
 * @param {Record<string, unknown>} doc
 * @returns {{id: string, where: string}[]}
 */
function asyncOperationIds(doc) {
  const out = [];
  const ops = doc.operations;
  if (typeof ops === 'object' && ops !== null && !Array.isArray(ops)) {
    for (const id of Object.keys(ops)) out.push({ id, where: `operation ${id}` });
  }
  const channels = doc.channels;
  if (typeof channels === 'object' && channels !== null && !Array.isArray(channels)) {
    for (const [name, item] of Object.entries(channels)) {
      if (typeof item !== 'object' || item === null) continue;
      for (const k of ['publish', 'subscribe']) {
        const op = /** @type {Record<string, unknown>} */ (item)[k];
        const id = typeof op === 'object' && op !== null ? /** @type {{operationId?: unknown}} */ (op).operationId : undefined;
        if (typeof id === 'string') out.push({ id, where: `${k} ${name}` });
      }
    }
  }
  return out;
}

FORMATS.asyncapi = {
  validate(path) {
    const r = readOpenApi(path);
    if ('error' in r) return [r.error];
    const doc = r.doc;
    const version = typeof doc.asyncapi === 'string' ? doc.asyncapi : undefined;
    const check = version === undefined ? undefined : asyncValidator(version);
    if (!check) return [`unsupported or missing asyncapi version ${JSON.stringify(doc.asyncapi)} (want a released 2.x or 3.x version)`];
    if (!check(doc)) {
      const problems = (check.errors ?? []).map((e) => `invalid AsyncAPI: ${e.instancePath || '/'} ${e.message}`);
      return [...new Set(problems)].slice(0, 20);
    }
    const problems = [];
    const bad = new Set();
    collectBadRefs(doc, doc, bad);
    for (const ref of bad) problems.push(`unresolved $ref "${ref}"`);
    /** @type {Map<string, string>} */
    const seen = new Map();
    for (const { id, where } of asyncOperationIds(doc)) {
      const first = seen.get(id);
      if (first !== undefined) problems.push(`duplicate operationId "${id}" in ${first} and ${where}`);
      else seen.set(id, where);
    }
    return problems;
  },
  crossCheck(paths) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    const problems = [];
    for (const p of paths) {
      const r = readOpenApi(p);
      if ('error' in r) continue;
      for (const id of new Set(asyncOperationIds(r.doc).map((o) => o.id))) {
        const first = seen.get(id);
        if (first !== undefined) problems.push(`duplicate operationId "${id}" in ${first} and ${p}`);
        else seen.set(id, p);
      }
    }
    return problems;
  },
};

const REQ_TAG = /^@R-[A-Za-z0-9._-]+-\d+$/;

/**
 * Parses a feature file and lists its scenarios with the tags they inherit.
 * @param {string} path
 * @returns {{scenarios: {name: string, tags: string[]}[]} | {error: string}}
 */
function readGherkin(path) {
  let doc;
  try {
    const builder = new AstBuilder(IdGenerator.uuid());
    doc = new GherkinParser(builder, new GherkinClassicTokenMatcher()).parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: `invalid Gherkin: ${message(e).replace(/\s*\n\s*/g, '; ')}` };
  }
  const feature = doc.feature;
  if (!feature) return { error: 'invalid Gherkin: no Feature found' };
  const base = feature.tags.map((t) => t.name);
  /** @type {{name: string, tags: string[]}[]} */
  const scenarios = [];
  for (const child of feature.children) {
    const rule = child.rule;
    const inherited = rule ? [...base, ...rule.tags.map((t) => t.name)] : base;
    const items = rule ? rule.children : [child];
    for (const item of items) {
      if (item.scenario) scenarios.push({ name: item.scenario.name, tags: [...inherited, ...item.scenario.tags.map((t) => t.name)] });
    }
  }
  return { scenarios };
}

FORMATS.gherkin = {
  validate(path) {
    const r = readGherkin(path);
    if ('error' in r) return [r.error];
    if (r.scenarios.length === 0) return ['no scenarios: executable examples need at least one Scenario'];
    const problems = [];
    const seen = new Set();
    for (const s of r.scenarios) {
      if (!s.tags.some((t) => REQ_TAG.test(t))) problems.push(`scenario "${s.name}" has no requirement ID tag (@R-<spec>-<n>)`);
      if (seen.has(s.name)) problems.push(`duplicate scenario "${s.name}"`);
      seen.add(s.name);
    }
    return problems;
  },
  crossCheck(paths) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    const problems = [];
    for (const p of paths) {
      const r = readGherkin(p);
      if ('error' in r) continue;
      for (const name of new Set(r.scenarios.map((s) => s.name))) {
        const first = seen.get(name);
        if (first !== undefined) problems.push(`duplicate scenario "${name}" in ${first} and ${p}`);
        else seen.set(name, p);
      }
    }
    return problems;
  },
};

const EXAMPLE_COMMENT = /\/\*\s*(accept|reject)\s*:([\s\S]*?)\*\//g;

FORMATS.ebnf = {
  validate(path) {
    const text = readFileSync(path, 'utf8');
    /** @type {{kind: string, input: string}[]} */
    const examples = [];
    const problems = [];
    for (const m of text.matchAll(EXAMPLE_COMMENT)) {
      try {
        const input = JSON.parse(m[2].trim());
        if (typeof input !== 'string') throw new Error('not a string');
        examples.push({ kind: m[1], input });
      } catch {
        problems.push(`malformed example (want /* ${m[1]}: "<JSON string>" */): ${m[2].trim()}`);
      }
    }
    /** @type {InstanceType<typeof Grammars.W3C.Parser>} */
    let parser;
    try {
      parser = new Grammars.W3C.Parser(text);
    } catch (e) {
      return [...problems, `invalid EBNF: ${message(e).replace(/\s*\n\s*/g, '; ')}`];
    }
    if (parser.grammarRules.length === 0) return [...problems, 'invalid EBNF: no rules'];
    if (examples.length === 0 && problems.length === 0) return ['no examples: declare /* accept: "<text>" */ and /* reject: "<text>" */ comments'];
    if (examples.length > 0 && !examples.some((x) => x.kind === 'reject')) problems.push('needs at least one reject example');
    if (examples.length > 0 && !examples.some((x) => x.kind === 'accept')) problems.push('needs at least one accept example');
    for (const { kind, input } of examples) {
      const ast = parser.getAST(input);
      const accepted = ast !== null && ast.errors.length === 0 && ast.rest.length === 0;
      if (kind === 'accept' && !accepted) problems.push(`example ${JSON.stringify(input)} is declared accept but the grammar rejects it`);
      if (kind === 'reject' && accepted) problems.push(`example ${JSON.stringify(input)} is declared reject but the grammar accepts it`);
    }
    return problems;
  },
  crossCheck: () => [],
};

/**
 * Artifacts a spec declares under `## Formats` (`- <format>: <path>`, optionally `-> <output path>`
 * naming a loop output the artifact constrains).
 * @param {string} text
 * @returns {{declared: {format: string, path: string, output?: string}[], malformed: string[]}}
 */
export function parseFormats(text) {
  /** @type {{format: string, path: string, output?: string}[]} */
  const declared = [];
  /** @type {string[]} */
  const malformed = [];
  for (const b of bulletsBySection(text).get('formats') ?? []) {
    const m = /^([A-Za-z0-9._-]+):\s*(\S+?)(?:\s*->\s*(\S+))?$/.exec(b);
    if (m) declared.push({ format: m[1].toLowerCase(), path: m[2], ...(m[3] ? { output: m[3] } : {}) });
    else malformed.push(b);
  }
  return { declared, malformed };
}

/**
 * Readiness gaps for declared formats: known format, artifact inside the repo, existing, valid,
 * referenced by a requirement, consistent across specs, and satisfied by any declared output that exists.
 * @param {string} repoDir
 * @returns {string[]}
 */
export function checkFormats(repoDir) {
  const specsDir = join(repoDir, 'specs');
  const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort() : [];
  const gaps = [];
  /** @type {Map<string, Set<string>>} */
  const valid = new Map();
  /** @type {{specPath: string, format: string, schema: string, output: string, abs: string}[]} */
  const outputs = [];
  for (const f of files) {
    const specPath = `specs/${f}`;
    const text = readFileSync(join(specsDir, f), 'utf8');
    const { declared, malformed } = parseFormats(text);
    for (const m of malformed) gaps.push(`${specPath}: malformed Formats bullet (want "- <format>: <path>"): "${m}"`);
    const reqs = bulletsBySection(text).get('requirements') ?? [];
    for (const { format, path, output } of declared) {
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
      if (output !== undefined) {
        const outAbs = resolve(repoDir, output);
        const outRel = relative(resolve(repoDir), outAbs);
        if (outRel.startsWith('..') || isAbsolute(outRel)) gaps.push(`${specPath}: ${format} output ${output} is outside the repo`);
        else outputs.push({ specPath, format, schema: path, output, abs: join(resolve(repoDir), outRel) });
      }
      if (!reqs.some((r) => r.includes(path))) gaps.push(`${specPath}: ${format} artifact ${path} is not referenced by any requirement`);
    }
  }
  for (const [format, paths] of valid) {
    for (const p of FORMATS[format].crossCheck([...paths])) gaps.push(`${format}: ${p.replaceAll(`${resolve(repoDir)}/`, '')}`);
  }
  for (const o of outputs) {
    const tool = FORMATS[o.format];
    const schemaAbs = resolve(repoDir, o.schema);
    if (!tool.conform || !valid.get(o.format)?.has(schemaAbs) || !existsSync(o.abs)) continue;
    for (const p of tool.conform(schemaAbs, o.abs, [...(valid.get(o.format) ?? [])])) {
      gaps.push(`${o.specPath}: output ${o.output} does not conform to ${o.schema}: ${p.replaceAll(`${resolve(repoDir)}/`, '')}`);
    }
  }
  return gaps;
}

/**
 * @param {string} repoDir
 * @returns {boolean} whether any spec declares a format artifact (or a malformed bullet)
 */
export function declaresFormats(repoDir) {
  const specsDir = join(repoDir, 'specs');
  if (!existsSync(specsDir)) return false;
  return readdirSync(specsDir).filter((f) => f.endsWith('.md')).some((f) => {
    const { declared, malformed } = parseFormats(readFileSync(join(specsDir, f), 'utf8'));
    return declared.length + malformed.length > 0;
  });
}

/**
 * Loop gate: declared format artifacts are valid and consistent, and every declared output that
 * exists conforms. Passes trivially when no spec declares a format.
 * @param {string} repoDir
 * @returns {import('./diff-gates.js').GateCheck}
 */
export function checkFormatGate(repoDir) {
  const gaps = checkFormats(repoDir);
  return gaps.length === 0 ? { ok: true } : { ok: false, reason: gaps.join('; ') };
}
