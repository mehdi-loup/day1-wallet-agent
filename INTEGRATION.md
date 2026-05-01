# Integration Snapshot — Day 10 MCP Migration

## Before: what called Zapper and how

### `lib/zapper.ts` — the client being replaced

**Function:** `fetchZapperPortfolio(address: string): Promise<ZapperPortfolio | null>`

**What it does:**
- Calls Zapper's GraphQL API directly with the wallet agent's own `ZAPPER_API_KEY`
- Uses the deprecated `networks: [Network!]` enum strings (`ETHEREUM_MAINNET`, `ARBITRUM_MAINNET`, etc.) — the current API uses `chainIds: [Int!]`
- Returns only token spot balances — no DeFi app positions
- **Swallows all errors silently** — returns `null` on any failure, including bad API key, rate limits, network errors

**Exported types:**
- `ZapperHolding { symbol, balance, balanceUSD }`
- `ZapperPortfolio { holdings, source: 'zapper' | 'mock', fetchedAt }`

### Callsite 1 — `lib/tools/wallet.ts` (AI SDK chat route)

Used by: `app/api/chat/route.ts` via `{ getWalletTokens }` in `streamText()`

```
app/chat/page.tsx (useChat → /api/chat)
  └→ lib/tools/wallet.ts → fetchZapperPortfolio(address)
       └→ Zapper GraphQL API (ZAPPER_API_KEY from wallet agent's process.env)
```

Fallback: if `fetchZapperPortfolio` returns `null`, falls back to `getMockWalletData(address)`.

### Callsite 2 — `src/mastra/tools/wallet.ts` (Mastra portfolio agent)

Used by: `src/mastra/agents/portfolio-agent.ts` via `tools: { getTokenPrice, getWalletTokens }`

```
app/api/agent/route.ts → portfolioAgent.generate()
  └→ src/mastra/tools/wallet.ts → fetchZapperPortfolio(address)
       └→ Zapper GraphQL API (ZAPPER_API_KEY from wallet agent's process.env)
```

Same fallback to mock data.

### Callsite 3 — `app/api/portfolio-summary/route.ts` (portfolio summary page)

```
app/page.tsx → /api/portfolio-summary
  └→ fetchZapperPortfolio(walletAddress) direct call
       └→ Zapper GraphQL API (ZAPPER_API_KEY from wallet agent's process.env)
```

No fallback — if `fetchZapperPortfolio` returns null, falls through to mock data.

---

## What "deletable" means

`lib/zapper.ts` is deletable when no file in the runtime path imports from it.
First import error if deleted right now: **`lib/tools/wallet.ts:4`** — `import { fetchZapperPortfolio } from '../zapper'`

Three files to migrate, in order:
1. `src/mastra/tools/wallet.ts` (Mastra agent path — primary Day 10 target)
2. `lib/tools/wallet.ts` (AI SDK chat path)
3. `app/api/portfolio-summary/route.ts` (portfolio-summary path)

---

## Problems with the current `lib/zapper.ts`

1. **Uses deprecated API.** `networks: ['ETHEREUM_MAINNET', ...]` — Zapper's current API uses `chainIds: [Int!]`. Day 9's server already uses the correct chain ID format; this client is stale.
2. **Silent null on failure.** Any error (bad key, rate limit, network timeout) returns `null`, which the caller interprets as "use mock data." A bad API key looks identical to a network timeout, which looks identical to an empty wallet. The model never sees an error — it sees mock holdings.
3. **Narrower scope.** Returns only token spot balances. Day 9's server exposes `get_token_balances`, `get_app_positions`, AND `get_portfolio` (combined). After migration, the model can query DeFi positions — a capability this client never had.
4. **Wrong security model.** The agent's process directly holds `ZAPPER_API_KEY` and makes Zapper API calls. After migration: the agent passes the key to a child process, and the child makes all Zapper calls. The agent code never calls Zapper.

---

## After: target architecture

```
app/chat/page.tsx (useChat → /api/chat)
  └→ streamText({ tools: { getTokenPrice, ...mcpTools } })
       └→ MCPClient (zapper-mcp) ← singleton
            └→ node ../day9-zapper-mcp/build/server.js (child process, stdio)
                 └→ Zapper GraphQL API (ZAPPER_API_KEY from child's env)

app/api/agent/route.ts → portfolioAgent.generate()
  └→ portfolioAgent (Mastra) — tools from MCPClient
       └→ MCPClient (zapper-mcp) ← same singleton
            └→ node ../day9-zapper-mcp/build/server.js (child process, stdio)
                 └→ Zapper GraphQL API

app/page.tsx → /api/portfolio-summary
  └→ MCPClient tool call (get_portfolio)
       └→ MCPClient (zapper-mcp) ← same singleton
            └→ node ../day9-zapper-mcp/build/server.js (child process, stdio)
                 └→ Zapper GraphQL API
```

One child process. One MCPClient singleton. All Zapper calls go through the Day 9 server.
