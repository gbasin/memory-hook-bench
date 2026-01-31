#!/usr/bin/env bun
/**
 * memory-hook-bench CLI
 * 
 * Benchmark runner for memory-hook vs AGENTS.md
 * 
 * Usage:
 *   memory-hook-bench setup --commit <sha>
 *   memory-hook-bench setup-docs [--ref tag]
 *   memory-hook-bench extract-memories [--verbose]
 *   memory-hook-bench run --all
 *   memory-hook-bench run --evals 001,002 --configs baseline,memory-hook
 *   memory-hook-bench results
 */
import { join, dirname } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { loadBenchConfig } from "./config";
import { setupBench, setupDocs } from "./setup";
import { discoverEvals, filterEvals } from "./evals";
import { runBench } from "./runner";
import { writeResults, loadLatestResults, formatMarkdownTable, computePassRates } from "./results";
import { ALL_CONFIG_NAMES, type ConfigName } from "./configs";
import { extractFromDirectory } from "../docs-to-memories/extractor";
import { writeToLanceDB } from "../docs-to-memories/to-lancedb";

function printUsage() {
  console.log(`
memory-hook-bench - Benchmark memory-hook vs AGENTS.md

Commands:
  setup --commit <sha>       Clone next-evals-oss (eval suite)
  setup-docs [--ref tag]     Fetch Next.js docs (for memory extraction)
  extract-memories           Extract memories from docs and write to LanceDB
  run --all                  Run all evals with all configs
  run --evals 001,002        Run specific evals
  run --configs baseline     Run specific configs
  results                    Show latest results

Environment:
  NEXT_EVALS_COMMIT          Default commit for setup
  NEXTJS_DOCS_REF            Default ref for setup-docs (default: v16.1.0)
  MEMORY_HOOK_PATH           Path to memory-hook package
  CLAUDE_PATH                Path to claude CLI (default: claude)

Options (setup-docs):
  --ref <tag>                Git ref to fetch (tag, branch, or SHA)
  --force                    Re-fetch even if docs exist

Options (extract-memories):
  --verbose, -v              Show detailed progress per file/section
  --workers <n>              Parallel workers for extraction (default: 1)
  --skip-lancedb             Only extract JSON, don't embed to LanceDB

Options (run):
  --all                      Run all evals and configs
  --evals <ids>              Comma-separated eval IDs
  --configs <names>          Comma-separated config names
  --timeout <ms>             Agent timeout (default: 600000)
  --no-retry                 Don't retry on timeout
  --verbose                  Show detailed output
  --skip-db-check            Skip memory DB existence check
`);
}

async function cmdSetup(args: string[]) {
  let commit: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--commit") {
      commit = args[++i];
    }
  }

  const cfg = loadBenchConfig();
  await setupBench(cfg, { commit });
}

async function cmdSetupDocs(args: string[]) {
  let ref: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ref") {
      ref = args[++i];
    } else if (arg === "--force") {
      force = true;
    }
  }

  const cfg = loadBenchConfig();
  await setupDocs(cfg, { ref, force });
}

