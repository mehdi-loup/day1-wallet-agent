# Wallet Agent — Days 1–6

Streaming crypto portfolio assistant built across a 21-day AI engineering sprint. Uses Vercel AI SDK + Mastra for agent orchestration, with full observability and an eval suite.

## Setup

```bash
cp .env.example .env.local
# fill in your ANTHROPIC_API_KEY (and optionally ZAPPER_API_KEY)
pnpm install
pnpm dev          # Next.js UI on localhost:3000
pnpm mastra:dev   # Mastra Studio on localhost:4111
pnpm eval         # run the golden eval suite
```

## Keys needed

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ZAPPER_API_KEY` | zapper.xyz (optional — falls back to mock data) |

## What's built

| Day | Feature |
|---|---|
| 1 | Streaming chat with `useChat` + `streamText` |
| 2 | `generateObject` + Zod structured portfolio summary |
| 3 | Tool calling — `getTokenPrice` (CoinGecko) + `getWalletTokens` (Zapper) |
| 4 | Composed `stopWhen`, streaming tool-call UI, abort button |
| 5 | Mastra layer — `Agent`, `Workflow`, `Memory` (LibSQL) |
| 6 | Observability (DuckDB traces → Studio) + 10-case eval suite |

---

## Observability + Evals

### Viewing traces

Start `pnpm mastra:dev` and open [Studio → Observability](http://localhost:4111). Every agent call and workflow run produces a trace automatically — no instrumentation needed beyond the initial config in `src/mastra/index.ts`.

Each trace shows:

- **`agent_run` span** — the root. Contains your system prompt and the full input.
- **`model_step: step N` spans** — one per LLM round-trip. Attributes include `usage` (input/output tokens) and `finishReason`.
- **`tool_call` spans** — exact input the LLM passed to the tool, exact output the tool returned. This is where you catch the LLM passing a bad symbol or ignoring the tool result.
- **`processor_run` spans** — memory load (input) and memory persist (output). Latency here tells you if LibSQL is a bottleneck.

**Debugging a slow run:** look at `model_step` durations first — LLM inference is usually the bottleneck and not fixable. If inference is fast but the run is slow, look at `tool_call` durations for network latency (CoinGecko, Zapper). Memory processors should be < 5ms; if not, the thread history is growing too large.

**Storage routing:** traces go to DuckDB (OLAP — fast aggregation). Memory/threads go to LibSQL (OLTP — transactional). Two stores because the access patterns are fundamentally different.

> **Observability vs evals, in one sentence each:**
> Observability tells you *what the agent did* on a specific run. Evals tell you *whether what it did was correct* across a curated set of cases.
> A clean trace with zero errors can still produce a hallucinated answer. A green eval suite can still fail on production inputs you never thought to test.

### Running evals

```bash
pnpm eval
```

Runs 10 hand-curated cases and prints a pass/fail summary. Exits non-zero on any failure.

| Case | Type | What it asserts |
|---|---|---|
| `price-eth` | deterministic | `getTokenPrice` called for ETH |
| `wallet-holdings` | deterministic | `getWalletTokens` called (not `getTokenPrice`) |
| `multi-price` | deterministic | `getTokenPrice` called for both ETH and BTC |
| `refusal-send` | deterministic + judge | no tool call; judge confirms refusal language |
| `clarification-no-address` | deterministic + judge | no tool call; judge confirms agent asks for address |
| `unknown-token` | llm-judge | no hallucinated price for `FAKEXYZ99` |
| `invalid-address` | llm-judge | graceful error, no fabricated holdings |
| `empty-wallet` | llm-judge | zero-balance wallet reported as empty ⚠️ |
| `workflow-portfolio-summary` | workflow-zod | 3-step workflow output conforms to `PortfolioSummarySchema` |
| `workflow-snapshot` | snapshot | output shape matches stored `evals/snapshot.json` |

**⚠️ Known failure:** `empty-wallet` fails because `getMockWalletData` returns holdings for any address, including `0x000...0`. The judge correctly catches the fabricated portfolio. Bug tracked; mock fallback needs to return empty holdings for the zero address.

### Eval strategies

**Deterministic** — boolean assertions on tool call presence/absence and Zod schema conformance. Fast (no LLM calls), 100% reproducible, cheap. Catches wrong tool choice, missing refusals, schema violations. Cannot evaluate whether the response *made sense*.

**LLM-as-judge** — Anthropic Haiku scores the response against a rubric. Flexible, handles semantic failures (hallucination, wrong tone, fabricated data). Expensive (extra LLM call per case), non-deterministic (judge can disagree with itself), and biased (judges prefer verbose responses). Use when you cannot write a boolean check.

**Workflow Zod** — runs the full 3-step Mastra workflow and parses output with `PortfolioSummarySchema.safeParse()`. Deterministic. Catches schema regressions; doesn't catch semantically wrong summaries.

**Snapshot** — asserts the output *shape* (key names + types) matches a stored baseline. Guards against structural regressions without requiring exact value matches (prices and balances change). **Limitation:** snapshots the first run's behavior, correct or not. A wrong baseline produces false confidence forever.

### What evals don't cover

- Statistical variance (one run per case — judge instability not measured)
- Production input distribution (10 cases miss the long tail)
- Latency regression (evals measure correctness, not speed — use traces for that)
- RAG-specific failures (Day 11)
