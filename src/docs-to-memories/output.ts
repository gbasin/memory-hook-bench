/**
 * Output writers for memories (JSONL and LanceDB)
 */
import { connect } from "@lancedb/lancedb";
import { writeText, ensureDir } from "../lib/fs";
import { embed } from "../lib/embeddings";
import type { Memory, LanceMemoryRow } from "../lib/types";
import { join } from "path";

export async function writeJsonl(path: string, memories: Memory[]): Promise<void> {
  const lines = memories.map((m) => JSON.stringify(m)).join("\n");
  await writeText(path, lines + "\n");
  console.log(`Wrote ${memories.length} memories to ${path}`);
}

export async function writeLanceDb(
  lancePath: string,
  memories: Memory[]
): Promise<void> {
  // Ensure parent directory exists
  await ensureDir(join(lancePath, ".."));

  console.log(`Embedding ${memories.length} memories...`);

  // Embed all memories
  const rows: LanceMemoryRow[] = [];
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    // Embed text + context together (same as memory-hook)
    const vector = await embed(`${m.text} ${m.context}`);
    rows.push({ ...m, vector });

    if ((i + 1) % 10 === 0) {
      console.log(`  Embedded ${i + 1}/${memories.length}`);
    }
  }

  console.log(`Writing to LanceDB at ${lancePath}...`);

  const db = await connect(lancePath);
  
  // Drop existing table if present
  try {
    await db.dropTable("memories");
  } catch {
    // Table doesn't exist, that's fine
  }

  await db.createTable("memories", rows as unknown as Record<string, unknown>[]);
  console.log(`Wrote ${rows.length} memories to LanceDB`);
}

export function parseOutputUri(uri: string): { type: "jsonl" | "lancedb"; path: string } {
  if (uri.startsWith("lancedb://")) {
    return { type: "lancedb", path: uri.slice("lancedb://".length) };
  }
  return { type: "jsonl", path: uri };
}
