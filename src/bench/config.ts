/**
 * Benchmark configuration
 */
import { join } from "path";
import type { BenchConfig } from "../lib/types";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

export function loadBenchConfig(overrides: Partial<BenchConfig> = {}): BenchConfig {
  const defaults: BenchConfig = {
    nextEvalsRepo: "https://github.com/vercel/next-evals-oss.git",
    nextEvalsCommit: process.env.NEXT_EVALS_COMMIT || "",
    evalModel: "claude-opus-4-5-20251101",
    workRoot: "/tmp/memory-hook-bench",
    cacheDir: join(REPO_ROOT, ".cache"),
    artifactsDir: join(REPO_ROOT, "artifacts"),
    docsDir: join(REPO_ROOT, "artifacts/docs"),
    memoriesLancePath: join(REPO_ROOT, "artifacts/memories/memories.lance"),
    memoriesJsonlPath: join(REPO_ROOT, "artifacts/memories/memories.jsonl"),
    memoryHookPath: process.env.MEMORY_HOOK_PATH || join(REPO_ROOT, "../co11y/packages/memory-hook"),
    claudePath: process.env.CLAUDE_PATH || "claude",
  };

  return { ...defaults, ...overrides };
}
