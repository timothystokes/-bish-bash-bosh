import { createClaudeCodeAdapter } from './claude-code.js';
import { createCodexAdapter } from './codex.js';
import { createCopilotAdapter } from './copilot.js';

/**
 * @typedef {(opts: {model: string}) => import('../adapter.js').Adapter} AdapterFactory
 * @typedef {Record<string, AdapterFactory>} AdapterRegistry
 */

/** @type {AdapterRegistry} */
export const defaultRegistry = {
  copilot: ({ model }) => createCopilotAdapter({ model }),
  'claude-code': ({ model }) => createClaudeCodeAdapter({ model }),
  codex: ({ model }) => createCodexAdapter({ model }),
};

/**
 * Resolve a role's adapter id (opaque string from config) to an adapter instance.
 * @param {unknown} config validated config
 * @param {string} role
 * @param {AdapterRegistry} [registry]
 * @returns {import('../adapter.js').Adapter}
 */
export function resolveAdapter(config, role, registry = defaultRegistry) {
  const roles = /** @type {{roles: Record<string, {adapter: string, model: string}>}} */ (config).roles;
  const spec = roles[role];
  if (!spec) throw new Error(`no role '${role}' in config`);
  if (!Object.hasOwn(registry, spec.adapter)) throw new Error(`unknown adapter '${spec.adapter}'`);
  return registry[spec.adapter]({ model: spec.model });
}
