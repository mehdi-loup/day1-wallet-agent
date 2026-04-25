# Day 5 Learning Log — Mastra Fundamentals

## Self-evaluation quiz

### Q1. You have a Next.js route that calls `streamText` today — stateless, single endpoint, no memory. A teammate suggests migrating to Mastra. What's your response?

**My answer:** I'd ask if the motivation is to make the product production-ready.

**Correction:** "Production ready" is the wrong axis — both raw AI SDK and Mastra ship to prod. The real question is whether the endpoint needs **memory, multi-agent routing, or workflow orchestration**. A single stateless POST has none of those needs, so Mastra adds overhead (Node 22+, second process, new file structure) for zero functional gain. Don't migrate unless one of those three things is required.

---

### Q2. `createStep` execute receives `{ inputData, mastra }`. `createTool` execute receives `inputData` directly. Why the difference, and what breaks if you mix them up?

**My answer:** createStep is for workflows (atomic instruction); createTool is for agents and makes an LLM call.

**Correction:** Neither one makes an LLM call — both are plain JS functions. The LLM *calls* a tool; the tool runs JS. The actual difference: steps run inside Mastra's workflow pipeline, where Mastra needs to inject a second argument — the `mastra` instance — so steps can call agents mid-workflow. That's why the wrapper object `{ inputData, mastra }` exists. Tools are invoked by the LLM with just the validated input args, so no wrapper needed.

If you mix them up: write a step as `execute: async (inputData)` and `inputData` is actually `{ inputData: {...}, mastra: {...} }`, so `inputData.symbol` is `undefined`. No error thrown — silent wrong result.

---

### Q3. After 500 turns over 6 months, `lastMessages: 20` only gives the agent the last 20 messages. What's the right upgrade, and what does it require?

**My answer:** Store messages in a vector database — semantic recall.

**Correct.** Semantic recall does a similarity search over all past messages to pull the relevant ones into context, even if they're from a thread 3 months ago. Requires a vector store (e.g. pgvector, Pinecone). That's Day 11.

---

### Q4. A Studio trace shows `fetch-tokens` completed successfully but `summarise` throws a schema validation error. Most likely cause? How does the explicit `outputSchema` on each step help vs a raw agent loop?

**My answer:** fetch-tokens likely returned invalid data. Studio lets you verify what was actually in that response.

**Good.** More precisely: the `fetch-tokens` output didn't match `summarise`'s declared `inputSchema` — a schema mismatch at the step boundary. Studio shows the exact serialised output of `fetch-tokens` alongside `summarise`'s expected input schema, so you can diff them immediately. In a raw agent loop you'd get a terminal error with no intermediate state visible — you'd have to add `console.log` and re-run.

---

### Q5. The workflow runs `parseWallet → fetchTokens → summarise`. A PM asks: "can the agent just call those as tools instead?" Yes it can. What do you lose and gain?

**My answer:** Gain speed. Lose ordering certainty and observability.

**Half right.** Ordering + observability losses are correct. "Speed" isn't the right gain. What you actually gain with agent-as-tools is **flexibility**: the agent can skip `fetchTokens` if the user just asks for a price, or adapt the sequence based on context. A workflow can't reason about whether a step is needed — it always runs all steps in order. The trade-off: flexibility vs determinism and inspectability.

---

## Concepts to walk into Day 6 already understanding

1. **Agent vs Workflow decision** — agent when the path is open-ended; workflow when the sequence is known upfront and you need step-level observability.
2. **Memory layers** — conversation history (what we wired), working memory (system-prompt injection of structured user data), semantic recall (vector search, Day 11).
3. **`createStep` vs `createTool` execute signatures** — steps get `{ inputData, mastra }`; tools get `inputData` directly. Mixing them silently breaks.
4. **Studio as a free observability layer** — tool calls, step I/O, token usage visible without any custom UI code.
5. **`createAnthropic({ baseURL })` over bare `anthropic()`** — explicit base URL prevents ambient env var conflicts when running multiple processes.

## Open threads for Day 6

- The workflow's `summarise` step calls `generateObject` directly (raw AI SDK inside a Mastra step). Day 6 will add observability — check whether that raw call appears in traces or needs explicit instrumentation.
- `lastMessages: 20` is an arbitrary cap. Before adding eval pressure in Day 6, decide if 20 is right for the golden test set (long conversations may need more context to answer correctly).
