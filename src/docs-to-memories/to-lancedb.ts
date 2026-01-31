#!/usr/bin/env bun
/**
 * Convert extracted memories to LanceDB format with embeddings
 * 
 * Usage: bun run src/docs-to-memories/to-lancedb.ts <memories.json> <output.lance>
 */
import * as lancedb from "@lancedb/lancedb";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

interface ExtractedMemory {
  trigger: string;
  rule: string;
  source: string;
  section: string;
  example?: string;
}

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

async function main() {
  const [inputFile, outputPath] = process.argv.slice(2);
  
  if (!inputFile || !outputPath) {
    console.error("Usage: bun run to-lancedb.ts <memories.json> <output.lance>");
    process.exit(1);
  }

  // Load extracted memories
  const raw = JSON.parse(readFileSync(inputFile, "utf-8")) as ExtractedMemory[];
  console.log(`Loaded ${raw.length} memories from ${inputFile}`);

  // Convert and embed
  const memories: LanceMemory[] = [];
  
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    process.stdout.write(`\rEmbedding ${i + 1}/${raw.length}...`);
    
    // Build context with optional example
    let context = m.rule;
    if (m.example) {
      context += `\n\nExample:\n${m.example}`;
    }
    context += `\n\n[Source: ${m.source} - ${m.section}]`;
    
    // Embed the trigger (what we search against)
    const vector = await embed(m.trigger);
    
    memories.push({
      id: randomUUID(),
      text: m.trigger,
      context,
      vector,
    });
  }
  
  console.log("\n");

  // Write to LanceDB
  console.log(`Writing to ${outputPath}...`);
  const db = await lancedb.connect(outputPath);
  
  // Drop existing table if present
  const tables = await db.tableNames();
  if (tables.includes("memories")) {
    await db.dropTable("memories");
  }
  
  await db.createTable("memories", memories);
  console.log(`Done! ${memories.length} memories written.`);
}

main().catch(console.error);
