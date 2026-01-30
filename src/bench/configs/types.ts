/**
 * Benchmark scenario interface
 */
import type { BenchConfig } from "../../lib/types";
import type { WorkspacePaths } from "../workspace";

export type ConfigName = "baseline" | "agents-md" | "memory-hook" | "memory-no-rerank";

export interface BenchScenario {
  name: ConfigName;
  apply(paths: WorkspacePaths, cfg: BenchConfig): Promise<void>;
  buildEnv(base: NodeJS.ProcessEnv, paths: WorkspacePaths, cfg: BenchConfig): NodeJS.ProcessEnv;
}
