/**
 * MiniLM-L6-v2 embeddings (same as memory-hook)
 */
import { pipeline } from "@xenova/transformers";

let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

export async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const result = await model(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}
