# Wallet Agent — Day 1

Streaming chat UI powered by [Vercel AI SDK](https://ai-sdk.dev) with swappable Anthropic / OpenAI providers. Built as Day 1 of a 21-day AI engineering sprint.

## Setup

```bash
cp .env.example .env.local
# fill in your keys
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Provider toggle

Switch between Anthropic (Claude Haiku) and OpenAI (GPT-4o-mini) at runtime via the header buttons — no restart needed. The active provider is sent as a `provider` field in the POST body to `/api/chat`.

## Keys needed

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `OPENAI_API_KEY` | platform.openai.com |

Only the key for the active provider is called per request.

## Known limitations

- No message persistence — refresh clears history
- No tool calling yet (Day 3)
- No structured output yet (Day 2)
- No auth or rate limiting
