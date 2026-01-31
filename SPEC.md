# Memory-Hook Benchmark Specification

## Overview

Benchmark **memory-hook** (on-demand context injection) against **AGENTS.md** (static context) using Vercel's Next.js eval suite.

### Hypothesis

Memory-hook's LLM reranking can close the gap with AGENTS.md while remaining domain-agnostic.

### Research Questions

1. Does on-demand memory injection perform as well as static AGENTS.md?
2. How much does LLM reranking improve over raw vector search?

---

## Decisions

| Decision | Choice |
|----------|--------|
| Docs source | `docs/` from `vercel/next.js` (pin to tag, e.g. v16.1.0) |
| Eval suite | `vercel/next-evals-oss` (pin to specific commit at setup) |
| Eval model | `claude-opus-4-5-20251101` |
| Embedding model | MiniLM-L6-v2 (same as memory-hook) |
| Reranker | Claude Haiku (same as memory-hook) |
| Retry policy | 1 retry on timeout/crash |

---

## Architecture

```
docs-to-memories/     → Generic tool: docs → memory pairs (via Opus 4.5 headless)
memory-hook-bench/    → Benchmark runner: runs evals across 4 configs
co11y/memory-hook/    → Existing hook implementation (unchanged)
next-evals-oss/       → Vercel's eval suite (cloned, pinned commit)
```

---

## Project 1: docs-to-memories

Extracts memories from docs using Claude Code headless.

### CLI

```bash
docs-to-memories extract ./docs --output memories.json
docs-to-memories extract ./docs --output lancedb://./memories.lance
```

Options:
- `--model` (default: claude-opus-4-5-20251101)
- `--concurrency` (default: 3)
- `--chunk-size` (default: 8000, with 200 char overlap)
- `--dry-run`
- `--verbose`

### Chunking

- Max chars per chunk: 8000 (configurable)
- Overlap: 200 chars between chunks
- Include: `.md`, `.mdx`
- Exclude: `node_modules`, `.git`

### Extraction Prompt

```
Extract actionable coding patterns from this documentation.

For each pattern, output JSON:
{"text": "search keywords matching code that needs this", "context": "actionable advice"}

Skip setup instructions, conceptual explanations, marketing.
Output one JSON object per line.
```

### Memory Schema

```typescript
interface Memory {
  id: string;
  text: string;      // embedded with MiniLM-L6-v2 for vector search
  context: string;   // injected advice
  source: string;    // source doc path
}
```

---

## Project 2: memory-hook-bench

Runs evals across configs and collects results.

### CLI

```bash
memory-hook-bench setup          # clone evals (pin commit), copy docs
memory-hook-bench extract        # run docs-to-memories
memory-hook-bench run --all      # run all evals, all configs
memory-hook-bench run --evals 001,002 --configs baseline,memory-hook
memory-hook-bench results        # show summary
```

### Configs

| Config | What it does |
|--------|--------------|
| **baseline** | No docs, no hook |
| **agents-md** | AGENTS.md present (via Vercel codemod) |
| **memory-hook** | Hook active, reranking with Haiku |
| **memory-no-rerank** | Hook active, vector search only |

### Eval Flow

```
For each eval × config:
  1. Fresh workspace in /tmp/
  2. Apply config (AGENTS.md or hook settings)
  3. Run: claude --model opus-4.5 --dangerously-skip-permissions -p PROMPT.md
  4. Validate: build, lint, test
  5. Record result
  
On timeout: retry once
On test fail: no retry
```

### Result Schema

```typescript
interface EvalResult {
  eval: string;
  config: string;
  build: { pass: boolean };
  lint: { pass: boolean };
  test: { pass: boolean };
  overall: { pass: boolean };
  agent: {
    turns: number;
    memoriesInjected?: number;
  };
}
```

### Report

```markdown
| Config           | Pass Rate |
|------------------|-----------|
| baseline         | 24%       |
| agents-md        | 76%       |
| memory-hook      | 68%       |
| memory-no-rerank | 42%       |
```

---

## Workspace Isolation

- Each eval/config gets `/tmp/memory-hook-bench/{eval}/{config}/`
- Custom `CLAUDE_CONFIG_DIR` per config
- Remove AGENTS.md/CLAUDE.md from baseline/memory-hook workspaces

---

## Phases

1. **Setup**: Clone evals (pin commit), fetch Next.js docs (pin tag)
2. **docs-to-memories**: Extract memories from docs using Claude headless
3. **Benchmark runner**: Config switching, eval execution, result collection
4. **Run**: Pilot with 5 evals, then full 20 evals × 4 configs

---

## Success Criteria

- Memory-hook beats baseline by 30%+
- Memory-hook within 10-15% of AGENTS.md
- Reranking improves over no-rerank by 20%+
