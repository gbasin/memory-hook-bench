# memory-hook-bench

Benchmark for comparing **memory-hook** (on-demand context injection) against **baseline** (no context) using Vercel's Next.js eval suite.

## Results

| Config | Pass Rate |
|--------|-----------|
| memory-hook | 100% |
| baseline | 0% |

*Tested on `agent-000-app-router-migration-simple` with claude-opus-4-5-20251101*

## How It Works

1. **Extract memories** from Next.js docs using markdown-aware parsing + LLM
2. **Embed** memories to LanceDB with MiniLM-L6-v2
3. **Run evals** with memory-hook injecting relevant context at tool-use time

### Memory Extraction

The extractor parses markdown structure (H2/H3/H4 headers) and uses heuristics to identify actionable sections:

- **Strong signals**: "Good to know", "Warning", "don't", "avoid"
- **Medium signals**: Code blocks + "you can", "for example"

Each section is processed by an LLM to extract:
```json
{
  "trigger": "keywords for semantic search",
  "rule": "actionable advice to inject",
  "example": "code snippet (optional)"
}
```

### Memory Injection

When the agent reads/writes files, memory-hook:
1. Embeds the file content as a query
2. Searches LanceDB for relevant memories
3. Reranks with gpt-5.1-codex-mini
4. Injects top matches into the agent's context

## Setup

```bash
# Clone
git clone https://github.com/gbasin/memory-hook-bench
cd memory-hook-bench
bun install

# Fetch eval suite
bun run src/bench/cli.ts setup --commit <sha>

# Fetch Next.js docs
bun run src/bench/cli.ts setup-docs --ref v16.1.0
```

## Usage

### Extract Memories

```bash
# Sequential (slow but reliable)
bun run src/bench/cli.ts extract-memories

# Parallel (faster)
bun run src/bench/cli.ts extract-memories --workers 4

# Verbose output
bun run src/bench/cli.ts extract-memories --verbose
```

### Run Benchmarks

```bash
# Run specific eval
bun run src/bench/cli.ts run --evals agent-000 --configs baseline,memory-hook

# Run all evals
bun run src/bench/cli.ts run --all

# View results
bun run src/bench/cli.ts results
```

## Project Structure

```
src/
  bench/
    cli.ts           # Main CLI entry point
    config.ts        # Configuration
    setup.ts         # Repo cloning, docs fetching
    runner.ts        # Eval execution
    evals.ts         # Eval discovery
    configs.ts       # Config definitions (baseline, memory-hook)
    results.ts       # Result aggregation
  docs-to-memories/
    extractor.ts     # Markdown-aware extraction with heuristics + LLM
    to-lancedb.ts    # Embedding and LanceDB storage
artifacts/
  docs/              # Fetched Next.js documentation
  memories/          # Extracted memories (LanceDB + JSON)
  results/           # Benchmark results
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `NEXT_EVALS_COMMIT` | Commit SHA for next-evals-oss |
| `NEXTJS_DOCS_REF` | Git ref for Next.js docs (default: v16.1.0) |
| `MEMORY_HOOK_PATH` | Path to memory-hook package |
| `CLAUDE_PATH` | Path to claude CLI (default: claude) |

## Dependencies

- [memory-hook](https://github.com/gbasin/co11y/tree/main/packages/memory-hook) - Context injection hook
- [next-evals-oss](https://github.com/vercel/next-evals-oss) - Eval suite
- [LanceDB](https://lancedb.com/) - Vector database
- [MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) - Embedding model

## License

MIT
