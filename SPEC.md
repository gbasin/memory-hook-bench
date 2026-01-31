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
docs-to-memories/     → Markdown-aware extractor: docs → memories
memory-hook-bench/    → Benchmark runner: runs evals across 4 configs
co11y/memory-hook/    → Hook implementation (enhanced query building)
next-evals-oss/       → Vercel's eval suite (cloned, pinned commit)
```

---

## Project 1: docs-to-memories

Extracts memories from structured markdown documentation.

### Key Insight: Markdown-Aware Extraction

**Problem**: Arbitrary character-based chunks break document structure, mix unrelated topics.

**Solution**: Parse markdown structure, extract per-section, preserve semantic units.

```
updateTag.mdx
     ↓
Parse markdown headers (H1, H2, H3)
     ↓
┌─────────────────────────────┐
│ Section: "Usage"            │ → Extract if actionable
│ Section: "Parameters"       │ → Extract if actionable
│ Section: "Good to know"     │ → Usually actionable
│ Section: "Examples"         │ → Extract patterns
└─────────────────────────────┘
     ↓
Per-section memories with structured triggers
```

### Memory Schema

```typescript
interface Memory {
  id: string;
  
  // For embedding/search
  trigger: string;      // API names, import paths, patterns, error messages
                        // e.g. "updateTag next/cache revalidateTag Server Action"
  
  // For injection
  rule: string;         // Actionable advice to inject
                        // e.g. "Use updateTag instead of revalidateTag for read-your-writes"
  
  // Metadata
  source: string;       // Doc path: "01-app/03-api-reference/04-functions/updateTag.mdx"
  section: string;      // H2/H3 header: "Good to know"
  
  // Optional
  example?: string;     // Short code snippet if relevant
}
```

### Trigger Field Design

The `trigger` is what gets embedded and searched against. It should contain:

| Component | Example | Why |
|-----------|---------|-----|
| API name | `updateTag` | Exact match when code uses this API |
| Import path | `next/cache` | Matches import statements |
| Related APIs | `revalidateTag` | Catches comparison/migration patterns |
| Symptoms | `stale data after mutation` | Matches problem descriptions |
| Patterns | `Server Action cache` | Broader conceptual matching |

### Extraction Flow

```
1. Parse markdown file
   - Extract frontmatter (title, description)
   - Split by headers (H2, H3)
   - Identify code blocks, callouts ("Good to know")

2. For each section:
   - Skip if purely conceptual (no actionable pattern)
   - Extract via LLM:
     - trigger: searchable keywords
     - rule: actionable advice
     - example: code snippet (optional)

3. Enrich from doc structure:
   - API name from filename/title
   - Import path from code examples
   - Category from doc path (01-app → App Router)

4. Dedupe and write to LanceDB
```

### CLI

```bash
docs-to-memories extract ./docs --output memories.lance

# Options
--model <model>       # Extraction model (default: claude-sonnet-4-20250514)
--concurrency <n>     # Parallel extractions (default: 5)
--dry-run             # Parse and show sections, don't extract
--verbose             # Show extraction progress
```

### Extraction Prompt (per section)

```
You are extracting actionable coding patterns from documentation.

Section: {section_title}
From: {doc_path}
API: {api_name} (if known)

Content:
---
{section_content}
---

If this section contains an actionable coding pattern, output JSON:
{
  "trigger": "keywords for search: API names, import paths, error messages, symptoms",
  "rule": "specific actionable advice (1-3 sentences)",
  "example": "short code snippet if helpful (optional)"
}

Skip if:
- Purely conceptual explanation
- Installation/setup instructions
- No concrete pattern or advice

Output valid JSON or nothing.
```

---

## Project 2: Query Building (Memory Hook)

### Key Insight: Imports as Cheap Signal

**Problem**: Code hunks are too narrow to match against broad documentation patterns.

**Solution**: Extract imports + file path as cheap, high-signal context. No LLM needed.

### Language-Specific Import Extraction

Start with TypeScript/JavaScript, expand to other languages over time.

```typescript
// Language strategies (extensible)
interface LanguageStrategy {
  extensions: string[];
  extractImports(fileContent: string): string[];
}

const strategies: Record<string, LanguageStrategy> = {
  typescript: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    extractImports(content) {
      // Regex for: import { x } from 'y'
      // Regex for: import x from 'y'
      // Regex for: require('y')
      // Returns: ['next/cache.updateTag', 'next/headers.cookies', ...]
    }
  },
  python: {
    extensions: ['.py'],
    extractImports(content) {
      // Regex for: from x import y
      // Regex for: import x
    }
  },
  // Future: go, rust, etc.
};
```

### Query Construction

```typescript
function buildQuery(
  codeHunk: string,
  filePath: string,
  fileContent: string
): string {
  const strategy = getStrategyForFile(filePath);
  const imports = strategy?.extractImports(fileContent) ?? [];
  
  return [
    `File: ${filePath}`,
    imports.length ? `Imports: ${imports.join(', ')}` : '',
    `Code:\n${codeHunk}`
  ].filter(Boolean).join('\n');
}

// Example output:
// File: app/dashboard/page.tsx
// Imports: next/cache.revalidateTag, next/headers.cookies, react.useState
// Code:
// export default async function Page() {
//   revalidateTag('posts')
```

### Matching Strategy

1. **Embedding search**: Query embeds against `trigger` field
2. **Import boost**: Exact import matches get relevance boost
3. **Rerank**: Top-k candidates reranked by Haiku with full context

---

## Project 3: memory-hook-bench

Runs evals across configs and collects results.

### CLI

```bash
memory-hook-bench setup --commit <sha>    # Clone evals
memory-hook-bench setup-docs --ref v16.1.0 # Fetch Next.js docs
memory-hook-bench extract                  # Run docs-to-memories
memory-hook-bench run --all                # Run all evals, all configs
memory-hook-bench results                  # Show summary
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

---

## Phases

1. **Setup**: Clone evals, fetch Next.js docs ✅
2. **Extraction**: Implement markdown-aware extraction
3. **Query enhancement**: Add import extraction to memory-hook
4. **Benchmark**: Pilot 5 evals, then full 20 evals × 4 configs

---

## Success Criteria

- Memory-hook beats baseline by 30%+
- Memory-hook within 10-15% of AGENTS.md
- Reranking improves over no-rerank by 20%+

---

## Future: Multi-Language Support

The extraction and query systems are designed to be language-agnostic at the core,
with language-specific strategies for:

1. **Import extraction** (query side)
2. **Code pattern recognition** (extraction side)

| Language | Import Pattern | Status |
|----------|---------------|--------|
| TypeScript/JS | `import x from 'y'` | Planned |
| Python | `from x import y` | Future |
| Go | `import "x"` | Future |
| Rust | `use x::y` | Future |
