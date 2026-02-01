/**
 * Memory-hook config: on-demand injection with reranking
 */
import type { BenchScenario } from "./types";
import { writeClaudeSettings, copyMemoriesDb } from "../workspace";

export const memoryHook: BenchScenario = {
  name: "memory-hook",

  async apply(paths, cfg) {
    // Copy memories LanceDB to workspace
    await copyMemoriesDb(cfg.memoriesLancePath, paths.memoriesLancePath);

    // Write Claude settings with memory-hook enabled
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              {
                type: "command",
                // MEMORY_HOOK_DISABLED=0 overrides the env var to re-enable this specific hook
                // (global hooks see MEMORY_HOOK_DISABLED=1 from buildEnv and skip)
                command: `MEMORY_HOOK_DISABLED=0 RERANK_PROVIDER=codex MEMORY_HOOK_DATA_DIR=${paths.root} bun run ${cfg.memoryHookPath}/src/memory-search.ts`,
              },
            ],
          },
        ],
      },
    };
    await writeClaudeSettings(paths.claudeConfigDir, settings);
  },

  buildEnv(base, paths, _cfg) {
    // Use default Claude config for auth, project-level .claude/settings.json for hooks
    const env: NodeJS.ProcessEnv = {
      ...base,
      RERANK_PROVIDER: "codex",
      // Point memory-hook to workspace memories
      MEMORY_HOOK_DATA_DIR: paths.root,
      // Disable global hooks - the project hook explicitly sets MEMORY_HOOK_DISABLED=0
      MEMORY_HOOK_DISABLED: "1",
    };

    // Pass through API key for reranking
    if (process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }

    return env;
  },
};
