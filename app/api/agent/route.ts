import { z } from 'zod';
import { mastra, observability } from '@/src/mastra';

const RequestSchema = z.object({
  message: z.string().min(1),
  threadId: z.string().min(1),
  resourceId: z.string().optional().default('api-user'),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { message, threadId, resourceId } = parsed.data;

  try {
    const agent = mastra.getAgent('portfolioAgent');
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { memory: { thread: threadId, resource: resourceId } },
    );

    // Flush spans to Langfuse before the serverless function can exit.
    // Without this, OTEL's batch timer may not fire before the Lambda is recycled.
    await observability.shutdown?.();

    return Response.json({ text: result.text, threadId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent error';
    return Response.json({ error: message }, { status: 500 });
  }
}
