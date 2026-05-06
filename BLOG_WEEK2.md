# Wiring MCP and RAG into a TypeScript agent (and what it took to deploy)

*Day 14 of a 21-day sprint to ship an AI engineering portfolio from scratch.*

---

## What I built

Week 2 was about turning a working Week 1 agent into something with real architectural substance:
a TypeScript agent that routes queries across two distinct knowledge sources — live on-chain wallet
data via an MCP server, and a pgvector corpus of Wayfinder AI workflow definitions — with
Anthropic Claude Haiku for reasoning, Voyage AI for embeddings, and Langfuse for observability.

Live demo: **https://day1-wallet-agent.vercel.app** | Repo: **https://github.com/mehdi-loup/day1-wallet-agent**

The agent answers two types of questions:
- *"What's in this wallet?"* → routes to Zapper via MCP (live data)
- *"What is the Delta-Neutral path?"* → retrieves from a pgvector corpus (grounded knowledge)

---

## What "agentic RAG" actually means here

Most RAG implementations pre-fetch and inject corpus chunks into every prompt before the LLM sees
the query. I didn't do that. Instead, `searchCorpus` is a registered tool — the model decides
*whether* to call it on each turn based on the query type.

A question about token prices never touches the corpus. A question about a named Wayfinder Path
calls `searchCorpus`, retrieves the top-5 chunks from Supabase pgvector, and includes them in the
next LLM call. That's roughly 750 tokens of RAG context added only when it's relevant.

The tool description is the entire routing policy — no hardcoded `if (query.includes("Wayfinder"))`:

```
"Searches the Wayfinder Paths corpus — workflow definitions, strategy archetypes, orchestration
patterns. Do NOT use for live wallet data or token prices."
```

In production, this held: corpus queries correctly triggered `searchCorpus`; price/wallet queries
didn't. Verified with a 6-case eval suite (3 grounded, 3 ungrounded — all passing in production).

One real Langfuse trace: [[if you have a shareable trace URL, link it here — or reference PRODUCTION.md for the gap]]

---

## MCP as the only path to live data

The agent doesn't call Zapper directly. It spawns a local MCP server (the Day 9 server built on the
MCP TypeScript SDK) and routes all wallet-data queries through it via stdio transport. The agent's
view: three tool calls (`get_portfolio`, `get_token_balances`, `get_app_positions`). The data source
is fully swappable — change the MCP server, agent logic unchanged.

**The honest limitation:** the MCP server runs on localhost. Vercel's serverless functions can't
spawn persistent child processes from sibling filesystem paths. Today the Zapper tools are
unavailable in the hosted demo; the agent surfaces a clean degradation message ("I don't have
access to live wallet data tools in this environment") instead of a 500.

Fixing this requires deploying the MCP server as a Streamable HTTP endpoint on Railway or Fly and
pointing `MCPClient` at the URL instead of a local binary. Named in
[PRODUCTION.md](PRODUCTION.md) — not done this sprint.

---

## Production prep — what Day 13 was actually about

"Production ready" is a sliding scale. Here's where Week 2 landed:

**Hosted Postgres + pgvector on Supabase.** 14-path corpus ingested, `match_chunks` RPC for vector
search and a hybrid BM25+vector variant that improved recall@3 from 90% to 100% on the test
queries.

**`/api/health` probing all four dependencies.** In production from Vercel's IAD1 region to
Supabase: postgres 373–431ms, pgvector 156–464ms (high variance — free-tier single-instance warms
cold), Anthropic ping 573–790ms. The 3× pgvector variance is the number to watch first under real
traffic.

**Error boundaries on three failure modes:**
1. MCP unreachable → graceful degradation, no 500
2. Anthropic 529 → client-visible error, not a truncated stream
3. Postgres down → `searchCorpus` returns empty results with an error flag

**Cost guardrails:** 1024 output tokens/step cap, 6-step max per turn, $10/day Anthropic spend
alert. Worst-case at 100 req/min: ~$200/hour — the alert fires 3 minutes in, before it escalates.

The deploy itself produced one real divergence: `output: 'standalone'` in `next.config.ts` (needed
for the Docker runner stage) breaks Vercel's Lambda route registration. `/api/health` silently fell
through to a cached edge 404. Diagnostic: `x-matched-path: /404` in the response headers, not a
stack trace. Fix: gate `output: 'standalone'` behind `!process.env.VERCEL`.

---

## What I deferred and why

**Reranking + hybrid search in the hosted app.** The `packages/day11-rag` workspace copy still
uses vector-only search; the BM25+vector hybrid lives in the sibling `day11-rag` repo. With 14
paths in the corpus, reranking signal is noise. Sync when corpus exceeds ~50 paths.

**MCP server deployment.** Stdio transport is dead on serverless. The fix is a 4-hour task — worth
doing when the demo needs to show live wallet data, not before.

**Auth on the public endpoint.** Privy is wired on the frontend; the API route validates nothing.
At HN-level traffic, the rate-limit exposure is ~$200/hour (math is in PRODUCTION.md). Acceptable
for a sprint demo, not for anything with real traffic.

**Langfuse tracing on the chat route.** The Mastra agent path traces via `@mastra/langfuse`. The
raw AI SDK `/api/chat` route — where `searchCorpus` actually runs — logs to console only. Wiring
the Langfuse SDK exporter directly into the AI SDK route is one PR; I didn't do it this week.

These aren't failures. They're ranked deferrals: corpus too small for reranking signal, MCP
deployment is a separate concern, auth before user load not before demo load. The gap list is in
[PRODUCTION.md](PRODUCTION.md) with severity rankings.

---

## Next

I'm available for AI engineering roles. If you want to talk about agentic systems, RAG pipelines,
MCP integrations, or production-hardening TypeScript agents, reach out:
[mehdiloup.nasom@gmail.com](mailto:mehdiloup.nasom@gmail.com) | [GitHub](https://github.com/mehdi-loup/day1-wallet-agent)

*Full source, eval suite, and production gap list in the repo.*
