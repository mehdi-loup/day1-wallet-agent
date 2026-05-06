# Production Readiness Review — Day 13

> This is a demo system built during a 21-day AI engineering sprint. It is not a
> production system. This document names what's deployed, what's intentionally not,
> and the gaps a production system would require. Gaps are ranked by user pain.

---

## What's deployed

- **Next.js 16 app on Vercel** — streaming chat UI (`/chat`), REST endpoints (`/api/chat`, `/api/health`, `/api/portfolio-summary`)
- **Mastra agent** — available via `/api/agent` and Mastra Studio; uses Turso for memory
- **pgvector corpus on Supabase** — 14 Wayfinder Paths, Voyage AI embeddings, BM25+vector hybrid search
- **Langfuse** — tracing for the Mastra agent path (not the raw AI SDK chat route)
- **Health check** — `/api/health` probes Postgres, pgvector, Anthropic, and Langfuse key presence

## What's intentionally not deployed (and why)

| Item | Why deferred |
|------|-------------|
| **MCP server (Zapper tools)** | stdio transport requires a persistent child process; Vercel serverless can't host it. Fix: deploy as a Streamable HTTP server on Railway/Fly and point MCPClient at the URL. Sprint scope doesn't cover this. |
| **Auth on the public endpoint** | Demo posture: public read-only. If the demo gets traffic, this is the first thing to add (Privy is already wired on the frontend). |
| **Reranking, HyDE, hybrid search in the hosted app** | Corpus is 14 paths — too small to produce signal. The `packages/day11-rag` inlined copy still uses vector-only search. Revisit when corpus > 50 paths. |
| **CI/CD pipeline** | No automated test-on-PR or deploy-on-merge. Day 14 deploy is manual `git push`. |
| **Multi-region** | Single Vercel region. Supabase project in one region. Acceptable for a demo. |
| **Replicas / autoscaling** | Vercel scales serverless functions automatically; Supabase free tier is single-instance. |
| **Sentry / external error tracking** | Errors log to Vercel function logs only. Langfuse traces the Mastra path. |

---

## Top 3 gaps ranked by user pain

### 1. Mid-stream Anthropic 529 produces a broken/truncated response (HIGH)
The `try/catch` in the chat route handles 529s thrown *before* streaming starts. A 529 that arrives mid-stream (after HTTP headers are sent) surfaces as a truncated message with no explanation. The user sees an incomplete response and doesn't know whether to retry.

**Fix:** Use the AI SDK's `onError` stream callback to inject a terminal error chunk into the stream, or use a client-side error boundary that detects stream truncation.

### 2. No rate limiting on the public `/api/chat` endpoint (HIGH)
Any user can POST unlimited requests. At HN-scale traffic (generous estimate: 100 req/min):
- Worst case per request: 6 steps × 1024 output tokens = 6,144 output tokens
- Cost: 6,144 × $4.00/M (Haiku output) + ~12K input × $0.80/M ≈ **$0.034/request**
- At 100 req/min: $0.034 × 100 × 60 = **~$200/hour**

**Fix:** Vercel has a WAF with rate limiting on Pro. For Hobby: an in-memory per-IP limiter using a `Map<string, { count; resetAt }>` adds ~20 lines and cuts runaway exposure significantly.

### 3. No auth = no user identity = no abuse attribution (MEDIUM)
Without auth, there's no way to tie a request to a user, ban an abusive client by identity, or provide personalized memory across sessions. Privy is already wired on the frontend; the missing piece is passing the Privy JWT to the API route and validating it server-side.

**Fix:** Verify the Privy JWT in the chat route. Use it as the `resourceId` for Mastra memory so users get persistent cross-session history.

---

## Other named gaps (lower priority for demo)

- **`SUPABASE_SERVICE_ROLE_KEY` used for corpus reads** — the service role key bypasses RLS. An anon key with a permissive SELECT policy would reduce blast radius if leaked. The corpus is public data, so this is low risk but worth cleaning up.
- **Langfuse traces only on the Mastra path** — the `/api/chat` route (raw AI SDK) logs to console only. A Langfuse-traced error boundary requires wiring the SDK exporter directly into the route.
- **No PII handling** — if a user pastes a wallet address, it appears in Langfuse traces and server logs. No scrubbing, no retention policy.
- **Rollback story** — Vercel keeps deployment history; `vercel rollback` reverts the app in ~30s. Database schema rollback requires manual SQL (no down-migration scripts exist).
- **Single Supabase project for dev and prod** — a schema change or bad ingest run would corrupt the production corpus. Separate projects for dev/prod is the fix.

---

## Spend alert

A daily spend alert is configured in the Anthropic console at $10/day. This catches runaway loops before they escalate — at the worst-case rate above, $10 buys roughly 3 minutes of HN-level traffic, which is enough time to notice and pull the deploy.

---

## Rollback

```bash
vercel rollback          # revert app to previous deployment (~30s)
# Database: no automated rollback — restore from Supabase backup or re-run ingest
```
