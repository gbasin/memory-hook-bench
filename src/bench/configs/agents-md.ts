/**
 * AGENTS.md config: static context via AGENTS.md file
 */
import { join } from "path";
import { readText, writeText, exists } from "../../lib/fs";
import type { BenchScenario } from "./types";
import { writeClaudeSettings } from "../workspace";
import type { Memory } from "../../lib/types";

/**
 * Build AGENTS.md content from extracted memories
 */
export function buildAgentsMarkdown(
  memories: Memory[],
  opts: { maxChars?: number } = {}
): string {
  const maxChars = opts.maxChars ?? 50_000;

  const lines: string[] = [
    "# AGENTS.md",
    "",
    "Instructions for AI coding agents working on this Next.js codebase.",
    "",
    "## Patterns and Best Practices",
    "",
  ];

  // Group by source
  const bySource = new Map<string, Memory[]>();
  for (const m of memories) {
    const source = m.source || "general";
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(m);
  }

  let totalChars = lines.join("\n").length;

  for (const [source, sourceMemories] of bySource) {
    const section = [`### ${source}`, ""];
    
    for (const m of sourceMemories) {
      section.push(`- ${m.context}`);
    }
    section.push("");

    const sectionText = section.join("\n");
    if (totalChars + sectionText.length > maxChars) break;
    
    lines.push(...section);
    totalChars += sectionText.length;
  }

  return lines.join("\n");
}

export const agentsMd: BenchScenario = {
  name: "agents-md",

  async apply(paths, cfg) {
    // Write minimal Claude settings (no hooks)
    await writeClaudeSettings(paths.claudeConfigDir, {});

    // Load memories and generate AGENTS.md
    const memoriesPath = cfg.memoriesJsonlPath;
    if (!(await exists(memoriesPath))) {
      console.warn("Warning: memories.jsonl not found, creating empty AGENTS.md");
      await writeText(join(paths.root, "AGENTS.md"), "# AGENTS.md\n\nNo patterns extracted.\n");
      return;
    }

    const content = await readText(memoriesPath);
    const memories: Memory[] = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    const agentsContent = buildAgentsMarkdown(memories);
    await writeText(join(paths.root, "AGENTS.md"), agentsContent);
  },

  buildEnv(base, paths, _cfg) {
    return {
      ...base,
      CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      HOME: paths.root,
    };
  },
};
