# Day 5 — Mastra Layer

This repo now runs two concurrent dev servers:

| Command | Port | What it is |
|---|---|---|
| `pnpm dev` | 3000 | Next.js app (Days 1–4 UI) |
| `pnpm mastra:dev` | 4111 | Mastra Studio |

## Setup

```bash
pnpm install
cp .env.example .env   # add ANTHROPIC_API_KEY
pnpm mastra:dev        # Studio at http://localhost:4111
```

## What's in `src/mastra/`

```
src/mastra/
├── index.ts                        # Mastra instance — registers agent + workflow, wires LibSQL storage
├── agents/
│   └── portfolio-agent.ts          # Crypto portfolio Agent with tools + memory
├── tools/
│   ├── price.ts                    # getTokenPrice (CoinGecko)
│   └── wallet.ts                   # getWalletTokens (Zapper / mock fallback)
└── workflows/
    └── portfolio-workflow.ts       # 3-step pipeline → PortfolioSummarySchema
```

## What to try in the Studio

**Agent chat (with memory):**
1. Open `http://localhost:4111`, click `portfolio-agent`
2. Turn 1: `my wallet is 0x1234567890abcdef1234567890abcdef12345678`
3. Turn 2: `what's its top holding?` — agent should answer without re-asking for the address

**Workflow run:**
1. Click `portfolio-workflow`
2. Input: `{ "walletAddress": "0x1234567890abcdef1234567890abcdef12345678" }`
3. Watch the three steps execute in sequence — inspect each step's input/output in the graph view

**Tool isolation:**
1. Click any tool under the agent, run it with custom inputs to debug independently

## Mastra vs raw AI SDK — what changed

| | Raw AI SDK (Days 1–4) | Mastra (Day 5) |
|---|---|---|
| **Model config** | `streamText({ model: anthropic('...'), system, messages, tools })` reassembled on every POST | `new Agent({ model, instructions, tools })` — defined once, registered globally |
| **Memory** | You maintained `messages[]` array manually and passed it back on every request | Pass `threadId + resourceId`; Mastra fetches and stores history automatically in LibSQL |
| **Tool definition** | `tool({ description, inputSchema, execute })` — no output validation | `createTool({ id, description, inputSchema, outputSchema, execute })` — output schema enforced |
| **Multi-step orchestration** | Agent loops via `stopWhen`; you can't see step boundaries from outside | `createWorkflow().then(step1).then(step2).commit()` — deterministic, each step's I/O inspectable in Studio |
| **Observability** | Built `<ToolCard>` manually (Day 4) to surface tool call states in UI | Studio shows tool calls, step inputs/outputs, token usage, and run traces for free |

## The trade-off

Use **raw AI SDK** when: you have a single endpoint, no memory needed, full control matters, you don't want the Mastra process overhead.

Use **Mastra** when: you have multiple agents, persistent memory, multi-step workflows, or you want a dev UI without building one.

The cost of choosing Mastra too early: another process to run, Node 22+ required, opinionated file structure. The cost of choosing it too late: you rebuild memory, tracing, and multi-agent routing yourself.
