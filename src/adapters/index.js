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

// Resolve config's single adapter id (an opaque string) to an adapter instance.
export function resolveAdapter(config, registry = undefined) {
  const reg = registry ?? defaultRegistry;
  if (!Object.hasOwn(reg, config.adapter)) throw new Error(`unknown adapter '${config.adapter}'`);
  return reg[config.adapter]({ model: config.model });
}
