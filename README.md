# Wallet Agent — Week 2 (Days 1–14)

**Live demo: https://day1-wallet-agent.vercel.app** | [Blog post](BLOG_WEEK2.md) | [Production gap list](PRODUCTION.md)

A TypeScript agent that grounds itself via MCP-routed live wallet data and pgvector RAG. Ask it about a crypto wallet or a Wayfinder AI workflow path — it routes to the right source and cites what it retrieved. Built across a 21-day AI engineering sprint using Vercel AI SDK, Mastra, Anthropic Claude, Voyage AI embeddings, Supabase pgvector, and Langfuse observability.

## Architecture (Day 12+)

```
browser (useChat)
  └→ /api/chat (streamText + MCP tools)
        └→ src/mastra/mcp.ts (MCPClient singleton)
              └→ node ../day9-zapper-mcp/build/server.js (child process, stdio)
                    └→ Zapper GraphQL API

/api/agent (Mastra portfolioAgent.generate())
  └→ portfolioAgent tools:
        ├─ getTokenPrice (CoinGecko)
        ├─ searchCorpus (RAG — see below)
        └─ MCP tools (getPortfolio, getTokenBalances, getAppPositions)
              └→ src/mastra/mcp.ts
                    └→ node ../day9-zapper-mcp/build/server.js
                          └→ Zapper GraphQL API
```

### Tool routing — two knowledge sources

The agent has two categories of tools. The model decides which to call (agentic RAG — not pipeline RAG):

| Tool category | What it's for | Should NOT be used for |
|---|---|---|
| **Zapper MCP tools** | Live on-chain data: token balances, DeFi positions, portfolio totals | Static knowledge, definitions, docs |
| **`searchCorpus`** | Wayfinder Paths corpus: named workflow definitions, orchestration patterns, skill descriptions | Live wallet data, token prices, anything time-sensitive |
| **`getTokenPrice`** | Standalone price lookup (CoinGecko) | Any non-price query |

**Routing examples:**
- "What is my wallet balance?" → Zapper MCP tools only
- "What does the Conditional Router Reference path do?" → `searchCorpus` only
- "What is the virtual-delta-neutral path and does my wallet hold stablecoins?" → `searchCorpus` AND Zapper MCP tools

**Why agentic RAG and not pipeline RAG:** Pipeline RAG embeds every query and stuffs top-k chunks into every prompt, whether or not they're relevant. At k=5 that's ~750 extra tokens per request — wasted if the query is "what's my ETH balance?" The agent calling `searchCorpus` only when needed keeps the context window lean and prevents retrieved noise from degrading answers on non-corpus questions.

### `searchCorpus` tool details

- **Source:** `../day11-rag/` — installed as `"day11-rag": "file:../day11-rag"` in package.json
- **Retrieval:** `searchDeduped(query, k=5)` — cosine similarity over Voyage AI embeddings in Supabase pgvector, deduped to one chunk per document
- **Context budget:** 5 chunks × 600-char truncation ≈ 750 tokens of RAG context per call
- **Attribution:** System prompt instructs the agent to prefix corpus-derived answers with "According to the Wayfinder Paths corpus…" — makes retrieval visible and hallucinated citations detectable

### Failure modes at the RAG boundary

| Failure | Tool behavior | Agent/user sees |
|---|---|---|
| Voyage API rate-limited (429) | Tool retries up to 6× with 62s waits | Long latency or timeout if all retries exhausted |
| Supabase connection failure | Tool throws, Mastra passes error to agent | Agent says "I encountered a technical issue with the corpus search" |
| Query returns 0 results (below `minSimilarity`) | Tool returns `{ results: [] }` | Agent says "I don't have information about that in the corpus" |
| Wrong Mastra execute signature (`{ context }` instead of direct args) | TypeError on `context` being undefined — silent tool failure | Agent falls back to parametric knowledge without flagging the failure |

**Why MCP here:** `lib/zapper.ts` was deleted on Day 10 (the "deletion test"). The agent now
gets all Zapper data exclusively through the [day9-zapper-mcp](../day9-zapper-mcp/) server.
This decouples capability from orchestration: if the Zapper API changes, only the MCP server
updates — not this repo.

