# Day 12 Learning Log — RAG as an Agent Tool

## Checkpoint questions

### 1. Day 11 eval baseline

`recall@5 = 80%` on the 14-path corpus (100% on 4-path subset). Two misses: "risk gate agent" and "parallel spawning" — generic queries where competing document chunks outranked the correct target.

**What this means today:** For 80% of corpus queries the agent gets accurate grounding material. The two miss categories return *some* chunks, but from the wrong path. Bad retrieval shown to the user is worse than no retrieval — so the system prompt instructs the agent to attribute answers to the corpus ("According to the Wayfinder Paths corpus…") rather than stating retrieved content as fact. Attribution makes the failure mode visible instead of invisible.

---

### 2. Import strategy: `file:` dependency

Added `"day11-rag": "file:../day11-rag"` to day1-wallet-agent's package.json, and an `exports` field to day11-rag's package.json pointing to `./src/search.ts`.

**Why `file:` and not direct relative import:** The package.json entry makes the dependency explicit — `pnpm ls` shows it, the lockfile tracks it, any engineer reading package.json understands the dep graph. A raw `import '../../day11-rag/src/search.js'` is invisible to tooling and fragile to directory moves.

**Why not pnpm workspace:** Workspace requires a root-level `pnpm-workspace.yaml` and coordination between packages for versioning. Overkill for a single consumer of a co-located sibling package; `file:` gives the same boundary benefits with no infrastructure.

**What breaks if day11-rag moves:** One line in package.json (`file:../new-path`). If its public interface (search.ts exports) changes, TypeScript catches it at compile time. If internal files change, consumers are isolated.

**Post-session update — Vercel deploy fix:** `file:` deps break on Vercel because only the project root is deployed; the `../day11-rag` sibling doesn't exist in the build environment. Migrated to Option B: the 4 RAG source files (`types.ts`, `embed.ts`, `db.ts`, `search.ts`) are inlined into `src/lib/rag/`, and `@supabase/supabase-js` + `ws` added as direct dependencies. Import in `search-corpus.ts` changed from `'day11-rag'` to `'../../lib/rag/search.js'`. The module boundary is preserved at the function level; the package boundary was a local-dev convenience that doesn't survive deployment.

---

### 3. Tool description as routing mechanism

The `searchCorpus` description explicitly names the domain (Wayfinder Paths corpus, AI agent orchestration workflows) and explicitly excludes the competing domain (live on-chain data, token prices, wallet balances).

**Routing test:** Given the description and query "What is my wallet balance?" — the description says "Do NOT use for wallet balances." The model should not call it. Given "What does the conditional router policy do?" — the description says "questions about specific named paths, workflow archetypes." The model should call it.

**What would still fool it:** A query like "What Wayfinder path manages my token balance?" — the phrase "token balance" would trigger the Zapper exclusion guard, but "Wayfinder path" is clearly in-corpus. The model should call corpus, but might route to Zapper first. A more explicit description: "Use ONLY for questions about Wayfinder Path definitions, not for questions about live wallet data even if they mention Wayfinder."

---

### 4. System prompt routing

The agent has two tool categories:
- **Zapper tools** — live on-chain data (token balances, portfolio, DeFi positions, token prices)
- **searchCorpus** — Wayfinder Paths corpus (orchestration workflow definitions, skill descriptions, path archetypes)

For a hybrid query like "What is the virtual-delta-neutral path and does my wallet hold any relevant tokens?":
1. Agent calls `searchCorpus("virtual-delta-neutral")` to get the path definition
2. Agent calls `zapper-mcp_get_token_balances` for the wallet
3. Blends both in the response

The system prompt doesn't prescribe a fixed order — it describes the two domains and says "let the question guide which tools you call and in what order." This allows the agent to compose freely within a turn.

---

### 5. Smoke-test and wire verification

Live query "What does the Conditional Router Reference path do?" produced:
- Tool call: `searchCorpus` with `query="Conditional Router Reference path"`, k=5
- Hits: 5, latency: ~1190ms (dominated by Voyage AI embedding)
- Agent response attributed to corpus, described as a policy-type path

The `[searchCorpus]` console.log confirms the tool ran, what chunks were returned, and the latency. If the agent ignores retrieved content and answers from parametric knowledge, you'd see the tool call in the trace but the response wouldn't reference specific path names from the corpus — it would give generic answers instead.

---

### 6. Bug caught during implementation

**The `{ context }` execute signature bug.** The Mastra tool API passes input data as the first argument directly (`execute: async (inputData) => {...}`), not wrapped in a `context` property. My initial implementation used `execute: async ({ context }) => { const { query } = context; ... }` — destructuring a `context` property that doesn't exist on the input object. The error was silent: `context` was `undefined`, and the tool threw `TypeError: Cannot destructure property 'query' of 'undefined'` *before* the try-catch I added around `searchDeduped`. The agent received a tool error, said "I'm encountering a technical issue," and fell back to parametric knowledge. Lesson: when a Mastra tool silently fails, check the execute signature first.

---

### 7. ESM + top-level await fix (pre-existing Day 10 bug)

`portfolio-agent.ts` uses top-level await (`const mcpTools = await zapperMCP.listTools()`), which requires ESM. The package was missing `"type": "module"`, so tsx compiled in CJS mode and threw `Top-level await is currently not supported with the "cjs" output format`.

Fix: added `"type": "module"` to day1-wallet-agent's package.json.

Secondary issue: in ESM mode, static `import` statements are hoisted before inline code. The eval runners load env vars inline, but that code ran *after* the hoisted imports evaluated — which meant `portfolio-agent.ts` initialized before `ZAPPER_API_KEY` was set. Fix: converted the `evalMastra` import to a dynamic `import()` call that executes *after* the env loading code.

---

### 8. Eval results

**Grounded (3/3 passed):**
| Case | Tool called | Result |
|------|-------------|--------|
| rag-grounded-conditional-router | searchCorpus | ✅ pass |
| rag-grounded-delta-neutral | searchCorpus | ✅ pass |
| rag-grounded-ens-manager | searchCorpus | ✅ pass |

**Ungrounded (3/3 passed):**
| Case | Tool called | Result |
|------|-------------|--------|
| rag-ungrounded-eip4337 | none | ✅ pass |
| rag-ungrounded-fake-eip | none | ✅ pass |
| rag-ungrounded-price-routing | getTokenPrice | ✅ pass |

**Observations:**
- Grounded cases: agent retrieved correct chunks and attributed them to the corpus. No hallucinated path names.
- Ungrounded EIP-4337: agent answered from parametric knowledge without claiming corpus attribution. Correct — EIP-4337 is not in the Wayfinder Paths corpus.
- Ungrounded fake EIP: agent correctly said it had no information about EIP-99999.
- Routing case: price query went to `getTokenPrice`, not `searchCorpus`. The tool description exclusion held.

**Context window cost:**
- k=5 chunks × ~600 char truncation limit = ~3000 chars ≈ 750 tokens for RAG results
- Plus MCP tool results, system prompt (~350 tokens), conversation history
- Total budget usage per RAG-augmented turn: ~1500–2500 tokens above baseline
- Doubling k to 10: adds another ~750 tokens, diminishing returns past k=5 for a 14-path corpus (some docs only have 2-3 relevant chunks)

---

## Self-evaluation (5 questions)

### 1. Agentic RAG vs. pipeline RAG — which did I build?

**Agentic RAG.** The agent *decides* whether to call `searchCorpus` on each turn. If the query doesn't need corpus knowledge, the tool is never called — the agent routes to Zapper tools or answers from parametric knowledge directly.

**Pipeline RAG** embeds the query before every LLM call, stuffs the top-k chunks into the prompt, then calls the LLM. The LLM always receives retrieved content whether it helps or not. This is simpler to implement (just pre-process every request) but wasteful and can degrade quality when retrieved chunks are noise.

