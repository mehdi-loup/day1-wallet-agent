const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
] as const

type RequiredKey = (typeof REQUIRED)[number]

function validate() {
  const missing = REQUIRED.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
        'Copy .env.example to .env.local and fill in all values.',
    )
  }
  return process.env as Record<RequiredKey, string> & NodeJS.ProcessEnv
}

// Throws at import time if any required secret is absent.
// Turso and Zapper are intentionally excluded — both have graceful fallbacks.
export const env = validate()
