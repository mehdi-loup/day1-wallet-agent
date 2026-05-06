# Config Inventory — Day 13 Production Prep

> Generated before any code changes. If you deleted `.env.local` and handed this
> to a new laptop, this document plus the README should be sufficient to reconstruct
> a running app.

---

## Environment Variables

| Name | Purpose | Today | Prod target | Secret? |
|------|---------|-------|-------------|---------|
| `ANTHROPIC_API_KEY` | LLM inference (Claude Haiku) | `.env.local` | Vercel env vars | **Yes** |
| `ZAPPER_API_KEY` | Passed to MCP child process | `.env.local` | N/A — MCP is local-only¹ | **Yes** |
| `TURSO_DATABASE_URL` | Mastra agent memory (LibSQL/Turso) | `.env.local` | Vercel env vars | **Yes** (contains credentials) |
| `TURSO_AUTH_TOKEN` | Turso auth token | `.env.local` | Vercel env vars | **Yes** |
| `VOYAGE_API_KEY` | Text embeddings (Voyage AI) | `.env.local` | Vercel env vars | **Yes** |
| `SUPABASE_URL` | Supabase project endpoint | `.env.local` | Vercel env vars | No (URL, not credential) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (pgvector auth) | `.env.local` | Vercel env vars | **Yes** — bypasses RLS; treat as a root password |
| `LANGFUSE_SECRET_KEY` | Langfuse trace auth (server-side) | `.env.local` | Vercel env vars | **Yes** |
| `LANGFUSE_PUBLIC_KEY` | Langfuse client key (server-side SDK) | `.env.local` | Vercel env vars | Soft secret (leaked = read-only traces, not write access to prod data) |
| `LANGFUSE_BASE_URL` | Langfuse endpoint | `https://cloud.langfuse.com` hardcoded in `.env.example` | Same | No — config |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy social login app ID (client-side) | `.env.local` ⚠️ missing from `.env.example` | Vercel env vars | No — exposed in JS bundle by design |

**Secret vs config distinction:**
- **Secrets** — if leaked, an attacker can impersonate the service, exfiltrate data, or run up a bill: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURSO_*`, `LANGFUSE_SECRET_KEY`, `ZAPPER_API_KEY`.
- **Config** — safe to appear in logs, dashboards, or client bundles: `LANGFUSE_BASE_URL`, `SUPABASE_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, `LANGFUSE_PUBLIC_KEY`.
- The `NEXT_PUBLIC_` prefix is Next.js's enforcement mechanism — anything prefixed is baked into the client JS bundle at build time. Never put a secret in a `NEXT_PUBLIC_` var.

---

## External Services

| Service | Endpoint | Auth mechanism | Purpose | Free-tier limit | Fallback if down |
|---------|----------|----------------|---------|----------------|-----------------|
| **Anthropic API** | `api.anthropic.com/v1` | `ANTHROPIC_API_KEY` header | LLM inference (Claude Haiku) | Pay-per-token, no free tier | None — agent fails |
| **Voyage AI** | `api.voyageai.com` | `VOYAGE_API_KEY` | Text embeddings for RAG | 10K tokens/min (free) | None — searchCorpus fails |
| **Supabase** | `${SUPABASE_URL}` | `SUPABASE_SERVICE_ROLE_KEY` | pgvector corpus storage | 500MB DB, 500K rows | None — searchCorpus fails |
| **Turso** | `${TURSO_DATABASE_URL}` | `TURSO_AUTH_TOKEN` | Mastra agent memory | 500 DBs, 9GB storage (free) | Local SQLite (`mastra.db`) |
| **Langfuse** | `cloud.langfuse.com` | Public + secret key pair | Observability / trace storage | 50K events/month (free) | Graceful — traces silently dropped, agent continues |
| **Privy** | `auth.privy.io` | `NEXT_PUBLIC_PRIVY_APP_ID` | Social login + wallet connect | Free tier available | Auth UI broken; wallet queries still work |
| **Zapper API** | Via MCP server | `ZAPPER_API_KEY` | DeFi portfolio data | — | Mock data (Day 1 fallback still in MCP server) |

---

## Local Paths and `localhost` References

These are the assumptions that break when you leave your laptop.

| File | Lines | Reference | Production status |
|------|-------|-----------|-------------------|
| `src/mastra/mcp.ts` | 7–10 | `path.resolve(process.cwd(), '../day9-zapper-mcp/build/server.js')` | **PRODUCTION BLOCKER** — Vercel serverless has no filesystem sibling directories and cannot spawn persistent child processes |
| `src/mastra/index.ts` | 11–15 | `file:${DB_PATH}` (local SQLite fallback) | Dev-only fallback — acceptable; production uses Turso URL |

---

## Ports

| Port | Used by | In production |
|------|---------|---------------|
| `3000` | Next.js dev server (`next dev`) | Vercel manages port; not configurable |
| (MCP subprocess stdio) | `day9-zapper-mcp` child process | No TCP port — stdio only. Not applicable in production. |

---

## Known Gaps (to resolve today)

1. **MCP server is local-only.** `../day9-zapper-mcp/build/server.js` cannot run on Vercel. The Zapper tools (`get_portfolio`, `get_token_balances`, `get_app_positions`) will be unavailable in the hosted demo. Named limitation — document in `PRODUCTION.md`.

2. **`NEXT_PUBLIC_PRIVY_APP_ID` missing from `.env.example`.** A fresh clone cannot configure Privy auth without knowing this variable exists.

3. **`packages/day11-rag/src/search.ts` is vector-only.** The hybrid BM25+vector improvements from `../day11-rag` (Day 13 retrieval work) have not been synced into the inlined workspace package. The hosted app runs the older retrieval code.

4. **`SUPABASE_SERVICE_ROLE_KEY` used for corpus reads.** The service role key bypasses Row Level Security. For read-only corpus access, an anon key with a permissive SELECT policy would reduce blast radius if leaked. (Acceptable for demo; document in PRODUCTION.md.)

5. **No fail-fast boot check.** Missing secrets cause silent failures or confusing runtime errors rather than a clear startup crash. Needs a boot-time validation guard.

6. **No `/api/health` endpoint.** No way to verify all dependencies are live without sending a real user request.

7. **No error boundaries on Anthropic 529, Postgres drop, or MCP unreachable.** All three produce unhandled exceptions today.

8. **No per-request output token cap or daily spend alert** explicitly documented (though `stepCountIs(6)` provides an implicit step budget).

---

## "New laptop" readiness check

Given only this document + the current README, could you restore a running app?

- [x] All env vars named and their purpose described
- [ ] `.env.example` is incomplete (`NEXT_PUBLIC_PRIVY_APP_ID` missing)
- [ ] README does not describe how to populate Turso (just references the env var)
- [ ] README does not describe Supabase setup or corpus ingestion
- [ ] MCP server build/run instructions not in README
- **Verdict:** Not yet. Fix `.env.example`, add infra setup steps to README.
