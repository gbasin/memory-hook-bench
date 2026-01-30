#!/usr/bin/env bun
/**
 * docs-to-memories CLI
 * 
 * Extracts memories from documentation using Claude Code headless.
 * 
 * Usage:
 *   docs-to-memories extract ./docs --output memories.json
 *   docs-to-memories extract ./docs --output lancedb://./memories.lance
 */
import { buildChunksFromDir } from "./chunking";
import { extractFromChunk } from "./claude";
import { parseMemoriesFromModelOutput, finalizeMemories } from "./parse";
import { writeJsonl, writeLanceDb, parseOutputUri } from "./output";
import { exists } from "../lib/fs";
import type { Memory } from "../lib/types";

interface ExtractOptions {
  model: string;
  concurrency: number;
  chunkSize: number;
  overlap: number;
  dryRun: boolean;
  verbose: boolean;
  claudePath: string;
  timeoutMs: number;
}

async function extract(
  docsPath: string,
  outputUri: string,
  opts: ExtractOptions
): Promise<void> {
  // Validate input path
  if (!(await exists(docsPath))) {
    console.error(`Error: docs path not found: ${docsPath}`);
    process.exit(3);
  }

  console.log(`Scanning docs in ${docsPath}...`);

  // Build chunks
  const chunks = await buildChunksFromDir(docsPath, {
    chunkSize: opts.chunkSize,
    overlap: opts.overlap,
    includeExt: [".md", ".mdx"],
    excludeDirs: ["node_modules", ".git", "dist", "build"],
  });

  console.log(`Found ${chunks.length} chunks from docs`);

  if (opts.dryRun) {
    console.log("Dry run - would extract from these chunks:");
    for (const chunk of chunks.slice(0, 10)) {
      console.log(`  ${chunk.source}#${chunk.chunkIndex}`);
    }
    if (chunks.length > 10) {
      console.log(`  ... and ${chunks.length - 10} more`);
    }
    return;
  }

  // Extract memories with concurrency
  const allRawMemories: Array<{ text: string; context: string; source: string }> = [];
  
  // Process in batches for concurrency
  for (let i = 0; i < chunks.length; i += opts.concurrency) {
    const batch = chunks.slice(i, i + opts.concurrency);
    console.log(`Processing chunks ${i + 1}-${Math.min(i + opts.concurrency, chunks.length)} of ${chunks.length}...`);

    const results = await Promise.all(
      batch.map(async (chunk) => {
        const output = await extractFromChunk(chunk, {
          model: opts.model,
          claudePath: opts.claudePath,
          timeoutMs: opts.timeoutMs,
          verbose: opts.verbose,
        });
        return parseMemoriesFromModelOutput(output, chunk.source);
      })
    );

    for (const memories of results) {
      allRawMemories.push(...memories);
    }
  }

  // Finalize (dedupe, assign IDs)
  const memories = finalizeMemories(allRawMemories);
  console.log(`Extracted ${memories.length} unique memories`);

  // Write output
  const { type, path } = parseOutputUri(outputUri);
  if (type === "lancedb") {
    await writeLanceDb(path, memories);
  } else {
    await writeJsonl(path, memories);
  }
}

function printUsage() {
  console.log(`
docs-to-memories - Extract memories from documentation

Usage:
  docs-to-memories extract <docs-path> --output <output-uri> [options]

Output formats:
  --output memories.json           Write JSONL file
  --output lancedb://./memories.lance  Write to LanceDB

Options:
  --model <model>       Model to use (default: claude-opus-4-5-20251101)
  --concurrency <n>     Parallel extractions (default: 3)
  --chunk-size <n>      Max chars per chunk (default: 8000)
  --overlap <n>         Overlap between chunks (default: 200)
  --claude-path <path>  Path to claude CLI (default: claude)
  --timeout <ms>        Timeout per chunk (default: 180000)
  --dry-run             Show what would be extracted
  --verbose             Show detailed progress
  --help                Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  if (command !== "extract") {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(2);
  }

  // Parse arguments
  let docsPath = "";
  let outputUri = "";
  const opts: ExtractOptions = {
    model: "claude-opus-4-5-20251101",
    concurrency: 3,
    chunkSize: 8000,
    overlap: 200,
    dryRun: false,
    verbose: false,
    claudePath: "claude",
    timeoutMs: 180_000,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--output":
      case "-o":
        outputUri = args[++i];
        break;
      case "--model":
      case "-m":
        opts.model = args[++i];
        break;
      case "--concurrency":
      case "-c":
        opts.concurrency = parseInt(args[++i], 10);
        break;
      case "--chunk-size":
        opts.chunkSize = parseInt(args[++i], 10);
        break;
      case "--overlap":
        opts.overlap = parseInt(args[++i], 10);
        break;
      case "--claude-path":
        opts.claudePath = args[++i];
        break;
      case "--timeout":
        opts.timeoutMs = parseInt(args[++i], 10);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      default:
        if (!arg.startsWith("-") && !docsPath) {
          docsPath = arg;
        } else {
          console.error(`Unknown argument: ${arg}`);
          process.exit(2);
        }
    }
  }

  if (!docsPath) {
    console.error("Error: docs path required");
    process.exit(2);
  }

  if (!outputUri) {
    console.error("Error: --output required");
    process.exit(2);
  }

  await extract(docsPath, outputUri, opts);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
