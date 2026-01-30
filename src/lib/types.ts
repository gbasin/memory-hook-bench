/**
 * Shared types for memory-hook-bench
 */

export interface Memory {
  id: string;
  text: string;      // embedded for vector search
  context: string;   // injected advice
  source: string;    // source doc path
}

export interface LanceMemoryRow extends Memory {
  vector: number[];
}

export interface EvalResult {
  eval: string;
  config: string;
  build: { pass: boolean; error?: string };
  lint: { pass: boolean; error?: string };
  test: { pass: boolean; error?: string };
  overall: { pass: boolean };
  agent: {
    turns: number;
    memoriesInjected?: number;
  };
}

export interface BenchConfig {
  nextEvalsRepo: string;
  nextEvalsCommit: string;
  evalModel: string;
  workRoot: string;
  cacheDir: string;
  artifactsDir: string;
  docsDir: string;
  memoriesLancePath: string;
  memoriesJsonlPath: string;
  memoryHookPath: string;
  claudePath: string;
}

export interface Chunk {
  source: string;
  chunkIndex: number;
  totalChunks: number;
  text: string;
}
