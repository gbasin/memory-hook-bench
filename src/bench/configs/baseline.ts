/**
 * Baseline config: no AGENTS.md, no memory-hook
 */
import type { BenchScenario } from "./types";
import { writeClaudeSettings } from "../workspace";

export const baseline: BenchScenario = {
  name: "baseline",

  async apply(paths, _cfg) {
    // Write minimal Claude settings (no hooks)
    await writeClaudeSettings(paths.claudeConfigDir, {});
  },

  buildEnv(base, paths, _cfg) {
    return {
      ...base,
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: paths.root,
    };
  },
};
