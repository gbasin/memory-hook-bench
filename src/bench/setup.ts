/**
 * Setup: clone next-evals-oss and copy docs
 */
import { join } from "path";
import { run } from "../lib/proc";
import { exists, ensureDir, copyDir } from "../lib/fs";
import type { BenchConfig } from "../lib/types";

export async function setupBench(
  cfg: BenchConfig,
  opts: { commit?: string } = {}
): Promise<{ commit: string }> {
  const commit = opts.commit || cfg.nextEvalsCommit;
  
  if (!commit) {
    console.error("Error: No commit specified. Use --commit <sha> or set NEXT_EVALS_COMMIT");
    process.exit(3);
  }

  const evalsDir = join(cfg.cacheDir, "next-evals-oss");
  
  // Clone if not present
  if (!(await exists(evalsDir))) {
    console.log(`Cloning ${cfg.nextEvalsRepo}...`);
    await ensureDir(cfg.cacheDir);
    
    const result = await run("git", ["clone", cfg.nextEvalsRepo, evalsDir], {
      timeoutMs: 300_000,
    });
    
    if (result.code !== 0) {
      console.error("Failed to clone:", result.stderr);
      process.exit(3);
    }
  }

  // Checkout commit
  console.log(`Checking out commit ${commit}...`);
  const checkoutResult = await run("git", ["checkout", commit], {
    cwd: evalsDir,
    timeoutMs: 60_000,
  });

  if (checkoutResult.code !== 0) {
    // Try fetching first
    console.log("Fetching latest...");
    await run("git", ["fetch", "origin"], { cwd: evalsDir, timeoutMs: 120_000 });
    
    const retryResult = await run("git", ["checkout", commit], {
      cwd: evalsDir,
      timeoutMs: 60_000,
    });
    
    if (retryResult.code !== 0) {
      console.error("Failed to checkout commit:", retryResult.stderr);
      process.exit(3);
    }
  }

  // Copy .next-docs to artifacts/docs
  const nextDocsDir = join(evalsDir, ".next-docs");
  if (!(await exists(nextDocsDir))) {
    console.error(`Error: .next-docs not found in ${evalsDir}`);
    console.error("This commit may not have the docs directory.");
    process.exit(3);
  }

  console.log(`Copying .next-docs to ${cfg.docsDir}...`);
  await ensureDir(cfg.artifactsDir);
  await copyDir(nextDocsDir, cfg.docsDir);

  // Get the actual commit SHA
  const shaResult = await run("git", ["rev-parse", "HEAD"], { cwd: evalsDir });
  const actualCommit = shaResult.stdout.trim();

  console.log(`Setup complete. Commit: ${actualCommit}`);
  console.log(`Docs copied to: ${cfg.docsDir}`);

  return { commit: actualCommit };
}
