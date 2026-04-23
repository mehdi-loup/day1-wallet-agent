# Wallet Agent — Day 1

Streaming chat UI powered by [Vercel AI SDK](https://ai-sdk.dev) with Anthropic Claude. Built as Day 1 of a 21-day AI engineering sprint.

## Setup

```bash
cp .env.example .env.local
# fill in your ANTHROPIC_API_KEY
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Keys needed

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |

## Known limitations

- No message persistence — refresh clears history
- No tool calling yet (Day 3)
- No structured output yet (Day 2)
- No auth or rate limiting
