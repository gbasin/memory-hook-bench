#!/usr/bin/env bun
/**
 * Markdown-aware memory extraction with heuristics + LLM
 * 
 * Single file:
 *   bun run extractor.ts <file.mdx> [--extract]
 *
 * Batch (all .mdx files):
 *   bun run extractor.ts --dir <docs-dir> --out <output.json>
 */

import { readFileSync } from "fs";
import { readdir, writeFile } from "fs/promises";
import { join, relative } from "path";
import { $ } from "bun";

// Strong signals - almost always actionable
const STRONG_SIGNALS = [
  /good to know/i,
  /warning:/i,
  /note:/i,
  /important:/i,
  /\bdon't\b/i,
  /\bavoid\b/i,
  /instead of/i,
  /prefer\s+\w+\s+over/i,
  /common mistake/i,
  /\berror\b.*\bwhen\b/i,
];

// Medium signals - actionable if has context
const MEDIUM_SIGNALS = [
  /```\w+/,  // Has code block
  /for example/i,
  /you can/i,
  /you should/i,
  /make sure/i,
  /be careful/i,
];

// Skip patterns
const SKIP_PATTERNS = [
  /^version history$/i,
  /^installation$/i,
  /^setup$/i,
];

export interface Section {
  level: number;
  title: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

export interface Memory {
  trigger: string;
  rule: string;
  source: string;
  section: string;
  example?: string;
}

export function parseMarkdownSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);

    if (headerMatch) {
      if (currentSection) {
        currentSection.lineEnd = i - 1;
        currentSection.content = lines
          .slice(currentSection.lineStart + 1, i)
          .join("\n")
          .trim();
        sections.push(currentSection);
      }

      currentSection = {
        level: headerMatch[1].length,
        title: headerMatch[2].replace(/`/g, ""),
        lineStart: i,
        lineEnd: -1,
        content: "",
      };
    }
  }

  if (currentSection) {
    currentSection.lineEnd = lines.length - 1;
    currentSection.content = lines
      .slice(currentSection.lineStart + 1)
      .join("\n")
      .trim();
    sections.push(currentSection);
  }

  return sections;
}

export function shouldExtract(section: Section): { extract: boolean; reason: string } {
  const content = section.content;
  const title = section.title;

  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(title)) {
      return { extract: false, reason: "skip pattern" };
    }
  }

  const lines = content.split("\n").filter(l => l.trim());
  const tableLines = lines.filter(l => /^\s*\|.*\|\s*$/.test(l));
  if (lines.length > 3 && tableLines.length / lines.length > 0.7) {
    return { extract: false, reason: "mostly table" };
  }

  const strongSignals: string[] = [];
  for (const pattern of STRONG_SIGNALS) {
    if (pattern.test(content)) strongSignals.push(pattern.source);
  }

  const mediumSignals: string[] = [];
  for (const pattern of MEDIUM_SIGNALS) {
    if (pattern.test(content)) mediumSignals.push(pattern.source);
  }

  if (strongSignals.length > 0) {
    return { extract: true, reason: "strong signal" };
  }
  if (mediumSignals.length >= 2) {
    return { extract: true, reason: "multiple medium" };
  }
  if (mediumSignals.length === 1 && content.length > 300) {
    return { extract: true, reason: "medium + length" };
  }
  if (content.length < 100) {
    return { extract: false, reason: "too short" };
  }

  return { extract: false, reason: "no signals" };
}

export async function extractMemory(section: Section, docPath: string): Promise<Memory | null> {
  const prompt = `You are extracting an actionable coding pattern from documentation.

Document: ${docPath}
Section: ${section.title}

Content:
---
${section.content.slice(0, 4000)}
---

If this section contains actionable advice that would help a developer writing code, output JSON:
{
  "trigger": "keywords for semantic search: API names, import paths, function names, error messages, symptoms that indicate this advice applies",
  "rule": "the actionable advice in 1-3 sentences - what to do or avoid",
  "example": "short code snippet if helpful (optional, omit key if not needed)"
}

Guidelines:
- trigger: optimize for matching against code + imports, e.g. "next/link Link href navigation <a> anchor"
- rule: be specific and actionable, not conceptual
- Skip if purely informational with no concrete advice

Output only valid JSON or the word SKIP if not actionable.`;

  try {
    const result = await $`claude --model claude-sonnet-4-20250514 -p ${prompt} --output-format text`.quiet();
    const text = result.stdout.toString().trim();
    
    if (text === "SKIP" || text.toLowerCase() === "skip") {
      return null;
    }

    // Extract JSON from response
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      return null;
    }

    const parsed = JSON.parse(objMatch[0]);
    
    if (!parsed.trigger || !parsed.rule) {
      return null;
    }

    return {
      trigger: parsed.trigger,
      rule: parsed.rule,
      source: docPath,
      section: section.title,
      example: parsed.example,
    };
  } catch (err) {
    console.error(`  Error: ${err}`);
    return null;
  }
}

/**
 * Extract memories from a single file
 */
export async function extractFromFile(
  filePath: string,
  options: { verbose?: boolean } = {}
): Promise<Memory[]> {
  const content = readFileSync(filePath, "utf-8");
  const sections = parseMarkdownSections(content);
  
  const toExtract = sections.filter(s => shouldExtract(s).extract);
  
  if (options.verbose) {
    console.log(`  ${toExtract.length}/${sections.length} sections to extract`);
  }

  const memories: Memory[] = [];
  
  for (const section of toExtract) {
    const memory = await extractMemory(section, filePath);
    if (memory) {
      memories.push(memory);
    }
  }

  return memories;
}

/**
 * Recursively find all .mdx files in a directory
 */
