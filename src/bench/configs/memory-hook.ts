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
            matcher: "Edit|Write|Read",
            hooks: [
              {
                type: "command",
                command: `bun run ${cfg.memoryHookPath}/src/memory-search.ts`,
              },
            ],
          },
        ],
      },
    };
    await writeClaudeSettings(paths.claudeConfigDir, settings);
  },

  buildEnv(base, paths, _cfg) {
    // Pass through ANTHROPIC_API_KEY for reranking
    const env: NodeJS.ProcessEnv = {
      ...base,
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: paths.root,
      RERANK_PROVIDER: "claude",
    };

    // Point memory-hook to workspace memories
    env.MEMORY_HOOK_DATA_DIR = paths.root;

    // Pass through API key for reranking
    if (process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }

    return env;
  },
};
