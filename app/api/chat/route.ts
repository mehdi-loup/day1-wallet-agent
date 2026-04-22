import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

// TODO: Day 2 — generateObject with Zod for structured wallet-portfolio summary

const SYSTEM_PROMPT = `You are a crypto portfolio assistant. You help users understand their wallet holdings,
track performance, and get insights about their DeFi positions. You are knowledgeable about major protocols,
tokens, and chains. Be concise and precise — your users are technical.`;

function getModel(provider: string) {
  if (provider === 'openai') {
    return openai('gpt-4o-mini');
  }
  return anthropic('claude-haiku-4-5-20251001');
}

export async function POST(req: Request) {
  const { messages, provider = 'anthropic' }: { messages: UIMessage[]; provider?: string } =
    await req.json();

  const result = streamText({
    model: getModel(provider),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