**When to pick pipeline RAG instead:** When *every* user query needs corpus grounding — e.g. a customer support bot whose answers must always cite from the knowledge base. In that case the retrieval is mandatory, not optional, and hardcoding it as a pipeline stage is simpler than relying on the model to always call the retrieval tool.

---

### 2. Tool description quality

The `searchCorpus` description includes:
- The corpus name ("Wayfinder Paths")
- The content domain ("AI agent orchestration workflow definitions — monitors, strategies, policies, bundles")
- Positive examples of what to use it for ("specific named paths, skill definitions, workflow archetypes")
- Explicit exclusions ("Do NOT use for live on-chain data, current token prices, wallet balances")

**What query pattern would still fool it:** A query that mixes domains ambiguously — e.g. "What is the best strategy for managing my wallet positions?" The word "strategy" appears in the description as something the corpus covers, but this query is clearly about live portfolio management. A more defensive description would add: "Use ONLY when asking about the definitions and descriptions of named Wayfinder Paths — not for investment advice or live data questions that happen to use strategy terminology."

---

### 3. Context window budget

k=5, truncated to 600 chars each ≈ **~750 tokens for RAG results**.

If I double k to 10:
- Token cost: ~1500 tokens for RAG alone
- Quality impact: likely **flat or negative** for this corpus. At 14 paths × ~3-6 chunks each ≈ 50-80 total chunks. The 6th–10th results by similarity score are likely low-relevance (the corpus is small enough that top-5 captures almost everything relevant). More chunks = more noise for the model to reason around.

For a 500+ path corpus, k=10 or k=15 might help — there are more relevant paths that fall below the k=5 cutoff. The right k scales with corpus size, not a fixed heuristic.

---

### 4. Grounded vs. hallucinated eval results

**6/6 passed** (3 grounded, 3 ungrounded).

No hallucinated corpus citations observed. When the corpus didn't have the answer, the agent either said "I don't know" or answered from general knowledge without attributing to the corpus. The system prompt instruction ("do not fabricate a corpus citation") and the explicit attribution language ("According to the Wayfinder Paths corpus…") together make the failure mode visible: an answer without the attribution prefix signals it came from parametric knowledge.

The bigger gap in this eval set is **grounded false negatives** — corpus queries where retrieval fails and the agent falls back to wrong parametric knowledge without flagging it. The `{ context }` bug earlier demonstrated this: the tool failed silently, the agent gave a generic answer that sounded plausible, and the only signal was a subtle rubric violation.

---

### 5. Observability — what Langfuse signal to alert on if retrieval silently degrades

Today's `console.log` in the tool captures: query, k, hit count, latency. In production these would be Langfuse span attributes on a `searchCorpus` span.

**Signals to alert on:**

1. **Mean similarity score drops** — if top-1 similarity for known-good queries falls below 0.3, the corpus or embedding model has drifted. Alert on `p50(similarity) < 0.3` over a rolling 24h window.

2. **Hit count drops to 0** — `searchDeduped` returning 0 results means either the Supabase connection failed or `minSimilarity` threshold is too high. Alert on `hits == 0` for any production query.

3. **Latency spikes** — embedding calls dominate latency (~400-500ms). If p95 > 3s, Voyage AI is rate-limiting or degraded.

4. **`searchCorpus` call rate drops to zero** — if the agent stops calling the tool for queries that historically triggered it, either the tool description was changed to be too restrictive or the agent's routing behavior changed. A daily check on "what fraction of corpus-relevant queries triggered searchCorpus" catches silent routing regressions.

---

## What surprised me

1. **The execute signature bug was completely silent.** Mastra caught the TypeError and passed it to the agent as a tool error, which the agent papered over with "I'm encountering a technical issue." No stack trace visible to the eval runner. The pattern `execute: async ({ context })` looks correct to a TypeScript reader familiar with other frameworks — but it's wrong for Mastra. Lesson: check the Mastra type definitions before guessing the execute signature.

2. **ESM hoisting broke the existing eval runner in a way that wasn't caught on Day 10.** The `file:` dependency forced me to fix it today. The fix (dynamic import after env loading) is the right pattern for "initialize env before modules that read it at startup."

3. **Tool routing worked with almost no tuning.** The tool description alone was enough to correctly route EIP-4337, fake EIP-99999, and USDC price queries. The model's instruction-following for well-written tool descriptions is strong.

---

## Open threads (Day 13+)

- [ ] **Reranking:** Top-5 results include low-similarity chunks (~0.27). A cross-encoder reranker would improve result ordering.
- [ ] **Hybrid search (BM25 + vector):** The two recall misses from Day 11 ("risk gate agent", "parallel spawning") were generic-term queries. BM25 would nail exact slug/keyword matches.
- [ ] **HyDE:** For abstract queries, generate a hypothetical answer first → embed that → retrieve. Helps the two Day 11 misses.
- [ ] **A/B eval (with-RAG vs. without-RAG):** Not completed today due to eval infrastructure fixes. With grounded eval passing 3/3, RAG clearly improves specificity for named-path queries vs. parametric knowledge alone.
- [ ] **Multi-turn retrieval:** Agent retrieves, reads, then retrieves again with a refined query. Named as a pattern — not built today.

---

# Day 6 Learning Log — Observability + Evals (archived)

## Bugs surfaced by evals (note, don't fix yet)

- **`empty-wallet` case fails.** `getMockWalletData` returns mock holdings for *any* address, including `0x000...0`. The agent therefore fabricates a non-empty portfolio instead of reporting "empty wallet." Fix: return empty holdings when address is the zero address, or when Zapper returns null and the address is clearly invalid. Don't remove the mock fallback entirely — it's needed for wallets Zapper doesn't index.

---

# Day 13 Learning Log — Production Prep

## Self-eval questions

Answer these without looking at the code.

### 1. Config vs. secret

Where does the distinction between a config value and a secret live in this codebase, and what fails if a secret is treated as config (or vice versa)? Give a concrete failure mode.

> Secrets live in infra (Vercel env vars, never in code). The code-level enforcement mechanism is the `NEXT_PUBLIC_` prefix — anything prefixed is baked into the client JS bundle at build time. Concrete failure: put `SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_` var and every browser gets a Postgres admin credential that bypasses RLS. The distinction is inventoried in `CONFIG_INVENTORY.md` and enforced by `lib/env.ts`'s required-secret list.

---

### 2. Hosted Postgres trade-off

Why Supabase and not Neon or Railway Postgres? What's the migration cost if you had to switch in 6 months?

> Supabase was chosen for fast setup: pgvector enabled by default, `match_chunks` RPC defined via the dashboard, `createClient` SDK takes 3 lines. Migration cost is NOT zero — the corpus queries use `client.rpc('match_chunks', ...)`, which is Supabase's RPC API. Porting to Neon/Railway requires rewriting the query layer to raw `pg` calls and recreating the function by hand. Estimate: 4–8 hours plus corpus re-ingestion. The setup benefit was real; the lock-in is real too.

---

### 3. Health check design

`/api/health` makes live calls to Postgres, pgvector, and Anthropic on every request. What's the cost (latency, $) of each probe? Should this endpoint be cached, rate-limited, or run on a schedule instead of on-demand?

> The Anthropic probe makes a real `generateText` call (573–790ms, one token-burn per hit). Caching the response means serving stale health data — a cached 200 doesn't tell you Anthropic went down 30 seconds ago. Better fix: replace the Anthropic probe with a key-presence check only (like the Langfuse leg), or cache the result for 60s so one live call covers many health-check callers. The pgvector and Postgres probes are cheap (~400ms, no token cost) — keep those live.

---

### 4. Failure-mode coverage

Of the three error boundaries (MCP, Postgres, Anthropic 529), which are you least confident handles real load correctly? Why, and what's the cheapest test that would expose the gap?

