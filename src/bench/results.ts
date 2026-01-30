/**
 * Results collection and reporting
 */
import { join } from "path";
import { writeText, readText, ensureDir, exists } from "../lib/fs";
import { readdir } from "fs/promises";
import type { EvalResult } from "../lib/types";

export interface RunMetadata {
  runId: string;
  timestamp: string;
  model: string;
  commit?: string;
  evalCount: number;
  configCount: number;
}

export interface PassRateRow {
  config: string;
  total: number;
  passed: number;
  passRate: number;
}

export function computePassRates(results: EvalResult[]): PassRateRow[] {
  const byConfig = new Map<string, { total: number; passed: number }>();

  for (const r of results) {
    if (!byConfig.has(r.config)) {
      byConfig.set(r.config, { total: 0, passed: 0 });
    }
    const stats = byConfig.get(r.config)!;
    stats.total++;
    if (r.overall.pass) stats.passed++;
  }

  const rows: PassRateRow[] = [];
  for (const [config, stats] of byConfig) {
    rows.push({
      config,
      total: stats.total,
      passed: stats.passed,
      passRate: stats.total > 0 ? (stats.passed / stats.total) * 100 : 0,
    });
  }

  // Sort by pass rate descending
  rows.sort((a, b) => b.passRate - a.passRate);

  return rows;
}

export function formatMarkdownTable(rows: PassRateRow[]): string {
  const lines = [
    "| Config | Pass Rate | Passed | Total |",
    "|--------|-----------|--------|-------|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.config} | ${row.passRate.toFixed(1)}% | ${row.passed} | ${row.total} |`
    );
  }

  return lines.join("\n");
}

export function formatFullReport(
  results: EvalResult[],
  meta: RunMetadata
): string {
  const passRates = computePassRates(results);
  const table = formatMarkdownTable(passRates);

  const lines = [
    "# Memory-Hook Benchmark Results",
    "",
    `**Run ID:** ${meta.runId}`,
    `**Date:** ${meta.timestamp}`,
    `**Model:** ${meta.model}`,
    meta.commit ? `**Commit:** ${meta.commit}` : "",
    `**Evals:** ${meta.evalCount}`,
    "",
    "## Summary",
    "",
    table,
    "",
    "## Per-Eval Results",
    "",
    "| Eval | Config | Build | Lint | Test | Overall |",
    "|------|--------|-------|------|------|---------|",
  ];

  // Sort results by eval ID then config
  const sorted = [...results].sort((a, b) => {
    const evalCmp = a.eval.localeCompare(b.eval);
    if (evalCmp !== 0) return evalCmp;
    return a.config.localeCompare(b.config);
  });

  for (const r of sorted) {
    const check = (v: boolean) => (v ? "✓" : "✗");
    lines.push(
      `| ${r.eval} | ${r.config} | ${check(r.build.pass)} | ${check(r.lint.pass)} | ${check(r.test.pass)} | ${check(r.overall.pass)} |`
    );
  }

  return lines.filter(Boolean).join("\n");
}

export async function writeResults(
  resultsDir: string,
  results: EvalResult[],
  meta: RunMetadata
): Promise<string> {
  await ensureDir(resultsDir);

  const runDir = join(resultsDir, meta.runId);
  await ensureDir(runDir);

  // Write raw results
  const rawPath = join(runDir, "results.json");
  await writeText(rawPath, JSON.stringify({ meta, results }, null, 2));

  // Write markdown report
  const reportPath = join(runDir, "report.md");
  const report = formatFullReport(results, meta);
  await writeText(reportPath, report);

  console.log(`Results written to ${runDir}`);
  return runDir;
}

export async function loadLatestResults(
  resultsDir: string
): Promise<{ meta: RunMetadata; results: EvalResult[] } | null> {
  if (!(await exists(resultsDir))) return null;

  const entries = await readdir(resultsDir, { withFileTypes: true });
  const runDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  if (runDirs.length === 0) return null;

  const latestDir = join(resultsDir, runDirs[0]);
  const rawPath = join(latestDir, "results.json");

  if (!(await exists(rawPath))) return null;

  const content = await readText(rawPath);
  return JSON.parse(content);
}
