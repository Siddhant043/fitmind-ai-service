import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { OllamaEmbeddings } from '@langchain/ollama'
import type { Embeddings } from '@langchain/core/embeddings'

export type EmbeddingProvider = 'gemini' | 'openai' | 'ollama'

const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  gemini: 'text-embedding-004',
  openai: 'text-embedding-3-small',
  ollama: 'embeddinggemma',
}

const EMBEDDING_CREDENTIAL_KEYS: Record<EmbeddingProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  ollama: '',
}

export function inferDefaultEmbeddingProvider(): EmbeddingProvider {
  const llmProvider = process.env.LLM_PRIMARY_PROVIDER ?? 'anthropic'
  return llmProvider === 'ollama' ? 'ollama' : 'gemini'
}

export function resolveEmbeddingProvider(): EmbeddingProvider {
  return (process.env.EMBEDDING_PROVIDER ?? inferDefaultEmbeddingProvider()) as EmbeddingProvider
}

function buildGeminiEmbeddings(model: string): Embeddings {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('EMBEDDING_PROVIDER="gemini" requires GEMINI_API_KEY to be set.')
  }
  return new GoogleGenerativeAIEmbeddings({ model, apiKey })
}

function buildOpenAIEmbeddings(model: string): Embeddings {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('EMBEDDING_PROVIDER="openai" requires OPENAI_API_KEY to be set.')
  }
  return new OpenAIEmbeddings({ model, apiKey })
}

function buildOllamaEmbeddings(model: string): Embeddings {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  // embeddinggemma outputs 768 dims natively; EMBEDDING_DIMENSIONS is used for Pinecone index setup
  return new OllamaEmbeddings({ model, baseUrl })
}

export function buildEmbeddings(): Embeddings {
  const provider = resolveEmbeddingProvider()
  const model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODELS[provider]

  switch (provider) {
    case 'gemini':
      return buildGeminiEmbeddings(model)
    case 'openai':
      return buildOpenAIEmbeddings(model)
    case 'ollama':
      return buildOllamaEmbeddings(model)
    default:
      throw new Error(`Unknown embedding provider: ${provider as string}`)
  }
}

export function getEmbeddingCredentialKey(provider: EmbeddingProvider): string {
  return EMBEDDING_CREDENTIAL_KEYS[provider]
}