> The Anthropic 529 mid-stream boundary. The code catches 529s thrown *before* streaming starts. A 529 that fires after HTTP 200 headers are sent produces a silently truncated response — the stream just stops, no error message, user doesn't know whether to retry. This was documented in PRODUCTION.md and has not been triggered in the deployed environment under real conditions. Cheapest test: inject a mock that throws after the stream headers are sent and verify the client sees a recoverable error, not a dead stream.

---

### 5. Production-readiness honesty

What did you ship without that a real production system would require? Pick the top 3 gaps and rank them by user pain.

> Ranked by user pain: (1) Mid-stream Anthropic 529 → user sees a truncated response with no error message; they don't know whether to retry or whether their query was processed. (2) No rate limiting on `/api/chat` → at HN-level traffic (~100 req/min), worst-case exposure is ~$200/hour before the $10/day spend alert fires. (3) No auth → no user identity, no abuse attribution, no personalized memory. MCP not being deployed is an architectural limitation, not a user-facing gap — the graceful degradation message handles it cleanly.

---

## What surprised me

> The `output: 'standalone'` issue on Day 14 — the health route built cleanly locally, passed the Vercel build log, and still silently 404'd in production because the routes manifest was structured differently. A 10-second `curl -si | grep x-matched-path` check before declaring "deployed" would have caught it. The gap between "container runs locally" and "all routes reachable from the public internet" is not visible from the build log alone.

---

## Open threads (Day 14+)

- [ ] MCP server: deploy as Streamable HTTP on Railway/Fly, point MCPClient at URL instead of spawning child process
- [ ] Rate limiting: per-IP limiter on `/api/chat` before sharing the URL publicly
- [ ] Mid-stream 529 boundary: use AI SDK `onError` stream callback to inject terminal error chunk
- [ ] Langfuse tracing on the raw AI SDK chat route (currently console-only)
- [ ] Separate Supabase projects for dev vs prod

---

# Day 14 Learning Log — Deploy + Smoke Test

## Local-vs-prod divergences

### 1. `output: 'standalone'` broke `/api/health` on Vercel (fixed)

`next.config.ts` had `output: 'standalone'` unconditionally. On Vercel, this changes how the
routes manifest is written — the `/api/health` Lambda was not registered in Vercel's routing
table. Requests to `/api/health` silently fell through to a pre-rendered static 404 page
(edge-cached, `x-matched-path: /404`, `x-vercel-cache: HIT`). The other API routes (`/api/chat`,
`/api/portfolio-summary`) were already in the Vercel deployment from a previous `vercel deploy`
CLI run and didn't regress.

**Diagnostic signal:** response headers `x-matched-path: /404` + `age: 1653` + `x-vercel-cache: HIT`
— a Lambda response would never have age > 0 on a first hit.

**Fix:** gated `output: 'standalone'` on `!process.env.VERCEL`. Docker builds still get standalone;
Vercel builds don't, so all routes are correctly registered as Lambda functions.

**Cheapest test that would have caught this pre-deploy:** `curl -si <url>/api/health | grep x-matched-path`
— if it says `/404`, the route isn't registered.

### 2. MCP server is local-only (expected, documented)

`src/mastra/mcp.ts` resolves the server binary at `../day9-zapper-mcp/build/server.js`. On Vercel,
`process.cwd()` is `/vercel/path0/` and the sibling directory doesn't exist. The MCPClient throws
"Cannot find module /vercel/day9-zapper-mcp/build/server.js". The error boundary in the chat
route catches this and returns `{}` for mcpTools. Agent response: "I don't have access to live
wallet data tools in this environment." — clean degradation, no 500.

### 3. Langfuse coverage gap between routes

The Mastra agent path (`/api/agent`) has Langfuse tracing via `@mastra/langfuse`. The chat route
(`/api/chat`) — where `searchCorpus` actually runs — logs to console only. After the Day 12
refactor that moved `searchCorpus` from the Mastra agent to the chat route, no single path
exercises both Langfuse and RAG. You can get a Langfuse trace from the Mastra agent (Zapper
queries) or see RAG working in the chat route (console logs only) — not both at once.

---

## Smoke test results (deployed URL: https://day1-wallet-agent.vercel.app)

| Case | Expected | Result | Latency |
|------|----------|--------|---------|
| `price-eth` | calls `getTokenPrice` | ✅ PASS | 4127ms |
| `corpus-conditional-router` | calls `searchCorpus` | ✅ PASS | 5670ms |
| `corpus-delta-neutral` | calls `searchCorpus` | ✅ PASS | 5203ms |
| `ungrounded-eip4337` | no tool call | ✅ PASS | 4782ms |
| `price-refusal` | no tool call | ✅ PASS | 2236ms |
| `mcp-wallet-holdings` | degrades gracefully | ✅ RAN | 3850ms |

**Pass rate: 5/5 verified + 1 manual check = 6/6**

### `/api/health` (all four legs)

| Dep | Run 1 | Run 2 | Run 3 |
|-----|-------|-------|-------|
| postgres | 431ms | 373ms | 426ms |
| pgvector | 464ms | 156ms | 437ms |
| anthropic | 604ms | 790ms | 602ms |
| langfuse | 0ms | 0ms | 0ms |

pgvector variance (156–464ms, 3×) is the free-tier Supabase single-instance cold/warm state.
This is the leg most likely to flake first under real traffic.

---

## Latency numbers

| Query type | Warm latency | Steps | Bottleneck |
|------------|-------------|-------|-----------|
| Simple price query | 1869–2638ms | 2 | One LLM call + CoinGecko (~300ms) |
| Corpus query (searchCorpus) | 5196–6080ms | 2 | Voyage embedding (~1000ms) + two LLM calls |

**Dominant latency contributor on a corpus query:** Voyage AI embedding call inside `searchCorpus`
(~1000ms observed locally in Day 12, consistent with 5.5s total for a two-step corpus query).

Breakdown estimate for 5.5s corpus query:
- First LLM call (tool selection): ~800ms
- Voyage embedding: ~1000ms
- pgvector search (from Vercel IAD1 → Supabase): ~400ms
- Second LLM call (final response with corpus context): ~800ms
- Streaming + network overhead: ~1.5s
- Total: ~5.5s ✅

**Cheapest 30% latency cut:** Colocate the Supabase project with the Vercel Lambda region (IAD1
= us-east-1). If Supabase is in a different region, every pgvector query pays a cross-region
roundtrip — consistent with the 156–464ms variance we see. Not free: Supabase region is
immutable post-creation; you'd need to recreate the project in the target region and re-ingest
the entire corpus. That's a 2-hour task. Do it before sharing the demo with anyone who'll notice
latency.

---

## Self-evaluation (5 questions)

### 1. Local-vs-prod divergence

The largest gap was `output: 'standalone'` causing `/api/health` to silently 404 on Vercel while
succeeding locally and in Docker. The divergence wasn't a code bug or a missing env var — it was
a Next.js build configuration that means different things to different deployment targets.

The cheapest pre-deploy test: `curl -si <prod-url>/api/health | grep -E "x-matched-path|HTTP"`.
If `x-matched-path: /404` appears, the route isn't registered. Takes 10 seconds.

### 2. Latency story

Corpus query: ~5.5s total. Breakdown: ~800ms LLM tool-selection + ~1000ms Voyage embedding +
~400ms pgvector + ~800ms LLM final response + ~1.5s streaming/network.

Cheapest 30% cut: in-memory embedding cache for repeated queries (reduce Voyage calls from
~1000ms to ~5ms on cache hit). Not free: needs TTL management and invalidation on corpus updates.

### 3. Failure-mode reality check

**Proved in production:**
- MCP unreachable → clean degradation message, no 500 ✅

