# Memory-Hook Benchmark Specification

## Overview

This project benchmarks **memory-hook** (on-demand context injection via Claude Code hooks) against **AGENTS.md** (static context) using Vercel's public Next.js eval suite.

### Hypothesis

Vercel's study showed AGENTS.md outperforms "skills" (on-demand retrieval). We hypothesize that memory-hook's **LLM reranking step** can close this gap by filtering false positives before injection, achieving comparable or better results than static context while remaining domain-agnostic.

### Research Questions

1. **Retrieval vs Static**: Does on-demand memory injection perform as well as always-present AGENTS.md?
2. **Reranking Impact**: How much does LLM reranking improve over raw vector search?
3. **Memory Quality**: Does LLM-extracted memories outperform raw doc chunks?
4. **Latency Tradeoff**: Is the retrieval + reranking latency acceptable for real workflows?

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Docs source** | `.next-docs/` from next-evals-oss | Apples-to-apples comparison with Vercel's study |
| **Eval model** | `claude-opus-4-5-20251101` | Best model reduces noise, isolates memory effect |
| **Retry policy** | 1 retry on timeout/crash, 0 on test failure | Only retry infrastructure issues, not wrong answers |
| **MCP matchers** | Not needed | Evals use built-in Edit/Write/Read tools |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              PROJECTS                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐                     │
│  │  docs-to-memories   │    │  memory-hook-bench  │                     │
│  │  (generic tool)     │    │  (benchmark runner) │                     │
│  └──────────┬──────────┘    └──────────┬──────────┘                     │
│             │                          │                                │
│             │  memories.json           │  uses                          │
│             └─────────────────────────►│◄────────────────────┐          │
│                                        │                     │          │
│                          ┌─────────────┴───────────┐         │          │
│                          │    next-evals-oss       │         │          │
│                          │    (Vercel's evals)     │         │          │
│                          └─────────────────────────┘         │          │
│                                                              │          │
│  ┌─────────────────────────────────────────────────────────┐ │          │
│  │  co11y/packages/memory-hook                             │ │          │
│  │  (the hook implementation - unchanged)                  │◄┘          │
│  └─────────────────────────────────────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Project 1: docs-to-memories

A generic CLI tool that extracts structured memories from documentation using Claude Code headless with Opus 4.5.

### Purpose

Convert any documentation into memory pairs optimized for semantic retrieval:
- **text**: Keywords/patterns that match code needing this advice
- **context**: Actionable advice to inject

### Directory Structure

```
docs-to-memories/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── extract.ts          # Core extraction logic
│   ├── loaders/
│   │   ├── markdown.ts     # Load .md files
│   │   ├── html.ts         # Load HTML docs
│   │   └── directory.ts    # Recursively load doc directories
│   ├── output/
│   │   ├── json.ts         # Output as JSON
│   │   └── lancedb.ts      # Direct LanceDB seeding
│   └── prompts/
│       └── extraction.ts   # Opus 4.5 extraction prompt
├── package.json
├── tsconfig.json
└── README.md
```

### CLI Interface

```bash
# Extract from a directory of markdown docs
docs-to-memories extract ./nextjs-docs --output memories.json

# Extract with custom prompt overlay
docs-to-memories extract ./docs --prompt "Focus on migration patterns"

# Seed directly to LanceDB
docs-to-memories extract ./docs --output lancedb://./data/memories.lance

# Options
--model         # Model to use (default: claude-opus-4-5-20251101)
--concurrency   # Parallel extraction (default: 3)
--chunk-size    # Max chars per doc chunk (default: 8000)
--dry-run       # Preview extraction without calling LLM
--verbose       # Show extraction progress
```

### Extraction Prompt

```typescript
const EXTRACTION_PROMPT = `
You are extracting actionable coding patterns from documentation.

For each distinct pattern, output a JSON object:
{
  "text": "keywords and code patterns that would trigger needing this advice",
  "context": "concise, actionable advice (1-3 sentences)"
}

Guidelines for "text" field:
- Include API names, function signatures, common variable names
- Include error messages or symptoms that indicate this pattern
- Include migration-related terms if applicable
- Optimize for semantic search matching against code snippets

Guidelines for "context" field:
- Be specific and actionable, not conceptual
- Include code snippets where helpful (keep short)
- Mention common mistakes to avoid
- Reference related APIs if relevant

Skip:
- Installation/setup instructions (not actionable during coding)
- Conceptual explanations without concrete patterns
- Marketing content
- Version history

Output one JSON object per line (JSONL format).
`;
```

### Memory Schema

```typescript
interface Memory {
  id: string;           // UUID
  text: string;         // Search keywords (embedded for vector search)
  context: string;      // Advice to inject
  source: string;       // Source doc path/URL
  sourceChunk?: number; // Which chunk of source doc
  extractedAt: string;  // ISO timestamp
}
```

---

## Project 2: memory-hook-bench

Benchmark harness that runs Vercel's Next.js evals across multiple configurations.

### Directory Structure

```
memory-hook-bench/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── runner.ts           # Orchestrates eval runs
│   ├── config/
│   │   ├── switcher.ts     # Toggle hook, swap AGENTS.md
│   │   ├── templates/      # Config templates for each mode
│   │   └── claude-settings.ts
│   ├── eval/
│   │   ├── executor.ts     # Run single eval
│   │   ├── validator.ts    # Run EVAL.ts assertions
│   │   └── workspace.ts    # Reset eval workspace
│   ├── results/
│   │   ├── collector.ts
│   │   ├── aggregator.ts
│   │   └── reporter.ts
│   └── utils/
│       ├── claude-code.ts
│       └── git.ts
├── evals/                  # Cloned from next-evals-oss
├── configs/
│   ├── baseline/
│   ├── agents-md/
│   ├── memory-hook/
│   └── memory-no-rerank/
├── data/
│   ├── nextjs-docs/        # From .next-docs/ in evals repo
│   ├── memories.json
│   └── memories.lance/
├── results/
└── package.json
```

### Configurations

| Config | Description |
|--------|-------------|
| **baseline** | No external context - model's training data only |
| **agents-md** | Vercel's AGENTS.md approach - static context always present |
| **memory-hook** | On-demand memory injection with LLM reranking |
| **memory-no-rerank** | Memory injection with vector search only |

### Eval Execution Flow

```
For each eval:
  For each config:
    1. PREPARE: Fresh workspace, apply config
    2. RUN: claude --model claude-opus-4-5-20251101 \
                   --dangerously-skip-permissions \
                   -p "$(cat PROMPT.md)"
    3. VALIDATE: build, lint, test EVAL.ts
    4. RECORD: results JSON
    
    On timeout/crash: retry once
    On test failure: no retry (legitimate failure)
```

### Results Schema

```typescript
interface EvalResult {
  eval: string;
  config: string;
  timestamp: string;
  retried: boolean;
  
  build: { pass: boolean; duration: number; error?: string };
  lint: { pass: boolean; duration: number };
  test: { pass: boolean; duration: number; assertions: any[] };
  
  agent: {
    duration: number;
    turns: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    memoriesInjected?: number;    // memory-hook only
    memoriesReranked?: number;    // memory-hook only
    rerankLatency?: number;       // memory-hook only
  };
  
  overall: { pass: boolean };
}

interface BenchmarkResults {
  runId: string;
  timestamp: string;
  model: string;  // claude-opus-4-5-20251101
  
  configs: {
    [configName: string]: {
      passRate: number;
      buildPassRate: number;
      lintPassRate: number;
      testPassRate: number;
      avgDuration: number;
      avgCost: number;
    };
  };
  
  comparison: {
    memoryHookVsBaseline: { passRateDelta: number };
    memoryHookVsAgentsMd: { passRateDelta: number };
    rerankingImpact: { passRateDelta: number };
  };
}
```

---

## Environment Isolation

Critical for valid benchmarking:

- **Workspace Isolation**: Each eval run gets fresh `/tmp/memory-hook-bench/{run-id}/{eval-id}/{config}`
- **Claude Settings Isolation**: Custom `CLAUDE_CONFIG_DIR` per config
- **No Contamination**: Remove any AGENTS.md/CLAUDE.md from baseline/memory-hook workspaces

---

## Implementation Phases

### Phase 1: Setup
- [ ] Create project scaffolding (both projects)
- [ ] Clone next-evals-oss
- [ ] Copy `.next-docs/` to data/nextjs-docs/

### Phase 2: docs-to-memories
- [ ] Implement doc loaders (markdown, directory)
- [ ] Implement Opus 4.5 extraction via Claude Code headless
- [ ] Implement JSON + LanceDB output
- [ ] Extract Next.js memories (~150-200 expected)

### Phase 3: Benchmark Runner
- [ ] Implement config switcher
- [ ] Implement workspace reset
- [ ] Implement eval executor (with retry logic)
- [ ] Implement result collector

### Phase 4: Validation & Results
- [ ] Run pilot (5 evals, all configs)
- [ ] Implement result aggregation
- [ ] Implement markdown reporter

### Phase 5: Full Run
- [ ] Run full benchmark (50 evals × 4 configs = 200 runs)
- [ ] Analyze results

---

## Success Criteria

1. **Primary**: What is memory-hook's pass rate vs AGENTS.md vs baseline?
2. **Secondary**: How much does reranking improve precision?
3. **Tertiary**: What types of evals does memory-hook struggle with?

Expected outcomes:
- Memory-hook should beat baseline by 30%+
- Memory-hook should be within 10-15% of AGENTS.md
- Reranking should improve precision by 20%+

---

## Cost Estimate

| Item | Count | Unit Cost | Total |
|------|-------|-----------|-------|
| Memory extraction (Opus 4.5) | ~50 chunks | ~$0.50 | ~$25 |
| Eval runs (Opus 4.5) | 200 runs | ~$0.75 | ~$150 |
| Reranking (Haiku) | ~600 | ~$0.01 | ~$6 |
| **Total** | | | **~$181** |

Note: Opus 4.5 is ~5x more expensive than Sonnet for eval runs, but gives best signal.
