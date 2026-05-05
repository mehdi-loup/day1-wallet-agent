# Adding AI to a web3 wallet UI in TypeScript

GM. I'm a week into a 21-day sprint to ship as an AI engineer. Background is Zapper and Shopify — strong TypeScript and web3 chops, zero production AI experience at the start. The goal: build in public, create evidence, not just claims.

Here's what Week 1 produced and the one thing that actually surprised me.

## What I built

A crypto portfolio agent that can look up token prices, fetch wallet holdings from Zapper, and remember your wallet address across turns. Under the hood: Next.js 15, Vercel AI SDK v6, Mastra for the agent layer (memory, tools, workflow orchestration), and an eval suite that runs 10 golden cases before every deploy.

The stack looks like this in practice:

- **Tools** — `getTokenPrice` (CoinGecko) and `getWalletTokens` (Zapper) wired to the agent
- **Memory** — Mastra's `Memory` class with Turso (hosted LibSQL) so conversation history survives across requests
- **Observability** — Langfuse for production traces; every tool call, token count, and step latency is visible
- **Evals** — 10 hand-curated cases covering deterministic checks (did it call the right tool?), LLM-as-judge quality scores, Zod schema validation on the workflow output, and a regression snapshot

The agent is live at [day1-wallet-agent.vercel.app](https://day1-wallet-agent.vercel.app). Repo is at [github.com/mehdi-loup/day1-wallet-agent](https://github.com/mehdi-loup/day1-wallet-agent).

## The thing that surprised me

Local dev lies to you about how serverless works. I learned this the hard way.

The agent had memory. I tested it locally — told it my wallet address on turn 1, asked about my top holding on turn 2, it answered correctly. Worked every time. I deployed to Vercel and it forgot everything. No error, no crash, no warning in the logs. Just silence. Every turn 2 the agent asked for the wallet address again as if it had never heard of me.

The cause: Mastra's memory adapter was writing to a local SQLite file (`file:mastra.db`). On Vercel, each Lambda invocation runs in its own container with its own ephemeral filesystem. Turn 1 writes to container A. Turn 2 spins up container B. Container B has no `mastra.db`. From the agent's perspective, the conversation never happened.

The fix is two lines:

```ts
// before
url: `file:${path.join(process.cwd(), 'mastra.db')}`

// after
url: process.env.TURSO_DATABASE_URL ?? `file:${path.join(process.cwd(), 'mastra.db')}`
```

Same pattern hit the observability layer. The Day 6 setup used a local DuckDB file as the OTEL trace store. Spans batch in memory and flush on a timer — but the Lambda exits before the timer fires, so spans are silently dropped. Switching to `LangfuseExporter` (sends over HTTPS before the function exits) fixed it.

The lesson isn't "use Turso" or "use Langfuse." It's that **an agent has state that a CRUD API doesn't** — memory, in-flight spans, connection pools — and none of that survives the serverless container model by default. Every piece of local state that worked on my laptop became a silent failure in production. No errors to catch, just wrong behavior.

That's the gap between knowing how to prompt an LLM and knowing how to ship an agent.

## What's next

Week 2 starts with MCP — building a TypeScript MCP server so the agent can call external tools via the Model Context Protocol instead of hardcoded function definitions. The Week 1 infra (Turso memory, Langfuse traces, eval suite) is the foundation everything else plugs into.

If you're doing something similar or want to poke at the live demo, reply here or find me on X.
