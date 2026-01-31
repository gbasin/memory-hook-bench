#!/usr/bin/env bun
/**
 * memory-hook-bench CLI
 * 
 * Benchmark runner for memory-hook vs AGENTS.md
 * 
 * Usage:
 *   memory-hook-bench setup --commit <sha>
 *   memory-hook-bench extract
 *   memory-hook-bench run --all
 *   memory-hook-bench run --evals 001,002 --configs baseline,memory-hook
 *   memory-hook-bench results
 */
import { join } from "path";
import { loadBenchConfig } from "./config";
import { setupBench, setupDocs } from "./setup";
import { discoverEvals, filterEvals } from "./evals";
import { runBench } from "./runner";
import { writeResults, loadLatestResults, formatMarkdownTable, computePassRates } from "./results";
import { ALL_CONFIG_NAMES, type ConfigName } from "./configs";
import { run } from "../lib/proc";

function printUsage() {
  console.log(`
memory-hook-bench - Benchmark memory-hook vs AGENTS.md

Commands:
  setup --commit <sha>     Clone next-evals-oss (eval suite)
  setup-docs [--ref tag]   Fetch Next.js docs (for memory extraction)
  extract [options]        Extract memories from docs
  run --all                Run all evals with all configs
  run --evals 001,002      Run specific evals
  run --configs baseline   Run specific configs
  results                  Show latest results

Environment:
  NEXT_EVALS_COMMIT        Default commit for setup
  NEXTJS_DOCS_REF          Default ref for setup-docs (default: v16.1.0)
  MEMORY_HOOK_PATH         Path to memory-hook package
  CLAUDE_PATH              Path to claude CLI (default: claude)
  ANTHROPIC_API_KEY        Required for reranking

Options (setup-docs):
  --ref <tag>              Git ref to fetch (tag, branch, or SHA)
  --force                  Re-fetch even if docs exist

Options (run):
  --all                    Run all evals and configs
  --evals <ids>            Comma-separated eval IDs
  --configs <names>        Comma-separated config names
  --timeout <ms>           Agent timeout (default: 600000)
  --no-retry               Don't retry on timeout
  --verbose                Show detailed output

Options (extract):
  --model <model>          Extraction model
  --concurrency <n>        Parallel extractions
  --chunk-size <n>         Chars per chunk
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

async function cmdExtract(args: string[]) {
  const cfg = loadBenchConfig();

  // Build args for docs-to-memories
  const extractArgs = [
    "run",
    join(import.meta.dir, "../docs-to-memories/cli.ts"),
    "extract",
    cfg.docsDir,
    "--output", cfg.memoriesJsonlPath,
  ];

  // Pass through options
  for (let i = 0; i < args.length; i++) {
    extractArgs.push(args[i]);
  }

  console.log("Running memory extraction...");
  const result = await run("bun", extractArgs, {
    stdio: "inherit",
    timeoutMs: 3600_000, // 1 hour
  });

  if (result.code !== 0) {
    console.error("Extraction failed");
    process.exit(4);
  }

  // Also write to LanceDB
  console.log("\nWriting to LanceDB...");
  const lanceArgs = [
    "run",
    join(import.meta.dir, "../docs-to-memories/cli.ts"),
    "extract",
    cfg.docsDir,
    "--output", `lancedb://${cfg.memoriesLancePath}`,
  ];

  for (let i = 0; i < args.length; i++) {
    lanceArgs.push(args[i]);
  }

  const lanceResult = await run("bun", lanceArgs, {
    stdio: "inherit",
    timeoutMs: 3600_000,
  });

  if (lanceResult.code !== 0) {
    console.error("LanceDB write failed");
    process.exit(5);
  }
}

async function cmdRun(args: string[]) {
  const cfg = loadBenchConfig();

  let evalIds: string[] = [];
  let configNames: ConfigName[] = [];
  let timeoutMs = 600_000;
  let retryOnTimeout = true;
  let verbose = false;
  let runAll = false;

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
    }
  }

  if (runAll) {
    configNames = ALL_CONFIG_NAMES;
  }

  if (configNames.length === 0) {
    configNames = ALL_CONFIG_NAMES;
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
    case "extract":
      await cmdExtract(cmdArgs);
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
