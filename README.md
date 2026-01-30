# memory-hook-bench

Benchmark **memory-hook** (on-demand context injection) against **AGENTS.md** (static context) using Vercel's Next.js eval suite.

## Quick Start

```bash
# Install dependencies
bun install

# Setup: clone next-evals-oss and copy docs
bun run bench setup --commit <sha>

# Extract memories from docs
bun run bench extract

# Run benchmark (all evals, all configs)
bun run bench run --all

# View results
bun run bench results
```

## Commands

### `setup --commit <sha>`

Clones `vercel/next-evals-oss` and copies `.next-docs/` to `artifacts/docs/`.

```bash
bun run bench setup --commit abc123
```

### `extract`

Extracts memories from docs using Claude Code headless (Opus 4.5).

```bash
bun run bench extract
bun run bench extract --model claude-sonnet-4-20250514 --concurrency 5
```

### `run`

Runs evals across configs.

```bash
# All evals, all configs
bun run bench run --all

# Specific evals
bun run bench run --evals 001,002,003

# Specific configs
bun run bench run --configs baseline,memory-hook

# With options
bun run bench run --all --timeout 900000 --verbose
```

### `results`

Shows latest benchmark results.

```bash
bun run bench results
```

## Configs

| Config | Description |
|--------|-------------|
| `baseline` | No docs, no hook |
| `agents-md` | AGENTS.md generated from memories |
| `memory-hook` | Hook active with Haiku reranking |
| `memory-no-rerank` | Hook active, vector search only |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_EVALS_COMMIT` | Default commit for setup |
| `MEMORY_HOOK_PATH` | Path to memory-hook package |
| `CLAUDE_PATH` | Path to claude CLI |
| `ANTHROPIC_API_KEY` | Required for reranking |

## Output

Results are written to `artifacts/results/<run-id>/`:
- `results.json` - Raw results data
- `report.md` - Markdown summary

## docs-to-memories CLI

Standalone tool for extracting memories from any documentation.

```bash
# Extract to JSONL
bun run extract extract ./docs --output memories.json

# Extract to LanceDB
bun run extract extract ./docs --output lancedb://./memories.lance

# Options
bun run extract extract ./docs --output out.json \
  --model claude-opus-4-5-20251101 \
  --concurrency 3 \
  --chunk-size 8000 \
  --overlap 200 \
  --verbose
```
