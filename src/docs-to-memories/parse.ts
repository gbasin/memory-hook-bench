/**
 * Parse model output into memories
 */
import { randomUUID } from "crypto";
import type { Memory } from "../lib/types";

interface RawMemory {
  text: string;
  context: string;
  source: string;
}

export function parseMemoriesFromModelOutput(
  raw: string,
  source: string
): RawMemory[] {
  const results: RawMemory[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines, code fences, markdown artifacts
    if (!trimmed) continue;
    if (trimmed.startsWith("```")) continue;
    if (trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("{")) continue;

    try {
      const obj = JSON.parse(trimmed);
      
      // Validate required fields
      if (
        typeof obj.text === "string" &&
        typeof obj.context === "string" &&
        obj.text.trim() &&
        obj.context.trim()
      ) {
        results.push({
          text: obj.text.trim(),
          context: obj.context.trim(),
          source,
        });
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  return results;
}

export function finalizeMemories(items: RawMemory[]): Memory[] {
  // Dedupe by text+context
  const seen = new Map<string, Memory>();

  for (const item of items) {
    const key = `${item.text}\n---\n${item.context}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: randomUUID(),
        text: item.text,
        context: item.context,
        source: item.source,
      });
    }
  }

  return Array.from(seen.values());
}