async function cmdExtractMemories(args: string[]) {
  const cfg = loadBenchConfig();
  const verbose = args.includes("--verbose") || args.includes("-v");
  const skipLanceDb = args.includes("--skip-lancedb");
  
  let workers = 1;
  const workersIdx = args.indexOf("--workers");
  if (workersIdx !== -1 && args[workersIdx + 1]) {
    workers = parseInt(args[workersIdx + 1], 10);
    if (isNaN(workers) || workers < 1) workers = 1;
    if (workers > 8) {
      console.warn(`Warning: ${workers} workers may overwhelm Claude CLI, capping at 8`);
      workers = 8;
    }
  }

  // Check if docs exist
  if (!existsSync(cfg.docsDir)) {
    console.error(`Docs directory not found: ${cfg.docsDir}`);
    console.error(`Run 'memory-hook-bench setup-docs' first.`);
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`MEMORY EXTRACTION`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Source: ${cfg.docsDir}`);
  console.log(`Output: ${cfg.memoriesLancePath}`);
  console.log(`${"=".repeat(60)}\n`);

  // Extract memories from all docs
  const memories = await extractFromDirectory(cfg.docsDir, { verbose, workers });

  if (memories.length === 0) {
    console.warn("\nNo memories extracted. Check if docs contain actionable content.");
    process.exit(1);
  }

  console.log(`\nExtracted ${memories.length} memories total`);

  // Write JSON backup
  const jsonPath = cfg.memoriesJsonlPath.replace(".jsonl", ".json");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(memories, null, 2));
  console.log(`Written JSON to: ${jsonPath}`);

  // Write to LanceDB
  if (!skipLanceDb) {
    console.log(`\nEmbedding and writing to LanceDB...`);
    const lanceDir = dirname(cfg.memoriesLancePath);
    await mkdir(lanceDir, { recursive: true });
    await writeToLanceDB(memories, lanceDir);
  }

  console.log(`\n✓ Extraction complete!`);
}

function checkMemoriesDbExists(cfg: ReturnType<typeof loadBenchConfig>): boolean {
  const lanceDir = dirname(cfg.memoriesLancePath);
  return existsSync(join(lanceDir, "memories.lance"));
}

async function cmdRun(args: string[]) {
  const cfg = loadBenchConfig();

  let evalIds: string[] = [];
  let configNames: ConfigName[] = [];
  let timeoutMs = 600_000;
  let retryOnTimeout = true;
  let verbose = false;
  let runAll = false;
  let skipDbCheck = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--all":
        runAll = true;
        break;
      case "--evals":
        evalIds = args[++i].split(",").map((s) => s.trim());
        break;
      case "--configs":
        configNames = args[++i].split(",").map((s) => s.trim()) as ConfigName[];
        break;
      case "--timeout":
        timeoutMs = parseInt(args[++i], 10);
        break;
      case "--no-retry":
        retryOnTimeout = false;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      case "--skip-db-check":
        skipDbCheck = true;
        break;
    }
  }

  if (runAll) {
    configNames = ALL_CONFIG_NAMES;
  }

  if (configNames.length === 0) {
    configNames = ALL_CONFIG_NAMES;
  }

  // Check if memory-hook config is requested but DB doesn't exist
  if (!skipDbCheck && configNames.includes("memory-hook")) {
    if (!checkMemoriesDbExists(cfg)) {
      console.warn(`\n⚠️  WARNING: Memory database not found!`);
      console.warn(`   Expected: ${cfg.memoriesLancePath}`);
      console.warn(`   The 'memory-hook' config requires extracted memories.`);
      console.warn(`\n   Run 'memory-hook-bench extract-memories' first,`);
      console.warn(`   or use '--skip-db-check' to proceed anyway.\n`);
      process.exit(1);
    }
  }

  // Discover evals
  const evalsRoot = join(cfg.cacheDir, "next-evals-oss");
  const allEvals = await discoverEvals(evalsRoot);

  if (allEvals.length === 0) {
    console.error("No evals found. Run 'memory-hook-bench setup' first.");
    process.exit(3);
  }

  const evals = evalIds.length > 0 ? filterEvals(allEvals, evalIds) : allEvals;

  console.log(`Running ${evals.length} evals × ${configNames.length} configs = ${evals.length * configNames.length} runs`);
  console.log(`Configs: ${configNames.join(", ")}`);
  console.log(`Model: ${cfg.evalModel}`);
  console.log();

  const results = await runBench(evals, configNames, cfg, {
    timeoutMs,
    retryOnTimeout,
    verbose,
  });

  // Generate run ID
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const meta = {
    runId,
    timestamp: new Date().toISOString(),
    model: cfg.evalModel,
    evalCount: evals.length,
    configCount: configNames.length,
  };

  await writeResults(join(cfg.artifactsDir, "results"), results, meta);

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50) + "\n");

  const passRates = computePassRates(results);
  console.log(formatMarkdownTable(passRates));
}

async function cmdResults(_args: string[]) {
  const cfg = loadBenchConfig();
  const resultsDir = join(cfg.artifactsDir, "results");

  const data = await loadLatestResults(resultsDir);
  if (!data) {
    console.log("No results found. Run 'memory-hook-bench run' first.");
    return;
  }

  console.log(`Results from: ${data.meta.runId}`);
  console.log(`Model: ${data.meta.model}`);
  console.log(`Evals: ${data.meta.evalCount}`);
  console.log();

  const passRates = computePassRates(data.results);
  console.log(formatMarkdownTable(passRates));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const cmdArgs = args.slice(1);

  switch (command) {
    case "setup":
      await cmdSetup(cmdArgs);
      break;
    case "setup-docs":
      await cmdSetupDocs(cmdArgs);
      break;
    case "extract-memories":
      await cmdExtractMemories(cmdArgs);
      break;
    case "run":
      await cmdRun(cmdArgs);
      break;
    case "results":
      await cmdResults(cmdArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(2);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
