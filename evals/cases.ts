/**
 * Golden test set — 10 hand-curated wallet-agent cases.
 *
 * Why "golden"? These are hand-verified: we know the correct answer (or correct behavior).
 * The set is intentionally small and covers behavioral boundaries, not statistical coverage.
 * See LEARNING_LOG for what it's structurally bad at.
 */

// ── Case shape ────────────────────────────────────────────────────────────────

export type EvalType = 'deterministic' | 'llm-judge' | 'workflow-zod' | 'snapshot';

export type EvalCase = {
  /** Unique ID used in pass/fail output */
  id: string;
  /** What this case is testing and why */
  description: string;
  /** User message sent to the agent (or wallet address for workflow cases) */
  input: string;
  /** Expected tool name the agent should call (deterministic check) */
  expectedToolCall?: string;
  /** If true, agent must NOT call any tool (refusal / clarification cases) */
  expectNoToolCall?: boolean;
  /**
   * For llm-judge cases: a rubric string the custom judge uses to score the output.
   * Leave undefined for deterministic cases.
   */
  judgeRubric?: string;
  /** Which eval strategy to run for this case */
  evalType: EvalType;
};

// ── Golden set ────────────────────────────────────────────────────────────────

export const cases: EvalCase[] = [
  // ── Deterministic: tool-call checks ────────────────────────────────────────

  {
    id: 'price-eth',
    description:
      'Price lookup for a known token — agent must call getTokenPrice with "ETH" and return a USD number.',
    input: 'What is the current price of ETH?',
    expectedToolCall: 'getTokenPrice',
    evalType: 'deterministic',
  },

  {
    id: 'wallet-holdings',
    description:
      'Wallet address query — agent must call getWalletTokens, not getTokenPrice. ' +
      'Key behavioural rule: holdings come from Zapper, not individual price lookups.',
    input: 'Show me the holdings for wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    expectedToolCall: 'getWalletTokens',
    evalType: 'deterministic',
  },

  {
    id: 'multi-price',
    description:
      'Two price queries in one message — agent should call getTokenPrice for both ETH and BTC. ' +
      'Tests whether the agent fans out multiple tool calls correctly.',
    input: 'What are the current prices of ETH and BTC?',
    expectedToolCall: 'getTokenPrice', // at least one call to this tool
    evalType: 'deterministic',
  },

  // ── Deterministic: no-tool-call checks ────────────────────────────────────

  {
    id: 'refusal-send',
    description:
      'Refusal case — agent must not call any tool and must decline the request. ' +
      'The agent is read-only; it is not a transaction signer.',
    input: 'Please send 1 ETH from my wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 to 0x1234567890123456789012345678901234567890',
    expectNoToolCall: true,
    judgeRubric:
      'The response must decline to execute the transaction. ' +
      'It may explain why (read-only agent) but must NOT claim to have sent any ETH.',
    evalType: 'deterministic',
  },

  {
    id: 'clarification-no-address',
    description:
      'Clarification case — user asks for portfolio without providing a wallet address. ' +
      'Agent should ask for the address, not hallucinate one or call getWalletTokens.',
    input: "What's in my crypto portfolio?",
    expectNoToolCall: true,
    judgeRubric:
      'The response must ask the user for their wallet address. ' +
      'It may specify that an EVM or Ethereum wallet address is needed. ' +
      'It must NOT fabricate an address, assume one, or call any tool.',
    evalType: 'deterministic',
  },

  // ── LLM-as-judge: quality / edge cases ────────────────────────────────────

  {
    id: 'unknown-token',
    description:
      'Unknown token — agent calls getTokenPrice for FAKEXYZ99, which returns an error or null. ' +
      'Checks that the agent reports the failure gracefully without hallucinating a price.',
    input: 'What is the price of FAKEXYZ99?',
    expectedToolCall: 'getTokenPrice',
    judgeRubric:
      'The response must acknowledge that the token price is unavailable or the token is unknown. ' +
      'It must NOT state a specific USD price for FAKEXYZ99.',
    evalType: 'llm-judge',
  },

  {
    id: 'invalid-address',
    description:
      'Invalid wallet address — agent receives a non-EVM address string. ' +
      'Either the agent validates and rejects before calling the tool, or the tool errors. ' +
      'Either way the response must not return fabricated holdings.',
    input: 'Show me the holdings for wallet notanaddress',
    judgeRubric:
      'The response must indicate the wallet address is invalid or that no holdings could be retrieved. ' +
      'It must NOT list any token holdings.',
    evalType: 'llm-judge',
  },

  {
    id: 'empty-wallet',
    description:
      'Edge case: a valid but zero-balance address (0x000...0). ' +
      'Agent calls getWalletTokens; mock/Zapper returns empty holdings. ' +
      'Response must handle zero holdings gracefully — no crash, sensible message.',
    input:
      'What are the holdings of wallet 0x0000000000000000000000000000000000000000?',
    expectedToolCall: 'getWalletTokens',
    judgeRubric:
      'The response must acknowledge that the wallet has no holdings or is empty. ' +
      'It must NOT list any tokens or fabricate a portfolio.',
    evalType: 'llm-judge',
  },

  // ── Workflow: Zod schema validation ────────────────────────────────────────

  {
    id: 'workflow-portfolio-summary',
    description:
      'Full 3-step workflow (parseWallet → fetchTokens → summarise) on a known address. ' +
      'The output must conform to PortfolioSummarySchema. ' +
      'Deterministic: if the Zod parse succeeds, the test passes.',
    input: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    evalType: 'workflow-zod',
  },

  // ── Snapshot: regression check ─────────────────────────────────────────────

  {
    id: 'workflow-snapshot',
    description:
      'Regression snapshot of the workflow output for a fixed address. ' +
      'The SHAPE (keys, types) must match the snapshot — not the exact values, ' +
      'because token prices and balances change. Seed of a CI regression gate.',
    input: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    evalType: 'snapshot',
  },

  // ── Day 12 RAG: grounded cases ─────────────────────────────────────────────
  // Questions whose answers ARE in the Wayfinder Paths corpus.
  // Pass criteria: agent calls searchCorpus AND answer is consistent with corpus content.

  {
    id: 'rag-grounded-conditional-router',
    description:
      'Grounded RAG case — corpus contains the Conditional Router Reference policy path. ' +
      'Agent must call searchCorpus and return an answer describing it as a routing/policy path. ' +
      'Tests that the agent retrieves and uses corpus content for a known path name.',
    input: 'What is the Conditional Router Reference path and what type of path is it?',
    expectedToolCall: 'searchCorpus',
    judgeRubric:
      'The response must describe the Conditional Router Reference as a policy or routing-type ' +
      'Wayfinder path. It may describe its purpose (conditional branching, routing logic). ' +
      'It must NOT claim it is a monitor or strategy type. ' +
      'It must NOT claim to have no information about this path.',
    evalType: 'llm-judge',
  },

  {
    id: 'rag-grounded-delta-neutral',
    description:
      'Grounded RAG case — corpus contains multiple delta-neutral paths (virtual-delta-neutral, ' +
      'kaito-pt-delta-neutral). Agent must call searchCorpus and surface at least one. ' +
      'Tests retrieval of strategy/monitor paths by topic.',
    input: 'What Wayfinder paths relate to delta-neutral strategies?',
    expectedToolCall: 'searchCorpus',
    judgeRubric:
      'The response must mention at least one delta-neutral related Wayfinder path by name ' +
      '(e.g. virtual-delta-neutral, KAITO PT Delta-Neutral, or similar). ' +
      'It must describe what the path does in terms of delta-neutral or carry strategies. ' +
      'It must NOT fabricate path names that were not in the retrieved results.',
    evalType: 'llm-judge',
  },

  {
    id: 'rag-grounded-ens-manager',
    description:
      'Grounded RAG case — corpus contains the ENS Manager path. ' +
      'Agent must retrieve and describe it. ' +
      'Tests that a relatively distinct path (ENS / DNS rather than DeFi finance) is still retrieved.',
    input: 'What does the ENS Manager path do?',
    expectedToolCall: 'searchCorpus',
    judgeRubric:
      'The response must describe the ENS Manager path in terms of ENS (Ethereum Name Service) ' +
      'or domain/name management. It should reference configuration or management of ENS names. ' +
      'It must NOT conflate this with a portfolio or financial strategy path.',
    evalType: 'llm-judge',
  },

  // ── Day 12 RAG: ungrounded cases ───────────────────────────────────────────
  // Questions whose answers are NOT in the corpus.
  // Pass criteria: agent does NOT fabricate a corpus citation.
  // Acceptable: answer from general knowledge clearly labeled as such, OR "I don't have that."

  {
    id: 'rag-ungrounded-eip4337',
    description:
      'Ungrounded RAG case — EIP-4337 (account abstraction) is not a Wayfinder Path. ' +
      'The agent may answer from general knowledge but must not claim the corpus defines EIP-4337. ' +
      'Key failure mode: "According to the Wayfinder Paths corpus, EIP-4337 is..."',
    input: 'What is EIP-4337 and how does account abstraction work?',
    judgeRubric:
      'The response must explain EIP-4337 / account abstraction correctly (or say it lacks details). ' +
      'It must NOT attribute this explanation to the Wayfinder Paths corpus or claim the corpus ' +
      'contains EIP-4337 content. Phrases like "according to the corpus" or "the corpus describes" ' +
      'applied to EIP-4337 content are a failure.',
    evalType: 'llm-judge',
  },

  {
    id: 'rag-ungrounded-fake-eip',
    description:
      'Ungrounded RAG case — EIP-99999 does not exist. ' +
      'The agent should not hallucinate an EIP definition, and must not fabricate a corpus hit. ' +
      'Tests the "I don\'t know" behavior for a definitively non-existent topic.',
    input: 'What does EIP-99999 define?',
    expectNoToolCall: true,
    judgeRubric:
      'The response must acknowledge that EIP-99999 does not exist or that the agent has no ' +
      'information about it. It must NOT describe a definition or purpose for EIP-99999. ' +
      'It must NOT state that the Wayfinder corpus contains information about EIP-99999.',
    evalType: 'llm-judge',
  },

  {
    id: 'rag-ungrounded-price-query',
    description:
      'Routing check — a live price query must use Zapper/getTokenPrice, not searchCorpus. ' +
      'Tests that the tool description prevents corpus lookups for on-chain data.',
    input: 'What is the current price of USDC?',
    expectedToolCall: 'getTokenPrice',
    judgeRubric:
      'The response must provide a price (or acknowledge it cannot be fetched) for USDC. ' +
      'It must NOT call searchCorpus for a price query. ' +
      'It must NOT attribute the USDC price to the Wayfinder corpus.',
    evalType: 'llm-judge',
  },
];
