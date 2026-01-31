/**
 * Eval discovery and management
 */
import { join } from "path";
import { readdir } from "fs/promises";
import { exists, readText } from "../lib/fs";

export interface EvalSpec {
  id: string;
  path: string;
  promptPath: string;
}

export async function discoverEvals(nextEvalsRoot: string): Promise<EvalSpec[]> {
  const evalsDir = join(nextEvalsRoot, "evals");
  
  if (!(await exists(evalsDir))) {
    console.error(`Evals directory not found: ${evalsDir}`);
    return [];
  }

  const entries = await readdir(evalsDir, { withFileTypes: true });
  const evals: EvalSpec[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const evalPath = join(evalsDir, entry.name);
    const promptPath = join(evalPath, "PROMPT.md");

    if (await exists(promptPath)) {
      evals.push({
        id: entry.name,
        path: evalPath,
        promptPath,
      });
    }
  }

  // Sort by ID
  evals.sort((a, b) => a.id.localeCompare(b.id));

  return evals;
}

export function filterEvals(
  evals: EvalSpec[],
  ids: string[]
): EvalSpec[] {
  if (ids.length === 0) return evals;
  
  const idSet = new Set(ids);
  return evals.filter((e) => idSet.has(e.id));
}

export async function getPrompt(evalSpec: EvalSpec): Promise<string> {
  return readText(evalSpec.promptPath);
}
