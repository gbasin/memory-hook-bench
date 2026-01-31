#!/usr/bin/env bun
/**
 * Prototype: Markdown-aware extraction with heuristics + LLM
 * 
 * Usage:
 *   bun run src/docs-to-memories/prototype.ts <file.mdx>
 *   bun run src/docs-to-memories/prototype.ts <file.mdx> --extract
 */

import { readFileSync } from "fs";
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

interface Section {
  level: number;
  title: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

interface Memory {
  trigger: string;
  rule: string;
  source: string;
  section: string;
  example?: string;
}

function parseMarkdownSections(content: string): Section[] {
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

function shouldExtract(section: Section): { extract: boolean; reason: string } {
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

async function extractMemory(section: Section, docPath: string): Promise<Memory | null> {
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

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith("-"));
  const doExtract = args.includes("--extract");

  if (!file) {
    console.error("Usage: bun run prototype.ts <file.mdx> [--extract]");
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

  // Extract memories sequentially (CLI is slow, parallel might overwhelm)
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

  // Write to file
  const outFile = file.replace(/\.mdx?$/, ".memories.json");
  const fs = await import("fs/promises");
  await fs.writeFile(outFile, JSON.stringify(memories, null, 2));
  console.log(`Written to: ${outFile}`);
}

main().catch(console.error);
