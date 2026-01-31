/**
 * Eval runner
 */
import { join } from "path";
import { run } from "../lib/proc";
import { readText, exists } from "../lib/fs";
import type { BenchConfig, EvalResult } from "../lib/types";
import type { EvalSpec } from "./evals";
import { getWorkspacePaths, prepareFreshWorkspace, writeVitestConfig } from "./workspace";
import { getConfig, type ConfigName } from "./configs";

interface RunEvalOptions {
  timeoutMs: number;
  retryOnTimeout: boolean;
  verbose: boolean;
}

async function runClaudeAgent(
  workspaceRoot: string,
  prompt: string,
  model: string,
  env: NodeJS.ProcessEnv,
  opts: RunEvalOptions
): Promise<{ success: boolean; timedOut: boolean; durationMs: number }> {
  const result = await run(
    "claude",
    [
      "--model", model,
      "--dangerously-skip-permissions",
      "-p", prompt,
    ],
    {
      cwd: workspaceRoot,
      env,
      timeoutMs: opts.timeoutMs,
    }
  );

  if (opts.verbose) {
    console.error(`  Agent: exit=${result.code} timeout=${result.timedOut} duration=${result.durationMs}ms`);
  }

  return {
    success: result.code === 0,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  };
}

async function runValidation(
  workspaceRoot: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ pass: boolean; error?: string }> {
  const result = await run(cmd, args, {
    cwd: workspaceRoot,
    env,
    timeoutMs,
  });

  return {
    pass: result.code === 0,
    error: result.code !== 0 ? result.stderr.slice(0, 500) : undefined,
  };
}

export async function runSingleEval(
  evalSpec: EvalSpec,
  configName: ConfigName,
  cfg: BenchConfig,
  opts: RunEvalOptions
): Promise<EvalResult> {
  const config = getConfig(configName);
  if (!config) {
    throw new Error(`Unknown config: ${configName}`);
  }

  const paths = getWorkspacePaths(cfg, evalSpec.id, configName);

  console.log(`  [${evalSpec.id}/${configName}] Preparing workspace...`);
  await prepareFreshWorkspace(paths, evalSpec.path);

  console.log(`  [${evalSpec.id}/${configName}] Applying config...`);
  await config.apply(paths, cfg);

  const env = config.buildEnv(process.env, paths, cfg);
  const prompt = await readText(evalSpec.promptPath);

  // Run agent (with optional retry)
  console.log(`  [${evalSpec.id}/${configName}] Running agent...`);
  let agentResult = await runClaudeAgent(paths.root, prompt, cfg.evalModel, env, opts);

  if (agentResult.timedOut && opts.retryOnTimeout) {
    console.log(`  [${evalSpec.id}/${configName}] Retrying after timeout...`);
    await prepareFreshWorkspace(paths, evalSpec.path);
    await config.apply(paths, cfg);
    agentResult = await runClaudeAgent(paths.root, prompt, cfg.evalModel, env, opts);
  }

  // Install dependencies
  console.log(`  [${evalSpec.id}/${configName}] Installing dependencies...`);
  const installResult = await run("bun", ["install"], {
    cwd: paths.root,
    env,
    timeoutMs: 120_000,
  });
  if (installResult.code !== 0 && opts.verbose) {
    console.error(`    Install warning: ${installResult.stderr.slice(0, 200)}`);
  }

  // Run validations
  console.log(`  [${evalSpec.id}/${configName}] Running validations...`);

  const buildResult = await runValidation(
    paths.root, "bun", ["run", "build"], env, 180_000
  );

  // Check if lint script exists before running
  let lintResult: { pass: boolean; error?: string } = { pass: true };
  const pkgPath = join(paths.root, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readText(pkgPath));
      if (pkg.scripts?.lint) {
        lintResult = await runValidation(
          paths.root, "bun", ["run", "lint"], env, 60_000
        );
      }
    } catch {
      // Skip lint if we can't parse package.json
    }
  }

  // Look for EVAL.ts - run with vitest
  const evalTsPath = join(paths.root, "EVAL.ts");
  let testResult: { pass: boolean; error?: string };
  
  if (await exists(evalTsPath)) {
    // Write vitest config that includes EVAL.ts
    await writeVitestConfig(paths.root);
    
    // Run with vitest via bun
    testResult = await runValidation(
      paths.root, "bunx", ["vitest", "run", "EVAL.ts"], env, 120_000
    );
  } else {
    // No EVAL.ts, skip test
    testResult = { pass: true };
  }

  // Count injected memories (if applicable)
  let memoriesInjected: number | undefined;
  const logPath = join(paths.root, ".claude/memory-hook/logs/memory-hook.jsonl");
  if (await exists(logPath)) {
    try {
      const logContent = await readText(logPath);
      const injections = logContent
        .split("\n")
        .filter((line) => line.includes('"event":"injection"'))
        .length;
      memoriesInjected = injections;
    } catch {
      // Ignore log parsing errors
    }
  }

  const overall = buildResult.pass && lintResult.pass && testResult.pass;

  return {
    eval: evalSpec.id,
    config: configName,
    build: buildResult,
    lint: lintResult,
    test: testResult,
    overall: { pass: overall },
    agent: {
      turns: 1, // TODO: parse transcript for actual turns
      memoriesInjected,
    },
  };
}

export async function runBench(
  evals: EvalSpec[],
  configNames: ConfigName[],
  cfg: BenchConfig,
  opts: RunEvalOptions
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const evalSpec of evals) {
    console.log(`\nRunning eval: ${evalSpec.id}`);
    
    for (const configName of configNames) {
      try {
        const result = await runSingleEval(evalSpec, configName, cfg, opts);
        results.push(result);
        
        const status = result.overall.pass ? "✓" : "✗";
        console.log(`  [${evalSpec.id}/${configName}] ${status}`);
      } catch (err) {
        console.error(`  [${evalSpec.id}/${configName}] ERROR: ${err}`);
        results.push({
          eval: evalSpec.id,
          config: configName,
          build: { pass: false, error: String(err) },
          lint: { pass: false },
          test: { pass: false },
          overall: { pass: false },
          agent: { turns: 0 },
        });
      }
    }
  }

  return results;
}
