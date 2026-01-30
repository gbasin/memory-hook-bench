/**
 * Memory-hook without reranking: vector search only
 */
import type { BenchScenario } from "./types";
import { writeClaudeSettings, copyMemoriesDb } from "../workspace";

export const memoryNoRerank: BenchScenario = {
  name: "memory-no-rerank",

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
    // Do NOT pass ANTHROPIC_API_KEY - forces fallback to threshold
    const env: NodeJS.ProcessEnv = {
      ...base,
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: paths.root,
      RERANK_PROVIDER: "claude",
      // Explicitly remove API key to disable reranking
    };

    // Point memory-hook to workspace memories
    env.MEMORY_HOOK_DATA_DIR = paths.root;

    // Remove ANTHROPIC_API_KEY to disable reranking
    delete env.ANTHROPIC_API_KEY;

    return env;
  },
};
