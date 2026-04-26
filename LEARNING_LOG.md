# Day 6 Learning Log — Observability + Evals

## Bugs surfaced by evals (note, don't fix yet)

- **`empty-wallet` case fails.** `getMockWalletData` returns mock holdings for *any* address, including `0x000...0`. The agent therefore fabricates a non-empty portfolio instead of reporting "empty wallet." Fix: return empty holdings when address is the zero address, or when Zapper returns null and the address is clearly invalid. Don't remove the mock fallback entirely — it's needed for wallets Zapper doesn't index.
- **Day 5 open thread resolved:** The workflow's `summarise` step uses raw `generateObject` inside a Mastra step. Confirmed that OTEL hooks into the AI SDK's underlying fetch, so the LLM call appears as a `model_generation` span in the trace automatically. No extra instrumentation needed.

---

## Self-evaluation quiz

### Q1. What's the difference between a trace and an eval? Give a concrete failure mode each one catches that the other misses.

**My answer:** An eval suite isn't enough because it's non-deterministic and can lead to false positive signals giving a sense of misleading confidence; it doesn't provide insights into technical performance like speed, reliability, or responsiveness. Traces aren't enough because they don't give any insights on quality; a system can yield a hallucination very fast.

**Correction:** The first half conflates two distinct eval weaknesses. LLM-as-judge non-determinism is real but it's a weakness *within* evals, not the core weakness of an eval suite. The fundamental problem with a golden set is **coverage**: you only test the 10 cases you imagined. Unknown unknowns (the Solana address, the 200-token wallet) stay untested regardless of whether your judge is deterministic. The hallucination example for traces is exactly right — "a clean trace can still produce a wrong answer" is the canonical failure mode.

Corrected mental model:
- Evals miss what you didn't write down → **coverage gap**
- Traces miss whether the output was actually correct → **quality gap**
- LLM-as-judge additionally introduces noise *on top of* the eval layer

---

### Q2. You're debugging a slow agent run. Walk through the trace. What's the first span you look at, and what number counts as "bad"?

**My answer:** Verify most time is spent on inference (the part I don't have control over). Verify the step didn't burn absurd tokens (~1000/step is non-negligible).

**Correction — gap:** You spotted the token count but didn't ask *why* step 1 costs 985 input tokens for a 7-word question. The trace tells you: system prompt + tool result JSON + full message history all get re-injected into step 1's context. `lastMessages: 20` means even turn 0 carries ~900 tokens before the user says a word. Token cost is a function of memory window + system prompt length, not message length. Also: you said "verify quality and accuracy" — you can't do that from a trace. The trace shows the agent *used* the tool output faithfully; it doesn't verify whether the tool output was correct. That requires an eval.

**First span to look at:** work the tree top-down: `model_step: step 1 = 2579ms` is the biggest number. Haiku averages 1–3s so this is normal. If `tool_call: getTokenPrice = 2000ms`, that's CoinGecko timing out — and that's something you can fix (cache, timeout, fallback).

---

### Q3. What's a deterministic eval structurally bad at catching? Give a case from today's eval run.

**My answer:** A deterministic check verifies if there was a response, not if the response was sensical.

**Correct.** The `empty-wallet` case: a deterministic check sees ✅ `getWalletTokens` was called, ✅ response contains text. It doesn't catch that the agent returned a fabricated non-empty portfolio for the zero-balance address. The judge caught it because it could reason about semantic content against the rubric. Deterministic → structure. Judge → semantics.

---

### Q4. The LLM-as-judge scores a response as failing, but you think the response was fine. Who's wrong and how do you tell?

**My answer:** The judge can be wrong — it's non-deterministic with billions of parameters.

**Correction:** Non-determinism is one failure mode, but *bias* is the deeper one. The judge systematically prefers verbose answers, penalises short ones, agrees with confident-sounding responses — consistently, not randomly. Non-determinism means variance run-to-run; bias means wrong in the same direction every time. To tell who's wrong: (1) read the response yourself — human review is ground truth for a golden set; (2) interrogate the rubric — vague rubrics produce noisy scores; (3) run the judge N times — if it flips 5/10, it's noise; 9/10, it's signal. If you can't tell: tighten the rubric, mark as informational, or document as flaky in LEARNING_LOG.

---

### Q5. When does snapshot testing actively hurt you for an LLM agent?

**My answer:** Snapshots test deep equality; if values should have changed, I don't want a green check.

**Correction — opposite failure mode:** That describes a snapshot that correctly *fails* when behavior changes. The dangerous case is the opposite: a **green snapshot giving false confidence**. The snapshot was written on the first run, which snapshotted whatever the agent produced that day — correct or not. If the `summarise` step was quietly producing wrong `riskNotes`, we snapshotted that wrong behavior. Every future run produces the same wrong output, the snapshot stays green, and we never notice. This is why our snapshot checks **shape** only (key names + types), not exact values — but even shape checking doesn't catch semantic regressions. Snapshot testing is a regression gate ("did it change?"), not a correctness gate ("was it ever right?").

---

## Concepts to walk into Day 7 already understanding

1. **Trace anatomy** — agent_run → model_step (N) → tool_call / model_chunk → processor_run. Token usage and finishReason live on model_step attributes. Tool I/O lives on tool_call spans. Memory load/persist live on processor_run spans.
2. **Observability vs evals split** — traces answer "what happened"; evals answer "was it correct." Neither substitutes for the other. A perfect trace can hide a hallucination; a green suite can hide production failures.
3. **LLM-as-judge tradeoffs** — expensive (extra LLM call), non-deterministic (variance), biased (systematic preferences). Use when you can't write a boolean check. Treat scores as noisy signal, not ground truth.
4. **Golden set structural weaknesses** — small N, curator bias, no behavioral coverage, stale baselines. Knowing these is more important than having a large suite.
5. **DuckDB lock** — DuckDB uses an exclusive file lock. Running `pnpm eval` while `mastra dev` is open causes a lock conflict. The eval runner uses a separate `eval-mastra` instance (no DuckDB) to avoid this.

## Open threads for Day 7

- **`empty-wallet` mock bug** — `getMockWalletData` returns holdings for any address. Fix before Day 7 deploy so the eval suite is green.
- **README still says "Day 1"** in its title — updated to Days 1–6 today but needs a proper rewrite for the public post.
- **`ConsoleExporter` in production** — remove before Day 7 deploy; it's noisy in logs.
- **Langfuse** — the docs only ship `DefaultExporter`, `ConsoleExporter`, `CloudExporter`. Langfuse requires a custom OTEL HTTP exporter — not mechanical enough for today. Worth wiring for the CV if you have 30 min.

---

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
