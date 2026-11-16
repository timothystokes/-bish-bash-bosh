import { createClaudeCodeAdapter } from './claude-code.js';
import { createCodexAdapter } from './codex.js';
import { createCopilotAdapter } from './copilot.js';
import { createOpenAiHttpAdapter } from './openai-http.js';
import { loadProjectConfig } from '../shared/project-config.js';

export const defaultRegistry = {
  copilot: ({ model }) => createCopilotAdapter({ model }),
  'claude-code': ({ model }) => createClaudeCodeAdapter({ model }),
  codex: ({ model }) => createCodexAdapter({ model }),
  'openai-http': ({ model }) =>
    createOpenAiHttpAdapter({
      model,
      baseUrl: process.env['BISH_HTTP_BASE_URL'],
      apiKeyEnv: 'BISH_HTTP_API_KEY',
    }),
};

// Resolve config's single adapter id (an opaque string) to an adapter instance.
export function resolveAdapter(config, registry = undefined) {
  const reg = registry ?? defaultRegistry;
  if (!Object.hasOwn(reg, config.adapter)) throw new Error(`unknown adapter '${config.adapter}'`);
  return reg[config.adapter]({ model: config.model });
}

// An adapter that re-reads the project's adapter and model from config.yml on every call, so an
// Agent/Model change made in the footer takes effect from the next agent call. The resolved adapter is
// kept per adapter+model pair so its sessions survive between calls. The latest values are copied
// onto `config` so a later write of that object does not revert them.
// The project's current config.yml values, so a footer change applies to the next use (falls back to `config`).
export const liveConfig = (project) => {
  const fresh = loadProjectConfig(project.dir);
  return fresh.ok ? fresh.config : project.config;
};

export function resolveLiveAdapter(project, registry = undefined) {
  const cache = new Map([[`${project.config.adapter}\0${project.config.model}`, resolveAdapter(project.config, registry)]]);
  return {
    run: (req) => {
      const fresh = loadProjectConfig(project.dir);
      if (fresh.ok) {
        project.config.adapter = fresh.config.adapter;
        project.config.model = fresh.config.model;
      }
      const key = `${project.config.adapter}\0${project.config.model}`;
      if (!cache.has(key)) cache.set(key, resolveAdapter(project.config, registry));
      return cache.get(key).run(req);
    },
  };
}
