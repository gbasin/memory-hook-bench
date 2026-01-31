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

  buildEnv(base, _paths, _cfg) {
    // Use default Claude config for auth, project-level .claude/settings.json for hooks
    return { ...base };
  },
};
