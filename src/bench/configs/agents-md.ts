/**
 * AGENTS.md config: static context via Vercel's codemod
 */
import { run } from "../../lib/proc";
import type { BenchScenario } from "./types";
import { writeClaudeSettings } from "../workspace";

export const agentsMd: BenchScenario = {
  name: "agents-md",

  async apply(paths, _cfg) {
    // Write minimal Claude settings (no hooks)
    await writeClaudeSettings(paths.claudeConfigDir, {});

    // Generate AGENTS.md using Vercel's codemod
    console.log(`    Generating AGENTS.md via codemod...`);
    const result = await run("npx", ["@next/codemod@canary", "agents-md"], {
      cwd: paths.root,
      timeoutMs: 120_000,
    });

    if (result.code !== 0) {
      console.warn(`    Warning: codemod failed: ${result.stderr.slice(0, 200)}`);
    }
  },

  buildEnv(base, _paths, _cfg) {
    // Use default Claude config for auth, project-level .claude/settings.json for hooks
    return { ...base };
  },
};
