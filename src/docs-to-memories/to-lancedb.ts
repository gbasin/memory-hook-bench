#!/usr/bin/env bun
/**
 * Convert extracted memories to LanceDB format with embeddings
 * 
 * Usage: bun run to-lancedb.ts <memories.json> <output-dir>
 */
import * as lancedb from "@lancedb/lancedb";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import type { Memory } from "./extractor";

interface LanceMemory {
  [key: string]: unknown;
  id: string;
  text: string;
  context: string;
  vector: number[];
}

let embedder: FeatureExtractionPipeline | null = null;

async function embed(text: string): Promise<number[]> {
  if (!embedder) {
    console.log("Loading embedding model...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

/**
 * Embed memories and write to LanceDB
 */
export async function writeToLanceDB(
  memories: Memory[],
  outputDir: string,
  options: { onProgress?: (current: number, total: number) => void } = {}
): Promise<void> {
  const lanceMemories: LanceMemory[] = [];
  
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    options.onProgress?.(i + 1, memories.length);
    process.stdout.write(`\rEmbedding ${i + 1}/${memories.length}...`);
    
    // Build context with optional example
    let context = m.rule;
    if (m.example) {
      context += `\n\nExample:\n${m.example}`;
    }
    context += `\n\n[Source: ${m.source} - ${m.section}]`;
    
    // Embed the trigger (what we search against)
    const vector = await embed(m.trigger);
    
    lanceMemories.push({
      id: randomUUID(),
      text: m.trigger,
      context,
      vector,
    });
  }
  
  console.log("\n");

  // Write to LanceDB
  const dbPath = `${outputDir}/memories.lance`;
  console.log(`Writing to ${dbPath}...`);
  const db = await lancedb.connect(dbPath);
  
  // Drop existing table if present
  const tables = await db.tableNames();
  if (tables.includes("memories")) {
    await db.dropTable("memories");
  }
  
  await db.createTable("memories", lanceMemories);
  console.log(`Done! ${lanceMemories.length} memories written.`);
}

// CLI entry point
async function main() {
  const [inputFile, outputDir] = process.argv.slice(2);
  
  if (!inputFile || !outputDir) {
    console.error("Usage: bun run to-lancedb.ts <memories.json> <output-dir>");
    process.exit(1);
  }

  // Load extracted memories
  const raw = JSON.parse(readFileSync(inputFile, "utf-8")) as Memory[];
  console.log(`Loaded ${raw.length} memories from ${inputFile}`);

  await writeToLanceDB(raw, outputDir);
}

// Only run main if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
