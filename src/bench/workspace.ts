/**
 * Workspace isolation for eval runs
 */
import { join } from "path";
import { ensureDir, rimraf, copyDir, exists, writeText } from "../lib/fs";
import { run } from "../lib/proc";
import type { BenchConfig } from "../lib/types";

export interface WorkspacePaths {
  root: string;
  claudeConfigDir: string;
  memoriesLancePath: string;
}

export function getWorkspacePaths(
  cfg: BenchConfig,
  evalId: string,
  configName: string
): WorkspacePaths {
  const root = join(cfg.workRoot, evalId, configName);
  return {
    root,
    claudeConfigDir: join(root, ".claude"),
    memoriesLancePath: join(root, "memories.lance"),
  };
}

export async function prepareFreshWorkspace(
  paths: WorkspacePaths,
  evalPath: string
): Promise<void> {
  // Clean and recreate
  await rimraf(paths.root);
  await ensureDir(paths.root);
  await ensureDir(paths.claudeConfigDir);

  // Copy eval contents to workspace
  await copyDir(evalPath, paths.root);

  // Remove any existing AGENTS.md or CLAUDE.md
  const agentsMd = join(paths.root, "AGENTS.md");
  const claudeMd = join(paths.root, "CLAUDE.md");
  if (await exists(agentsMd)) await rimraf(agentsMd);
  if (await exists(claudeMd)) await rimraf(claudeMd);

  // Initialize git repo (Claude Code needs this)
  await run("git", ["init"], { cwd: paths.root, timeoutMs: 10_000 });
  await run("git", ["add", "."], { cwd: paths.root, timeoutMs: 10_000 });
  await run("git", ["commit", "-m", "Initial eval setup"], { cwd: paths.root, timeoutMs: 10_000 });
}

export async function writeClaudeSettings(
  claudeConfigDir: string,
  settings: Record<string, unknown>
): Promise<void> {
  const settingsPath = join(claudeConfigDir, "settings.json");
  await writeText(settingsPath, JSON.stringify(settings, null, 2));
}

export async function writeVitestConfig(workspaceRoot: string): Promise<void> {
  // Write vitest config that includes EVAL.ts
  const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['EVAL.ts', '**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
});
`;
  const configPath = join(workspaceRoot, "vitest.config.ts");
  await writeText(configPath, vitestConfig);
}

export async function copyMemoriesDb(
  sourceLancePath: string,
  destLancePath: string
): Promise<void> {
  if (await exists(sourceLancePath)) {
    await copyDir(sourceLancePath, destLancePath);
  }
}
