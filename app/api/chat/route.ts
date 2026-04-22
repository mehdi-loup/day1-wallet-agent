import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// TODO: Day 2 — generateObject with Zod for structured wallet-portfolio summary

const SYSTEM_PROMPT = `You are a crypto portfolio assistant. You help users understand their wallet holdings,
track performance, and get insights about their DeFi positions. You are knowledgeable about major protocols,
tokens, and chains. Be concise and precise — your users are technical.`;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