**Three tools, not one:** The Day 9 server exposes `get_portfolio`, `get_token_balances`, and
`get_app_positions` separately. All three are wired through to the model so it can pick the
right granularity: full portfolio for "what's in this wallet?", token balances for "does it hold
USDC on Base?", app positions for "any Aave debt?". A single `get_portfolio` tool would work
for 90% of cases but forces the model to receive and mentally discard DeFi position data on
token-only questions — ~200 tokens of unnecessary context per call.

**ZAPPER_API_KEY placement:** The key lives in this repo's `.env.local` but is only ever used
to configure the child process (`env: { ZAPPER_API_KEY }` in `src/mastra/mcp.ts`). After
Day 10, no code in this repo calls the Zapper API directly. The child process holds the key
and is the only caller.

**Stdio process lifecycle in dev:**
- The child process spawns on the first `zapperMCP.listTools()` call (lazy).
- `src/mastra/mcp.ts` is a module-level singleton — one process per Next.js server lifetime.
- In dev mode: hot reloads re-evaluate the module, orphaning the old child process.
  Multiple hot reloads → multiple orphaned processes (harmless — they exit when stdio closes).
- In production (single process, no hot reload): this is a non-issue.
- **Reconnection:** If the child process dies mid-session, Mastra auto-respawns it and retries
  the failed tool call once. The user sees no error.

**Day 9 server prerequisite:** The agent depends on `../day9-zapper-mcp/build/server.js`
being pre-built. If you edit the Day 9 server source and forget to rebuild (`pnpm build` in
`day9-zapper-mcp/`), the agent will spawn a stale binary silently. The failure mode: server
runs but returns old behavior. No build-time check enforces freshness.

### Failure modes at the agent boundary

| Failure | Server behavior | Agent/user sees |
|---------|----------------|-----------------|
| Bad/missing `ZAPPER_API_KEY` | Server exits at boot (`Fatal: ...`) | `listTools()` returns `{}` — agent starts with no Zapper tools; model tells user it cannot fetch portfolio data |
| Zapper API error (401, 429, 5xx) | `isError: true` + error message | Error message propagates to model verbatim; model surfaces it to user ("Zapper API returned Unauthorized") |
| MCP server process killed mid-session | Transport closes | Mastra auto-reconnects + retries once; user sees no error (transparent recovery) |

---

## Setup

```bash
# 1. Pre-build the Day 9 MCP server (required before the agent can start)
cd ../day9-zapper-mcp && pnpm build && cd -

cp .env.example .env.local
# fill in your ANTHROPIC_API_KEY, ZAPPER_API_KEY, VOYAGE_API_KEY, SUPABASE_*
pnpm install
pnpm dev          # Next.js UI on localhost:3000
pnpm mastra:dev   # Mastra Studio on localhost:4111
pnpm eval         # run the golden eval suite (10 original cases)
pnpm tsx evals/run-rag.ts  # run the 6 RAG-specific eval cases
```

## Keys needed

| Variable | Where to get it | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Agent model calls |
| `ZAPPER_API_KEY` | zapper.xyz | Forwarded to Day 9 MCP server child process |
| `VOYAGE_API_KEY` | dash.voyageai.com | `searchCorpus` tool — embeds queries at search time |
| `SUPABASE_URL` | supabase.com → project settings | `searchCorpus` tool — pgvector vector DB |
| `SUPABASE_SERVICE_ROLE_KEY` | supabase.com → project settings → API | `searchCorpus` tool — service role bypasses RLS |

## What's built

| Day | Feature |
|---|---|
| 1 | Streaming chat with `useChat` + `streamText` |
| 2 | `generateObject` + Zod structured portfolio summary |
| 3 | Tool calling — `getTokenPrice` (CoinGecko) + `getWalletTokens` (Zapper direct) |
| 4 | Composed `stopWhen`, streaming tool-call UI, abort button |
| 5 | Mastra layer — `Agent`, `Workflow`, `Memory` (LibSQL) |
| 6 | Observability (DuckDB traces → Studio) + 10-case eval suite |
| 10 | MCP migration — `lib/zapper.ts` deleted; all Zapper data via [day9-zapper-mcp](../day9-zapper-mcp/) |
| 12 | Agentic RAG — `searchCorpus` tool; Wayfinder Paths corpus via Supabase pgvector + Voyage AI; 6-case eval (3 grounded, 3 ungrounded, 6/6 passed) |

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
