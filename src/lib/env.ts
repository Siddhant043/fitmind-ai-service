import { z } from 'zod'
import {
  getEmbeddingCredentialKey,
  resolveEmbeddingProvider,
} from '../providers/embedding-provider.factory.js'

const PROVIDER_CREDENTIAL_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: '', // no API key needed for local Ollama
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  RABBITMQ_URL: z.string().min(1),
  LLM_PRIMARY_PROVIDER: z.enum(['anthropic', 'openai', 'gemini', 'ollama']).default('anthropic'),
  LLM_FALLBACK_PROVIDER: z.enum(['anthropic', 'openai', 'gemini', 'ollama']).optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  EMBEDDING_PROVIDER: z.enum(['gemini', 'openai', 'ollama']).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().optional(),
})

export function validateEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('[env] Invalid environment variables:')
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }

  const env = parsed.data
  const primaryCredKey = PROVIDER_CREDENTIAL_KEYS[env.LLM_PRIMARY_PROVIDER]
  if (primaryCredKey && !process.env[primaryCredKey]) {
    console.error(
      `[env] LLM_PRIMARY_PROVIDER="${env.LLM_PRIMARY_PROVIDER}" requires ${primaryCredKey} to be set. Exiting.`,
    )
    process.exit(1)
  }

  if (env.LLM_FALLBACK_PROVIDER) {
    const fallbackCredKey = PROVIDER_CREDENTIAL_KEYS[env.LLM_FALLBACK_PROVIDER]
    if (fallbackCredKey && !process.env[fallbackCredKey]) {
      console.warn(
        `[env] LLM_FALLBACK_PROVIDER="${env.LLM_FALLBACK_PROVIDER}" requires ${fallbackCredKey} but it is not set. Fallback disabled.`,
      )
      delete process.env.LLM_FALLBACK_PROVIDER
    }
  }

  const embeddingProvider = resolveEmbeddingProvider()
  const embeddingCredKey = getEmbeddingCredentialKey(embeddingProvider)
  if (embeddingCredKey && !process.env[embeddingCredKey]) {
    console.error(
      `[env] EMBEDDING_PROVIDER="${embeddingProvider}" requires ${embeddingCredKey} to be set. Exiting.`,
    )
    process.exit(1)
  }

  return env
}
