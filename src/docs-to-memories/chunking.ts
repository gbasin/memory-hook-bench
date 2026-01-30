/**
 * Document chunking for memory extraction
 */
import { join } from "path";
import { walkFiles, readText } from "../lib/fs";
import type { Chunk } from "../lib/types";

export function chunkText(
  input: string,
  chunkSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < input.length) {
    const end = Math.min(start + chunkSize, input.length);
    chunks.push(input.slice(start, end));
    start = end - overlap;
    if (start >= input.length - overlap) break;
  }

  return chunks;
}

export async function buildChunksFromDir(
  root: string,
  opts: {
    chunkSize: number;
    overlap: number;
    includeExt: string[];
    excludeDirs: string[];
  }
): Promise<Chunk[]> {
  const files = await walkFiles(root, {
    includeExt: opts.includeExt,
    excludeDirs: opts.excludeDirs,
  });

  const allChunks: Chunk[] = [];

  for (const relPath of files) {
    const fullPath = join(root, relPath);
    const content = await readText(fullPath);
    const textChunks = chunkText(content, opts.chunkSize, opts.overlap);

    for (let i = 0; i < textChunks.length; i++) {
      allChunks.push({
        source: relPath,
        chunkIndex: i,
        totalChunks: textChunks.length,
        text: textChunks[i],
      });
    }
  }

  return allChunks;
}
