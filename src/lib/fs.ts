/**
 * Filesystem utilities
 */
import { readdir, stat, mkdir, rm, copyFile, readFile, writeFile } from "fs/promises";
import { join, relative, extname } from "path";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function rimraf(path: string): Promise<void> {
  if (await exists(path)) {
    await rm(path, { recursive: true, force: true });
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

export async function writeText(path: string, data: string): Promise<void> {
  await ensureDir(join(path, ".."));
  await writeFile(path, data, "utf-8");
}

export async function copyDir(src: string, dst: string): Promise<void> {
  await ensureDir(dst);
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await copyFile(srcPath, dstPath);
    }
  }
}

export interface WalkOptions {
  includeExt: string[];
  excludeDirs: string[];
}

export async function walkFiles(
  root: string,
  opts: WalkOptions
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!opts.excludeDirs.includes(entry.name)) {
          await walk(fullPath);
        }
      } else {
        const ext = extname(entry.name);
        if (opts.includeExt.includes(ext)) {
          results.push(relative(root, fullPath));
        }
      }
    }
  }

  await walk(root);
  return results;
}
