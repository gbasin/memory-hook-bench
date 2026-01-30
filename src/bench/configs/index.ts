/**
 * Config registry
 */
import type { BenchScenario, ConfigName } from "./types";
import { baseline } from "./baseline";
import { agentsMd } from "./agents-md";
import { memoryHook } from "./memory-hook";
import { memoryNoRerank } from "./memory-no-rerank";

export const CONFIGS: Record<ConfigName, BenchScenario> = {
  baseline,
  "agents-md": agentsMd,
  "memory-hook": memoryHook,
  "memory-no-rerank": memoryNoRerank,
};

export const ALL_CONFIG_NAMES: ConfigName[] = [
  "baseline",
  "agents-md",
  "memory-hook",
  "memory-no-rerank",
];

export function getConfig(name: string): BenchScenario | undefined {
  return CONFIGS[name as ConfigName];
}

export type { BenchScenario, ConfigName };