**Trust but haven't proved in production:**
- Anthropic 529 mid-stream: the error boundary catches 529s *before* streaming starts. A 529 that
  arrives after headers are sent produces a truncated stream. Tested locally in theory but not
  triggered in the deployed environment under real load.
- Postgres drop during `searchCorpus`: the error boundary returns empty results with an error
  flag. Verified locally; not explicitly triggered in production by dropping the Supabase
  connection.

### 4. Blog post's load-bearing claim

"RAG-as-tool, not RAG-as-pipeline-stage: the model decides per-turn whether to call `searchCorpus`."

Defensible on a tech screen: the 6-case eval suite (3 grounded, 3 ungrounded, all passing in
production) shows the tool description alone correctly routes queries without any hardcoded logic.
The code reference is `lib/tools/search-corpus.ts` — the description field is the entire routing
policy.

### 5. Senior signal vs. demo polish

What looks like senior judgment: the named deferrals (reranking gated on corpus size, MCP
deployment as a separate concern, auth before user load not before demo load), the cost math in
PRODUCTION.md, and the honest Langfuse coverage gap.

What looks like polished demo with thin substance: the `/api/health` 404 I shipped without
catching — a 10-second `curl` check would have surfaced it before the blog post went out. The
gap between "container runs locally" (Day 13's claim) and "all routes reachable from the public
internet" (what today required fixing) is exactly the gap the Day 13 PRODUCTION.md should have
included as an open item.

---

---

## Day 15 — Inspect AI: Converting Eval Suites into a Real Evaluation Framework

**Date:** 2026-05-08 | **Inspect AI version:** 0.3.220 | **Deployed URL evaluated:** https://day1-wallet-agent.vercel.app

### Framework vocabulary (in my own words)

| Term | One-sentence definition |
|---|---|
| **Task** | The top-level unit — binds a dataset, a solver, and one or more scorers; `inspect eval task.py` runs it sample by sample and writes a versioned log. |
| **Dataset** | A list of `Sample` objects: each is one eval case with an input, optional target (ground truth), optional metadata, and an id. Lives in a JSONL file or inline Python. |
| **Sample** | One test case: `input` is what the model receives, `target` is what the scorer compares against, `metadata` is a free dict for anything the scorer needs that doesn't fit `target`. |
| **Solver** | The function that drives the model: takes a `TaskState` (with the sample's input), does the work, returns an updated `TaskState` with `output` populated. In our case: an HTTP solver that POSTs to the deployed agent, buffers the SSE stream, and extracts tool calls + final text. |
| **Scorer** | Receives `TaskState` (output + target) and returns a `Score`. Deterministic scorers are pure Python — fast, cheap, reproducible. Model-graded scorers call an LLM judge — flexible, but cost a model call per case and introduce flakiness. |
| **Metric** | Aggregates per-sample scores into a single number per run (e.g. `accuracy()` = fraction of CORRECT scores). The thing you chart over time. |

### What I built

**Repo:** `../day15-evals/` (sibling Python repo, Inspect AI 0.3.220)

- `evals/solver.py` — custom HTTP solver that POSTs to `/api/chat`, streams SSE, extracts `tool-input-available` events for tool call names and `text-delta` events for the final text. Stores tool call list in `state.metadata["tool_calls"]` so scorers can read it.
- `evals/wallet_agent.py` — Task 1: 8 cases, deterministic tool-routing scorer
- `evals/agentic_rag.py` — Task 2: 6 cases, deterministic routing + model-graded faithfulness scorer
- `datasets/wallet_agent.jsonl` — Day 7 cases ported
- `datasets/agentic_rag.jsonl` — Day 12 cases ported

### Results

| Task | Scorer | Score | Notes |
|---|---|---|---|
| wallet_agent | tool_routing | 8/8 (1.000) | 2 cases updated to reflect MCP prod limitation |
| agentic_rag | tool_routing | 6/6 (1.000) | |
| agentic_rag | faithfulness | 6/6 (1.000) | After fixing grader prompt false negatives |

### Surprises and bugs found

**1. Zapper MCP stdio subprocess can't start on Vercel Lambdas.**
`wallet-holdings` and `empty-wallet` initially failed: expected `zapper-mcp_get_portfolio`, got `[]`. Root cause: MCP uses a child process, which Vercel's serverless environment kills. The MCP error boundary (Day 13) correctly degrades — agent tells the user it only has `getTokenPrice` and `searchCorpus` available. Dataset updated to `mcp-degradation` cases. This is a real local→prod regression: wallet queries work on `localhost` (MCP binary runs), fail on Vercel.

**2. Inspect AI's `model_graded_qa` uses `target.text` as the criterion.**
My `target` was "searchCorpus" (for the routing scorer). When passed to `model_graded_qa`, it saw "searchCorpus" as the grading criterion — nonsense. Fix: custom `faithfulness_scorer` that reads the rubric from `state.metadata["judge_rubric"]` instead.

**3. Default `grade_pattern` expects `GRADE: C/I` format, not bare `CORRECT/INCORRECT`.**
`DEFAULT_GRADE_PATTERN = r"(?i)GRADE\s*:\s*([CPI])(.*)$"` — single letter grade, not the word. My first prompt said "respond with CORRECT or INCORRECT" which the pattern couldn't parse. Fix: updated prompt to say "GRADE: C or GRADE: I."

**4. Generic grader rules caused false negatives on grounded cases.**
My first faithfulness prompt included a generic rule: "must NOT attribute to corpus → any 'According to the Wayfinder Paths corpus:' phrase is a failure." The graded penalized attribution even on GROUNDED cases where attribution is correct. Fix: removed generic rules entirely; let the per-case rubric be the sole authority.

### Scorer choice defense

| Case type | Scorer | Failure mode |
|---|---|---|
| Tool-routing (wallet agent) | Deterministic `includes`-style | False positive: scorer only checks tool name, not whether the agent's response was sensible (a tool call with wrong args would still pass) |
| Faithfulness (grounded RAG) | Model-graded | False positive: rubric condition is vague enough that any plausible DeFi description satisfies it. Mitigation: rubric specifies exact path names and explicit "must NOT" conditions |
| Faithfulness (ungrounded RAG) | Model-graded | False negative: grader over-strict about attribution language. Mitigation: removed generic rules from prompt, let rubric drive |

### Cost reality check

| Component | Tokens | Cost |
|---|---|---|
| Inspect AI grader calls (agentic_rag, 6 cases) | ~2,778 | ~$0.004 |
| Agent HTTP calls (14 requests × ~40 tokens) | ~560 billed to agent key | ~$0.001 |
| **Full suite** | | **~$0.005** |

At $0.005/run: 200 runs = $1. This could run on every commit. Realistic cadence: on every PR (to avoid 14 parallel HTTP cold-starts to the serverless URL).

### Local vs. deployed regression

**Yes — two cases regressed.** `wallet-holdings` and `empty-wallet` passed locally (Zapper MCP works via child process) and failed in production (MCP subprocess can't start on Vercel). This is the highest-value finding of Day 15: the eval suite caught a behavioral gap that the Day 14 smoke test didn't surface (smoke test only checked that responses come back, not that wallet data was actually retrieved). The fix is to deploy the Zapper MCP server as an HTTP service (Railway or similar) so the agent can call it over HTTP rather than spawning a subprocess.

### The artifact's load-bearing claim

**Candidate README sentence:** "An Inspect AI evaluation suite that scores a deployed TypeScript AI agent end-to-end against the production URL — tool-routing accuracy and RAG faithfulness, versioned logs, viewable with `inspect view`."

**Is the suite evidence for that claim?** Yes, with one caveat: the suite is 14 cases total, which is enough to demonstrate the framework and establish a regression baseline, but not enough to claim statistical coverage. The honest version of the sentence is "establishes a baseline" not "validates production behavior." Day 16 should add cases to close that gap.

### Self-evaluation questions

1. **Framework vocabulary:** Answered in the table above. The key insight: `target` serves BOTH the routing scorer (tool name string) AND model-graded scorers (rubric text) — they can't share the same field. Use `metadata` to carry scorer-specific state beyond what `target` can hold.

2. **Scorer choice defense:** Answered in the table above. The main insight: model-graded scorers are the right tool for "did the response correctly attribute/not-attribute to the corpus?" — no string match captures that. But they introduce a new failure surface: the grader prompt itself.

3. **Cost reality check:** ~$0.005/run. At this cost, the suite could run on every commit without concern. The practical limit is HTTP cold-start latency on the serverless URL, not cost.

4. **Local vs. prod regression:** Yes — two cases. The MCP subprocess assumption is the bug. The eval suite surfaced it; the fix requires deploying MCP as a persistent HTTP server.

5. **Load-bearing claim:** The suite is honest evidence for "I know how to evaluate AI systems using a real framework." It's incomplete evidence for "the agent is production-grade" — 14 cases isn't statistical coverage. That's the right gap to close on Day 16.

### Day 16 candidates

- [ ] **Cases to add:** multi-turn conversations (the solver currently sends a single user message; real eval would test follow-ups); ambiguous queries that could route to either `getTokenPrice` or `searchCorpus`; queries that combine live data + corpus knowledge in one turn
- [ ] **Scorers to upgrade:** faithfulness scorer could use a more detailed rubric; latency scorer (measure p50/p99 response time per task); cost scorer (track agent-side token usage per request)
- [ ] **Upstream Inspect AI:** the `wallet_agent_solver()` pattern (custom HTTP solver that parses a vendor-specific SSE protocol) is reusable for any Vercel AI SDK app — could be a doc contribution or a `contrib/` example in their repo
- [ ] **Deferred Inspect AI features:** multi-turn agent evals (Inspect has solver chaining for multi-turn), tool-use sandboxing (running the agent in a sandbox), eval-result dashboards in CI (pipe `inspect eval` JSON to a Grafana annotation)
- [ ] **Most likely to flake on re-run:** the faithfulness scorer — grader is non-deterministic; the graded cases can flip if the agent response changes slightly. Add rubric stability tests (run each graded case 3× and check consistency) before using faithfulness as a CI gate
- [ ] **MCP prod fix:** deploy `../day9-zapper-mcp/` as a persistent HTTP server so wallet queries work on Vercel; re-run the eval and the `wallet-holdings`/`empty-wallet` cases should upgrade from `mcp-degradation` to proper tool-call assertions

---

## Day 16 Learning Log — Eval as a Regression Baseline

### What we built

Three moves to turn the Day 15 snapshot eval into a credible regression baseline:

**Move 1: Coverage** — 6 new cases in `combined_routing.jsonl`:
- `ambiguous-routing` (2): agent must not confuse "price impact" with "spot price," and must pick `getTokenPrice` when corpus is mentioned but can't answer
- `combined-live-corpus` (2): agent must call both tools in a single turn when both halves of the query need them
- `multi-turn-context` (2): agent must carry turn-1 routing context into turn-2 (e.g., "And BTC?" resolves as a price query)

**Move 2a: Latency scorer** — `latency.py` adds `p50_ms()`, `p99_ms()`, `max_ms()` metrics using Inspect AI's `list[SampleScore]` API. The solver records `wall_clock_ms` on every sample (including multi-turn total). CI gates on p50 (not p99) because Vercel Hobby cold-starts inflate p99 by 10×.

**Move 2b: Grader stability** — `flake_test.py` replays 6 committed cached agent responses through the faithfulness grader N=3 times. Result: 0% disagreement rate (0/18 runs differed from majority). All 6 cases are CI-blocking. Key design: committed cache isolates *grader* non-determinism from *agent* non-determinism.

**Move 3: CI** — `.github/workflows/eval.yml` added to this repo (agent repo). Triggers on PR, push to main, and `workflow_dispatch` (with optional `agent_url` override to test preview deployments). Clones `mehdi-loup/day15-evals` and runs all three tasks against the production URL. Accuracy thresholds + p50 latency budgets gate the PR check.

---

### Checkpoint questions

**1. Why gate on p50, not p99?**

Vercel Hobby Lambda cold-starts push p99 to 70–82s even on a healthy agent — one request hits the cold Lambda, the others are warm. The p99 reflects infrastructure behavior, not agent regression. p50 is the actionable metric: if the *median* case is slow, something is fundamentally wrong. If only the worst-case is slow, it's infrastructure noise.

**2. Why committed grader cache instead of re-running the agent?**

Re-running the agent introduces two noise sources simultaneously: agent non-determinism (does it call the right tools?) and grader non-determinism (does the grader evaluate the same text the same way?). A committed cache holds the agent response constant so the stability test measures *only* grader noise. If the cache goes stale (agent response format changes), update it by running one live eval and extracting the new responses.

**3. What does the ambiguous-price-impact failure teach us?**

The agent calls `getTokenPrice` when asked about "price impact of swapping 100 ETH." This is a genuine reasoning error: the model conflates a DeFi slippage concept with a spot-price query. The system prompt says "getTokenPrice: standalone price queries only (e.g. 'what's ETH at?')" — but "price impact" is ambiguous enough that the model misroutes. Fix: add a negative example to the system prompt ("getTokenPrice answers 'what is ETH worth?' — not swap output amounts, not slippage percentages, not pool depth").

**4. Why does multi-turn context work?**

The solver threads the full message history between turns. Turn 1 sends `[{role: "user", text: "What's ETH?"}]`, the assistant reply is appended, and turn 2 sends `[{role: "user", ...}, {role: "assistant", ...}, {role: "user", text: "And BTC?"}]`. The model sees the full conversation and infers "BTC" is a follow-up price query. This works because the AI SDK's `convertToModelMessages` accepts a messages array, not a single prompt string — the conversation is first-class.

**5. What did the failure rehearsal show?**

The regression: renamed the tool registration key from `getTokenPrice` → `getTokenPriceV2` in the tools object. The model still calls the price tool, but under the wrong name — the routing scorer's name-match check fails. Pushed directly to main (Vercel preview URL has 401 auth on Hobby plan, can't be used for external eval runners without a bypass token).

**The regression was caught** — but in `combined_routing`, not `wallet_agent`:
- `wallet_agent` ran first (~30s in): Vercel hadn't deployed the regression yet → PASS
- `combined_routing` ran last (~6 min in): regression was live → FAIL (0.333 < 0.670 threshold)

**The revert push also triggered a split run** — the intermediate CI run hit the deployment window from the other direction:
- `wallet_agent` still saw the regression → FAIL  
- `combined_routing` saw the fix (fully deployed by then) → PASS

**The clean signal** came from `workflow_dispatch` triggered after production was confirmed fixed (curl verified `toolName: getTokenPrice`). That run was green across all three tasks in under 3 minutes.

**Key takeaway:** The eval suite takes 10+ minutes; Vercel deploys in ~2-3 minutes. Any push-triggered CI run will have a deployment race window. This isn't a problem for regression detection (different tasks catch regressions at different deployment phases), but it does mean push-triggered CI will sometimes show split results that are hard to interpret. `workflow_dispatch` after a known-stable deploy is the clean verification path.

---

### Surprises and bugs found

**1. `timeout-minutes` at workflow level fails YAML parse.**
GitHub Actions only allows `timeout-minutes` at the job level, not the workflow top level. Fix: move under `jobs: eval:`.

**2. `inspect log dump` JSON vs text grep.**
The threshold check script initially used text-grep on the multi-column Inspect AI output table. Scorer names are truncated in the table (`tool_routing_sco…`) and accuracy values appear on the same row as multiple scorers. Regex completely failed for multi-scorer tasks. Fix: use `inspect log dump <file>` → JSON → parse `samples[].scores[scorer_name].value`.

**3. HTTPX `ReadTimeout` at 120s on searchCorpus cases.**
Cold Voyage AI + Supabase can take >120s. The `rag-ungrounded-fake-path` case timed out and received no scores (the sample showed `"scores": {}`). Fix: increased HTTPX read timeout from 120s to 300s.

**4. Faithfulness rubric over-specified forbidden content.**
`ambiguous-price-impact` rubric said "must NOT state a specific numeric slippage percentage." The agent said "typical slippage 0.1–0.5%" as DeFi background knowledge — the grader flagged this as forbidden. Rubric was too strict: it should forbid *computed* slippage for *this specific swap*, not background education. Fix: added "General DeFi ranges cited as background knowledge are acceptable."

**5. Vercel deployment window creates split CI results.**
The eval suite takes 10+ minutes. Vercel deploys in ~2-3 minutes. A push-triggered CI run starts before Vercel finishes, so early tasks (wallet_agent, ~30s) run against the previous build while later tasks (combined_routing, ~6+ min) run against the new build. The failure rehearsal showed this clearly: the regression push was caught in combined_routing (not wallet_agent), and the revert push showed the mirror image. Latent bugs that affect early tasks may not be detected until the next CI run where Vercel is already warmed. Mitigation: after any push, wait for Vercel deployment to complete before relying on CI results; `workflow_dispatch` on a confirmed-deployed commit is the clean signal.

**6. Vercel Hobby preview URL requires auth.**
`workflow_dispatch` with a preview URL override fails with 401 — Vercel Hobby plan puts preview deployments behind team authentication. The eval runner is an external GitHub Actions runner with no session cookie. Fix options: (a) use production URL (main branch only), (b) upgrade to Pro for `--public` previews, (c) use Vercel's Deployment Protection bypass secret header. On Hobby, (a) is the only free path.

---

### CI threshold reasoning (final after 5+ calibration runs)

**Key lesson:** Don't set thresholds from a single run. Run the suite 3-5 times and use the observed floor, not the average. Model-graded scores and latency are high-variance; only deterministic routing scores are suitable for hard CI gates in a Vercel Hobby / free-tier deployment.

**What ended up CI-blocking:**

| Task / scorer | Threshold | Reasoning |
|---|---|---|
| wallet_agent routing | 1.00 | Deterministic; stable across all runs |
| agentic_rag routing | 1.00 | Deterministic; stable across all runs |
| combined_routing routing | 0.67 | Floor at 4/6; `ambiguous-price-impact` flakes |

**What got downgraded to informational-only (collected but not CI-blocking):**

| Scorer | Observed range | Why excluded from CI gate |
|---|---|---|
| agentic_rag faithfulness | 0.800–1.000 | `rag-ungrounded-fake-path` timeouts remove it from scoring (leaving 5 cases); `rag-ungrounded-general-defi` agent flake fires intermittently |
| combined_routing faithfulness | 0.667–0.833 | Cold-start stream cutoffs cause partial text captures (pre-tool text only, missing synthesis); agent intermittently returns empty string |
| combined_routing p50 | 25s–82s | 4/6 cases call Voyage AI + Supabase; external cold-starts dominate |

The faithfulness downgrade is the key learning: a faithfulness failure can mean (a) agent produced wrong content, (b) grader made a borderline call, OR (c) stream cutoff caused partial text that looks like wrong content. Distinguishing (a) from (c) in production requires looking at per-sample tool_calls + output text, not just the aggregate score.

---

### Day 17 candidates

- [ ] **Fix `ambiguous-price-impact` agent failure:** Add negative example to system prompt: "`getTokenPrice` answers 'what is ETH worth?' — NOT swap slippage, NOT price impact, NOT pool depth"
- [ ] **Fix `rag-ungrounded-general-defi` fabrication:** Agent invents Uniswap/Aave Wayfinder corpus citations. System prompt already says "If the corpus has no relevant info, say so — do not fabricate a citation." The model ignores this. Stronger constraint: "If searchCorpus returns no results, tell the user: 'The corpus does not contain information on this topic.'"
- [ ] **Upgrade eval thresholds** after both agent fixes: routing and faithfulness should return to 1.00 for all tasks once the two known flakes are fixed
- [ ] **Langfuse tracing** on `/api/chat` — highest observability value before sharing widely
- [ ] **MCP as HTTP** — deploy zapper-mcp as a persistent HTTP server on Railway so Vercel can call it; `wallet-holdings` and `empty-wallet` cases should upgrade from `mcp-degradation` to real tool-call assertions

---

## Week 3 candidates

- [ ] Langfuse tracing on the raw AI SDK chat route (1 PR — highest observability value)
- [ ] MCP server as Streamable HTTP on Railway (makes the demo actually show live wallet data)
- [ ] Rate limiting on `/api/chat` before any real sharing (per-IP `Map<string, {count, resetAt}>`)
- [ ] Sync BM25+vector hybrid search into `packages/day11-rag` from `../day11-rag`
- [ ] Separate Supabase projects for dev vs prod
- [ ] Mid-stream Anthropic 529 boundary (AI SDK `onError` callback)
- [ ] Corpus growth: ingest more Wayfinder Paths to validate hybrid search signal at >50 paths

---

## Day 17 — 2026-05-13

### Moves completed

**Decision 1: Publication target — standalone polish only.**  
Read `UKGovernmentBEIS/inspect_evals` CONTRIBUTING.md and last 20 merged PRs. Key finding: they no longer accept new eval code submissions. New evals go through a Register process (external repo pointer). More importantly, their bar is "published by a major AI lab or credible academic group" — an eval over a personal wallet agent does not clear it without significant generalization work. Standalone polish is the honest call, with an upstream Register inquiry as a future Day 18+ option if the repo gains visibility.

**Decision 2: Agent-fix ordering — A (fix before benchmark, 30-min timebox).**  
Both Day 16 flakes fixed and verified post-deploy:
- `ambiguous-price-impact`: combined_routing routing 0.833 → 1.000. Root cause: agent conflated DEX slippage with spot price. Fix: explicit exclusion in system prompt + "if asked about price impact, explain you cannot compute on-chain swap simulations."
- `rag-ungrounded-general-defi`: agentic_rag faithfulness 0.833 → 1.000. Root cause was subtler: the corpus has real LP strategy content (Echelon Prime path). Agent found a partial match, then fabricated Uniswap V3 IL mechanics *on top of it*, attributed to the corpus. First fix (zero-results phrase) didn't work because results weren't zero. Second fix: explicit scope exclusion — general DeFi mechanics (IL, AMM math) are not corpus topics, answer from training knowledge without calling searchCorpus.

**Move 2: Cross-grader benchmark — Haiku vs. Sonnet 4.6.**  
12 faithfulness verdicts, 100% agreement. Pre-run priors: Haiku would be more lenient and more flaky. Both wrong. The explanation: precise rubrics (exact forbidden phrases, exact required attributions) remove model-size variance. When rubrics are unambiguous, even Haiku reads them correctly. CI conclusion: Haiku is the right grader — same quality for these rubrics at ~10× lower cost. The 0.833 vs 1.000 routing difference between grader runs was agent-side non-determinism, not grader variance (routing scorer is deterministic).

**Move 3: Deferred.**  
Cross-agent-model benchmark (Haiku/Sonnet/Opus as agent LLM via `?model=` query param) deferred to Day 18. The grader benchmark finding is the stronger publication story. Same-vendor model-size comparison would add cost without a new methodological insight given we already have the grader-axis finding.

**Move 4: Publication docs.**  
- README rewrite: load-bearing first sentence mentioning cross-grader benchmark, TL;DR table, 5-line quickstart, cross-grader findings section, agent-fix summary, citation block.
- `METHODOLOGY.md` (new): why these cases (4 failure modes), why two scorer types, why Haiku grader (benchmark-validated), dataset size justification, reproducibility checklist.
- `LIMITATIONS.md` (new): statistical coverage, query distribution, adversarial robustness, latency under load, MCP gaps, cross-vendor exclusion, grader variance bound, eval-as-training-signal risk.

Total Day 17 eval cost: ~$0.056 (well under $1.00 ceiling).

---

### Self-evaluation

**1. Publication-path defense.**  
Chose standalone polish. Evidence: `inspect_evals` CONTRIBUTING.md explicitly says "We no longer accept code submissions for new eval implementations." Even if they did, their credibility bar ("published by a major AI lab or credible academic group") excludes an eval over a personal wallet agent. The Register path (external pointer) is the realistic future step, but it requires the repo to have external visibility first. If a reviewer pushed back ("why didn't you open a PR?"), the answer is: I read their contributing guide before deciding, and the PR path was literally closed. The standalone polish produces a shareable artifact regardless.

**2. Cross-model interpretation — most interesting disagreement.**  
There were no disagreements. All 12 faithfulness verdicts matched between Haiku and Sonnet. The informative non-result: 100% agreement means the rubrics are precise enough to remove model-size variance — it's a validation of rubric design, not a failure of the benchmark to surface anything. If I were to resolve this by making the cases more interesting, I'd add a borderline case: "response that partially cites real corpus content but also contains fabrication." That case would likely break the 100% agreement and reveal Sonnet's superior ability to catch nuanced attribution failures.

**3. Agent-fix tradeoff.**  
Fixed before, documented before-fix scores in RESULTS.md. Published scores are 1.000/1.000 with a clearly labeled "pre-fix baseline" row. The story: "the eval found both flakes, the agent was patched, the suite confirmed the fixes." This is the right sequence — it demonstrates that the eval suite *works as a regression gate*, not just that the agent scores well. If I had published with-flakes numbers, the headline would be "my eval shows my agent fails 1/6 cases" which is weaker than "my eval caught two bugs, I fixed them, here's the before/after."

**4. Reproducibility honesty.**  
The quickstart in README was not freshly tested from a clean directory today — I ran it from within the existing venv. `uv sync` was previously verified to work (Day 15). The `.env.example` is present. The actual freshness concern: the cross-grader benchmark script was not run in CI, only locally. A true fresh-clone test would need to confirm the `GRADER_MODEL` env var flows correctly through `cross_grader_benchmark.sh`. This is a gap: the script works, but it's not CI-tested, so a user following the README could hit subtle issues (e.g., `uv` not finding the script's relative path if run from the wrong directory). Day 18 action: test from a fresh clone and fix anything that breaks.

**5. Updated load-bearing claim.**  
Day 16: *"The suite enforces regressions."*  
Day 17: *"The suite enforces regressions AND the grader is validated — 100% Haiku/Sonnet faithfulness agreement on precise rubrics, with pre/post agent-fix evidence that the enforcement actually works."*  
Is the suite evidence for that claim? Yes on the grader validation (the benchmark ran and produced the 100% figure). Yes on the "enforcement works" claim (the two Day 17 agent fixes were caught by the suite and confirmed post-patch). The asterisk: the agent-fix loop creates eval-as-training-signal risk (documented in LIMITATIONS.md). The suite is a stronger regression gate than it is an independent probe.

---

### Day 18 handoff

**Open threads:**
- Cross-agent-model benchmark (`?model=` query param on `/api/chat`, Haiku/Sonnet/Opus comparison) — deferred from Day 17. Good Day 18 warm-up: ~30min implementation + ~30min run + results table.
- Fresh-clone quickstart test — README claims it works in under 10 minutes. Verify this from a clean directory before citing the repo in applications.
- GitHub repo rename: `day15-evals` → `agentic-rag-evals` or `wallet-agent-evals`. Requires updating the CI badge URL in README, the cross-repo reference in `day1-wallet-agent/.github/workflows/eval.yml`, and any other internal links.

**Is the eval suite ready to be the lead link in job applications?**  
*Yes, with one caveat.* The README now reads as a public artifact (not a sprint log). The cross-grader benchmark adds a data point a recruiter can point to. The limitations section is honest. The quickstart is testable. The caveat: the repo name `day15-evals` is a sprint artifact name; it should be renamed before putting it in a cover letter. If Day 18 includes the rename + fresh-clone verification, the suite is ready.

**Day 18 nominal focus (per plan):** demo videos. Three 90-second walkthroughs:
1. Wallet agent: show a live portfolio query + price lookup + the stopWhen composing in action
2. RAG: ask a grounded Wayfinder path question, then an ungrounded one — show the attribution vs. graceful decline
3. Eval suite: show the CI badge, run `wallet_agent.py` live, show the cross-grader benchmark table — narrate "the eval found two bugs, here's the before/after"

The Day 17 artifact (README first sentence + RESULTS.md cross-grader table) is what the video opens with and points the viewer to. Make sure the repo is renamed and the live demo URL is stable before recording.

---

## Day 18 — 2026-05-14

### Moves completed

**Move 0: Pre-flight.** Locked recording tool (macOS Cmd-Shift-5 + Quicktime trim, no editing software) and the script template (hook ≤15 words / demo with honest moment / payoff ≤15 words). Anthropic-only stack (no third-party voiceover / editing tools).

**Move 1: Wallet-agent demo.** Recorded against the deployed Vercel URL (Option X), not localhost. Decision driver: a recruiter clicking the live URL after watching the video would see MCP-degradation and wonder why the video didn't show it — better to match the demo to the deployed surface. **Honest moment: price-impact refusal**, not MCP degradation. Rationale: the refusal is an agent behavior (system-prompt rule), not a deployment artifact — stronger credibility signal. Verified the refusal phrasing live before recording ("I cannot compute price impact or swap slippage. That requires on-chain swap simulation..."). Single take, embedded in `day1-wallet-agent/README.md` via GitHub web UI drag-drop (`user-attachments/assets/e6317eb3-...`). README first paragraph rewritten role-targeted, dropping "Week 2 (Days 1–14)" framing.

**Move 2: RAG demo.** Recorded against the deployed agent (no separate `day11-rag` UI exists). Two queries: grounded ("Conditional Router Reference path") to show `searchCorpus` attribution; out-of-corpus ("Email-Triage path") to show the canonical refusal. Skipped the terminal `ls corpus/` cold-open mid-prep — pure chat-UI single-surface demo, tighter. Key finding before recording: the planned "EIP-4337" refusal query wouldn't work because the Day 17 system prompt routes token-standard questions to training knowledge without calling `searchCorpus`. Had to pick a *path-shaped* query that's semantically far from any corpus content. README rewrite staged for the new `wayfinder-paths-rag` repo (see scope changes below); video upload to that README still pending at EOD.

**Move 3: Eval demo.** Recorded inside the renamed `agentic-rag-evals` repo (was `day15-evals`). Pre-run an `inspect view` log before recording so the dashboard step had a real trace to display. Caught a real bug during pre-run: `uv run inspect eval` doesn't auto-load `.env`, threw an Anthropic auth error. Fix: `set -a && source .env && set +a && uv run inspect eval ...`. Honest moment: LIMITATIONS section ("descriptive at this scale, not statistical").

**Scope changes (against the prompt's plan):**

- **Move 0 grew into a publishing sprint.** `day11-rag` had never been initialized as a git repo. Created `mehdi-loup/wayfinder-paths-rag` (non-sprint name, per consistency with `agentic-rag-evals`). 5 min `gitignore`/secret pre-flight + `git init` + `gh repo create --push`.
- **Renamed `day15-evals` → `agentic-rag-evals`** on GitHub. Updated local remote URL, README badge + clone refs, and the cross-repo checkout target in `day1-wallet-agent/.github/workflows/eval.yml`.
- **Move 4 (GitHub profile README) skipped.** User decision. Implication: cover letters must point directly at the three artifact repos; the profile page itself shows only the default GitHub repo listing without a positioning sentence. Survivable but suboptimal — flagged in handoff.
- **Move 5 (cross-linking pass) skipped.** User decision. Only one cross-link exists today: `day1-wallet-agent` README links to `agentic-rag-evals`. The reverse links (`agentic-rag-evals` → wallet-agent, `wayfinder-paths-rag` → wallet-agent, both → each other) are unstarted. Flagged in handoff.

### Surprises / bugs found during recording

- **EIP-4337 doesn't trigger searchCorpus refusal.** Day 17 system-prompt fix routes "general DeFi mechanics" (including token standards) to training knowledge. Solution: use a *path-shaped* query (Email-Triage) that triggers `searchCorpus` and returns zero hits.
- **`inspect view` requires a subcommand.** The Day 17 / Day 16 README quickstart used `uv run inspect view logs/`. Correct invocation is `uv run inspect view start --log-dir logs/`. Not a regression — likely an Inspect AI version bump. Worth a Day 19+ README quickstart audit.
- **`uv run inspect eval` doesn't auto-load `.env`.** Anthropic auth error if `ANTHROPIC_API_KEY` isn't exported in the shell session. Fix is one-liner (`set -a; source .env; set +a`) but the README quickstart should call this out.
- **`day11-rag` was never a git repo.** Day 1–13 work all happened in a local-only directory. Wallet-agent referenced `https://github.com/mehdi-loup/day11-rag` as a cross-link — that URL was 404 until today's publishing.
- **`day15-evals` README had four stale `day15-evals` URL references** post-rename. GitHub auto-redirects, but the canonical URL is cleaner. Fixed.

### Lead-link decision (for next sessions)

**Default lead link: [day1-wallet-agent](https://github.com/mehdi-loup/day1-wallet-agent).** Rationale: it's the *deployed* artifact a recruiter can click and try in 30 seconds without cloning anything. The video at the top of the README answers "what does this do?" in 90 seconds. The other two repos are stronger evidence of *depth* but require more interpretation effort.

Exceptions (per role archetype):
- **Safety-leaning shop / AI Eng with rigor framing:** lead with [agentic-rag-evals](https://github.com/mehdi-loup/agentic-rag-evals). The CI badge + cross-grader benchmark is the strongest "I know how to evaluate AI" signal.
- **Crypto product shop (Koinly archetype):** still lead with `day1-wallet-agent` — it's the most crypto-adjacent of the three.
- **Data-heavy / RAG-leaning role:** lead with [wayfinder-paths-rag](https://github.com/mehdi-loup/wayfinder-paths-rag). The 100% recall@3 + hybrid BM25+vector retrieval is the strongest retrieval-engineering signal.

### Self-evaluation

**1. Lead-link decision — see above.** Default is wallet-agent; two clear exceptions.

**2. Most credible honest moment across the three videos.** *To answer after watching all three together.* The strongest candidates: wallet-agent's price-impact refusal (the agent names `quoteExactInputSingle` as the mechanism it lacks — technical specificity is credibility); RAG's out-of-corpus refusal (canonical phrase plus helpful specificity); eval's LIMITATIONS callout (only credible if delivered as engineering humility, not apology). My prior: wallet-agent's refusal is the strongest because it includes the *useful alternative* the agent can do ("I can fetch spot prices for a rough manual comparison"). That converts a refusal into a scoped offer, which reads stronger than a pure no.

**3. Profile README positioning.** *Skipped — see scope changes.* The implication: when a recruiter clicks the GitHub username from any cover letter, they see the default repo listing. The three artifact repos' first paragraphs have to carry all the positioning weight on their own. Mitigation: pin the three repos so they appear at the top of the default listing.

**4. Recording-vs-editing time split.** *To answer.* Today's hidden cost was the publishing sprint (renaming `day15-evals`, publishing `wayfinder-paths-rag`, fixing cross-links) which the prompt didn't anticipate. If recording was <30% of the day and the rest was git ops + README editing, that's a sign the artifact-stack wasn't as ready going into Day 18 as Day 17's handoff implied.

**5. Recruiter-facing load-bearing sentence (replaces Day 17's load-bearing claim).** Draft:

> *"Three artifacts from a 21-day AI engineering sprint: a deployed TypeScript agent (Vercel AI SDK + MCP + RAG), a measured RAG library (100% recall@3, hybrid BM25+vector), and a CI-enforced Inspect AI eval suite with cross-grader stability data. Each has a 90-second walkthrough."*

That's 49 words. Tight enough to paste into a cover letter. Whether it survives a 5-second scan from a cold recruiter is the real test — book a human read before the Day 21 application push.

### Day 19 handoff

**Open threads (Day 19+ polish list):**

- **Move 4 — GitHub profile README** (`mehdi-loup/mehdi-loup` repo, doesn't exist). Highest-leverage README on the whole sprint. Headline calibration: must read for both Koinly-archetype (senior FE crypto) and AI-shop archetype. Draft v1 staged in conversation but not committed.
- **Move 5 — cross-linking pass.** Each artifact README needs "Related work" links to the other two. Currently only `day1-wallet-agent` → `agentic-rag-evals` exists.
- **`koinly_cover_letter.md`** needs the three video URLs inserted (placement only, no rewrite — that's a Day 19 task).
- **`wayfinder-paths-rag` README — video upload pending.** Same drag-drop flow as wallet-agent. Required before profile README can link to it cleanly.
- **`agentic-rag-evals` README — video upload pending.**
- **Local directory renames** (`day11-rag/` → `wayfinder-paths-rag/`, `day15-evals/` → `agentic-rag-evals/`). Cosmetic for terminal screencaps; deferred today. Renaming `day11-rag/` requires updating `day1-wallet-agent/package.json`'s `file:../day11-rag` dependency.
- **MCP HTTP on Railway** (Day 17 handoff item, deferred again today). Highest-impact upgrade for the wallet-agent demo: a deployed MCP server lets the live URL actually show wallet holdings. Probably a Day 22+ post-sprint weekend project — that's the right scope.
- **README quickstart audit** for `agentic-rag-evals`: `inspect view` subcommand needs updating (`start --log-dir logs/`), and the `.env`-loading caveat needs a one-liner in the README (or a wrapper script).

**Video URLs (canonical share links):**

- Wallet agent: `https://github.com/user-attachments/assets/e6317eb3-11a3-41a2-bd7b-a6f0657342f6` (live)
- RAG: *pending upload to `wayfinder-paths-rag/README.md`*
- Eval: *pending upload to `agentic-rag-evals/README.md`*

**Repos (canonical URLs):**

- [day1-wallet-agent](https://github.com/mehdi-loup/day1-wallet-agent) (live demo: https://day1-wallet-agent.vercel.app)
- [wayfinder-paths-rag](https://github.com/mehdi-loup/wayfinder-paths-rag) (published today; was `day11-rag` local-only)
- [agentic-rag-evals](https://github.com/mehdi-loup/agentic-rag-evals) (renamed today; was `day15-evals`)

**Is the artifact stack ready for outreach (Day 20) and applications (Day 21)?**  
*Mostly yes, with three things that should land before Day 20:* (1) the two pending video uploads, (2) the cross-linking pass, (3) the profile README — *or* a deliberate decision to skip the profile README and pin the three repos on the default profile view. Without these, the artifact stack is *findable* but not *legible-in-5-minutes*. Day 19's CV rewrite should not be the first thing that closes these gaps — CV writing is for Day 19's focus, polish list items are for Day 19's slack time.

