/**
 * Claude Code headless extraction
 */
import { run } from "../lib/proc";
import type { Chunk } from "../lib/types";

const EXTRACTION_PROMPT = `Extract actionable coding patterns from this documentation.

For each pattern, output a JSON object on its own line:
{"text": "search keywords matching code that needs this", "context": "actionable advice"}

Guidelines for "text" field:
- Include API names, function signatures, common variable names
- Include error messages or symptoms that indicate this pattern
- Optimize for semantic search matching against code snippets

Guidelines for "context" field:
- Be specific and actionable, not conceptual
- Include code snippets where helpful (keep short)
- Mention common mistakes to avoid

Skip:
- Setup/installation instructions
- Conceptual explanations without concrete patterns
- Marketing content

Output one JSON object per line (JSONL format). No other text.`;

export function buildExtractionPrompt(chunk: Chunk): string {
  return `${EXTRACTION_PROMPT}

Source: ${chunk.source} (chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks})

Documentation:
---
${chunk.text}
---`;
}

export async function extractFromChunk(
  chunk: Chunk,
  opts: {
    model: string;
    claudePath: string;
    timeoutMs: number;
    verbose: boolean;
  }
): Promise<string> {
  const prompt = buildExtractionPrompt(chunk);

  const result = await run(
    opts.claudePath,
    [
      "--model", opts.model,
      "--dangerously-skip-permissions",
      "-p", prompt,
    ],
    { timeoutMs: opts.timeoutMs }
  );

  if (opts.verbose) {
    console.error(`[extract] ${chunk.source}#${chunk.chunkIndex}: exit=${result.code} timeout=${result.timedOut} duration=${result.durationMs}ms`);
  }

  if (result.timedOut) {
    console.error(`[extract] TIMEOUT: ${chunk.source}#${chunk.chunkIndex}`);
    return "";
  }

  if (result.code !== 0) {
    console.error(`[extract] ERROR: ${chunk.source}#${chunk.chunkIndex}: ${result.stderr.slice(0, 200)}`);
    return "";
  }

  return result.stdout;
}
