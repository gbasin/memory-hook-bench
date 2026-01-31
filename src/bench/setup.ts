/**
 * Setup: clone next-evals-oss and fetch Next.js docs
 */
import { join } from "path";
import { run } from "../lib/proc";
import { exists, ensureDir, copyDir, rimraf } from "../lib/fs";
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

  // Get the actual commit SHA
  const shaResult = await run("git", ["rev-parse", "HEAD"], { cwd: evalsDir });
  const actualCommit = shaResult.stdout.trim();

  console.log(`Setup complete. Commit: ${actualCommit}`);

  return { commit: actualCommit };
}

export async function setupDocs(
  cfg: BenchConfig,
  opts: { ref?: string; force?: boolean } = {}
): Promise<{ ref: string }> {
  const ref = opts.ref || cfg.nextjsDocsRef;
  
  if (!ref) {
    console.error("Error: No ref specified. Use --ref <tag> or set NEXTJS_DOCS_REF");
    process.exit(3);
  }

  const nextjsDir = join(cfg.cacheDir, "next.js");
  
  // Check if docs already exist with content and not forcing
  if ((await exists(cfg.docsDir)) && !opts.force) {
    const indexFile = join(cfg.docsDir, "index.mdx");
    if (await exists(indexFile)) {
      console.log(`Docs already exist at ${cfg.docsDir}`);
      console.log("Use --force to re-fetch");
      return { ref };
    }
  }

  // Clone with sparse checkout if not present
  if (!(await exists(nextjsDir))) {
    console.log(`Cloning ${cfg.nextjsRepo} (sparse checkout for docs/)...`);
    await ensureDir(cfg.cacheDir);
    
    // Clone with no checkout, filter blobs
    const cloneResult = await run("git", [
      "clone",
      "--depth", "1",
      "--filter=blob:none",
      "--sparse",
      "--no-checkout",
      cfg.nextjsRepo,
      nextjsDir,
    ], {
      timeoutMs: 300_000,
    });
    
    if (cloneResult.code !== 0) {
      console.error("Failed to clone:", cloneResult.stderr);
      process.exit(3);
    }

    // Set sparse checkout to only include docs/
    console.log("Setting up sparse checkout for docs/...");
    const sparseResult = await run("git", ["sparse-checkout", "set", "docs"], {
      cwd: nextjsDir,
      timeoutMs: 60_000,
    });
    
    if (sparseResult.code !== 0) {
      console.error("Failed to set sparse checkout:", sparseResult.stderr);
      process.exit(3);
    }
  }

  // Fetch the ref
  console.log(`Fetching ref ${ref}...`);
  const fetchResult = await run("git", ["fetch", "--depth", "1", "origin", ref], {
    cwd: nextjsDir,
    timeoutMs: 300_000,
  });
  
  if (fetchResult.code !== 0) {
    console.error("Failed to fetch ref:", fetchResult.stderr);
    process.exit(3);
  }

  // Checkout the ref
  console.log(`Checking out ${ref}...`);
  const checkoutResult = await run("git", ["checkout", "FETCH_HEAD"], {
    cwd: nextjsDir,
    timeoutMs: 120_000,
  });

  if (checkoutResult.code !== 0) {
    console.error("Failed to checkout:", checkoutResult.stderr);
    process.exit(3);
  }

  // Copy docs to artifacts
  const srcDocs = join(nextjsDir, "docs");
  if (!(await exists(srcDocs))) {
    console.error("Error: docs/ not found in cloned repo");
    process.exit(3);
  }

  console.log(`Copying docs to ${cfg.docsDir}...`);
  if (await exists(cfg.docsDir)) {
    await rimraf(cfg.docsDir);
  }
  await ensureDir(cfg.artifactsDir);
  await copyDir(srcDocs, cfg.docsDir);

  // Count files
  const countResult = await run("find", [cfg.docsDir, "-name", "*.mdx", "-o", "-name", "*.md"], {
    timeoutMs: 30_000,
  });
  const fileCount = countResult.stdout.trim().split("\n").filter(Boolean).length;

  console.log(`\nSetup complete.`);
  console.log(`  Ref: ${ref}`);
  console.log(`  Docs: ${cfg.docsDir}`);
  console.log(`  Files: ${fileCount} markdown files`);

  return { ref };
}
