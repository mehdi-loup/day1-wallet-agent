import { createClient } from '@supabase/supabase-js';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import ws from 'ws';

type DepStatus = { ok: boolean; latencyMs: number; error?: string };

async function checkPostgres(): Promise<DepStatus> {
  const start = Date.now();
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient(url, key, { realtime: { transport: ws as any } });
    const { error } = await client.from('documents').select('id').limit(1);
    if (error) throw new Error(error.message);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkPgvector(): Promise<DepStatus> {
  const start = Date.now();
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient(url, key, { realtime: { transport: ws as any } });
    // Probe the vector search RPC with a zero embedding — we only care that the RPC
    // responds, not that it returns meaningful results.
    const { error } = await client.rpc('match_chunks', {
      query_embedding: JSON.stringify(new Array(1024).fill(0)),
      match_count: 1,
      min_similarity: 0.0,
    });
    if (error) throw new Error(error.message);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkAnthropic(): Promise<DepStatus> {
  const start = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt: 'Reply with the single word: ok',
      maxOutputTokens: 5,
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

function checkLangfuse(): DepStatus {
  // Langfuse is fire-and-forget — we can only verify the keys are present.
  // A missing key means traces are silently dropped; the agent still works.
  const start = Date.now();
  const missing = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'].filter((k) => !process.env[k]);
  return missing.length === 0
    ? { ok: true, latencyMs: Date.now() - start }
    : { ok: false, latencyMs: Date.now() - start, error: `Missing: ${missing.join(', ')}` };
}

export async function GET() {
  const [postgres, pgvector, anthropicDep] = await Promise.all([
    checkPostgres(),
    checkPgvector(),
    checkAnthropic(),
  ]);
  const langfuse = checkLangfuse();

  const deps = { postgres, pgvector, anthropic: anthropicDep, langfuse };
  const allOk = Object.values(deps).every((d) => d.ok);

  return Response.json(
    { status: allOk ? 'ok' : 'degraded', deps },
    { status: allOk ? 200 : 503 },
  );
}
