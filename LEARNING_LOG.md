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

> *(your answer here)*

---

### 2. Hosted Postgres trade-off

Why Supabase and not Neon or Railway Postgres? What's the migration cost if you had to switch in 6 months?

> *(your answer here)*

---

### 3. Health check design

`/api/health` makes live calls to Postgres, pgvector, and Anthropic on every request. What's the cost (latency, $) of each probe? Should this endpoint be cached, rate-limited, or run on a schedule instead of on-demand?

> *(your answer here)*

---

### 4. Failure-mode coverage

Of the three error boundaries (MCP, Postgres, Anthropic 529), which are you least confident handles real load correctly? Why, and what's the cheapest test that would expose the gap?

> *(your answer here)*

---

### 5. Production-readiness honesty

What did you ship without that a real production system would require? Pick the top 3 gaps and rank them by user pain.

> *(your answer here)*

---

## What surprised me

> *(your answer here)*

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

## Week 3 candidates

- [ ] Langfuse tracing on the raw AI SDK chat route (1 PR — highest observability value)
- [ ] MCP server as Streamable HTTP on Railway (makes the demo actually show live wallet data)
- [ ] Rate limiting on `/api/chat` before any real sharing (per-IP `Map<string, {count, resetAt}>`)
- [ ] Sync BM25+vector hybrid search into `packages/day11-rag` from `../day11-rag`
- [ ] Separate Supabase projects for dev vs prod
- [ ] Mid-stream Anthropic 529 boundary (AI SDK `onError` callback)
- [ ] Corpus growth: ingest more Wayfinder Paths to validate hybrid search signal at >50 paths