async function findMdxFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  
  await walk(dir);
  return files.sort();
}

/**
 * Run tasks with limited concurrency
 */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Batch extract memories from all .mdx files in a directory
 */
export async function extractFromDirectory(
  docsDir: string,
  options: { verbose?: boolean; workers?: number; onProgress?: (current: number, total: number, file: string) => void } = {}
): Promise<Memory[]> {
  const concurrency = options.workers ?? 1;
  const files = await findMdxFiles(docsDir);
  
  if (files.length === 0) {
    console.warn(`No .mdx/.md files found in ${docsDir}`);
    return [];
  }

  console.log(`Found ${files.length} markdown files (${concurrency} worker${concurrency > 1 ? 's' : ''})`);
  
  // First pass: analyze all files to find sections to extract
  interface FileWork {
    file: string;
    relPath: string;
    sections: Section[];
  }
  
  const work: FileWork[] = [];
  let totalSections = 0;
  
  for (const file of files) {
    const relPath = relative(docsDir, file);
    const content = readFileSync(file, "utf-8");
    const sections = parseMarkdownSections(content);
    const toExtract = sections.filter(s => shouldExtract(s).extract);
    
    if (toExtract.length > 0) {
      work.push({ file, relPath, sections: toExtract });
      totalSections += toExtract.length;
    }
  }

  console.log(`Found ${totalSections} sections to extract across ${work.length} files`);
  
  if (totalSections === 0) {
    return [];
  }

  // Flatten to section-level work items for better parallelization
  interface SectionWork {
    file: string;
    relPath: string;
    section: Section;
  }
  
  const sectionWork: SectionWork[] = [];
  for (const w of work) {
    for (const section of w.sections) {
      sectionWork.push({ file: w.file, relPath: w.relPath, section });
    }
  }

  // Extract with parallelism
  let completed = 0;
  const allMemories: (Memory | null)[] = await parallelMap(
    sectionWork,
    async (item, _index) => {
      const memory = await extractMemory(item.section, item.file);
      completed++;
      
      if (options.verbose) {
        const status = memory ? "✓" : "⊘";
        console.log(`[${completed}/${totalSections}] ${item.relPath} - ${item.section.title} ${status}`);
      } else {
        process.stdout.write(`\r[${completed}/${totalSections}] Extracting...`);
      }
      
      return memory;
    },
    concurrency
  );

  if (!options.verbose) {
    console.log(); // newline after progress
  }

  return allMemories.filter((m): m is Memory => m !== null);
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  
  // Batch mode: --dir <docs-dir> --out <output.json>
  const dirIndex = args.indexOf("--dir");
  const outIndex = args.indexOf("--out");
  
  if (dirIndex !== -1) {
    const docsDir = args[dirIndex + 1];
    const outFile = outIndex !== -1 ? args[outIndex + 1] : "memories.json";
    const verbose = args.includes("--verbose") || args.includes("-v");
    
    if (!docsDir) {
      console.error("Usage: bun run extractor.ts --dir <docs-dir> --out <output.json>");
      process.exit(1);
    }

    console.log(`\nExtracting memories from: ${docsDir}`);
    console.log(`Output: ${outFile}\n`);

    const memories = await extractFromDirectory(docsDir, { verbose });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`TOTAL: ${memories.length} memories extracted`);
    console.log(`${"=".repeat(60)}\n`);

    await writeFile(outFile, JSON.stringify(memories, null, 2));
    console.log(`Written to: ${outFile}`);
    return;
  }

  // Single file mode
  const file = args.find(a => !a.startsWith("-"));
  const doExtract = args.includes("--extract");

  if (!file) {
    console.error(`Usage:
  Single file: bun run extractor.ts <file.mdx> [--extract]
  Batch:       bun run extractor.ts --dir <docs-dir> --out <output.json> [--verbose]`);
    process.exit(1);
  }

  const content = readFileSync(file, "utf-8");
  const sections = parseMarkdownSections(content);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`FILE: ${file}`);
  console.log(`SECTIONS: ${sections.length}`);
  console.log(`MODE: ${doExtract ? "EXTRACT" : "ANALYZE"}`);
  console.log(`${"=".repeat(60)}\n`);

  const toExtract: Section[] = [];
  
  for (const section of sections) {
    const { extract, reason } = shouldExtract(section);
    const icon = extract ? "✅" : "⏭️ ";
    console.log(`${icon} [H${section.level}] ${section.title} (${reason})`);
    
    if (extract) {
      toExtract.push(section);
    }
  }

  console.log(`\n→ ${toExtract.length} sections to extract\n`);

  if (!doExtract) {
    console.log("Run with --extract to call LLM and generate memories");
    return;
  }

  console.log("Extracting memories...\n");
  const memories: Memory[] = [];
  
  for (const section of toExtract) {
    process.stdout.write(`  ${section.title}... `);
    const memory = await extractMemory(section, file);
    if (memory) {
      memories.push(memory);
      console.log("✓");
    } else {
      console.log("⊘");
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`EXTRACTED: ${memories.length} memories`);
  console.log(`${"=".repeat(60)}\n`);

  for (const mem of memories) {
    console.log(`--- ${mem.section} ---`);
    console.log(`trigger: ${mem.trigger}`);
    console.log(`rule: ${mem.rule}`);
    if (mem.example) {
      console.log(`example: ${mem.example.slice(0, 100)}...`);
    }
    console.log();
  }

  const outFile = file.replace(/\.mdx?$/, ".memories.json");
  await writeFile(outFile, JSON.stringify(memories, null, 2));
  console.log(`Written to: ${outFile}`);
}

// Only run main if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
