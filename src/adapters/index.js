import { createClaudeCodeAdapter } from './claude-code.js';
import { createCodexAdapter } from './codex.js';
import { createCopilotAdapter } from './copilot.js';
import { createOpenAiHttpAdapter } from './openai-http.js';

export const defaultRegistry = {
  copilot: ({ model }) => createCopilotAdapter({ model }),
  'claude-code': ({ model }) => createClaudeCodeAdapter({ model }),
  codex: ({ model }) => createCodexAdapter({ model }),
  'openai-http': ({ model }) =>
    createOpenAiHttpAdapter({
      model,
      baseUrl: process.env['HODGE_HTTP_BASE_URL'],
      apiKeyEnv: 'HODGE_HTTP_API_KEY',
    }),
};

// Resolve a role's adapter id (opaque string from config) to an adapter instance.
export function resolveAdapter(config, role, registry = undefined) {
  const reg = registry ?? defaultRegistry;
  const roles = config.roles;
  const spec = roles[role];
  if (!spec) throw new Error(`no role '${role}' in config`);
  if (!Object.hasOwn(reg, spec.adapter)) throw new Error(`unknown adapter '${spec.adapter}'`);
  return reg[spec.adapter]({ model: spec.model });
}
