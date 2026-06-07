import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@langchain/google-genai', () => ({
  GoogleGenerativeAIEmbeddings: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'gemini', ...(opts as object) })),
}))

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'openai', ...(opts as object) })),
}))

vi.mock('@langchain/ollama', () => ({
  OllamaEmbeddings: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'ollama', ...(opts as object) })),
}))

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { OllamaEmbeddings } from '@langchain/ollama'
import {
  buildEmbeddings,
  inferDefaultEmbeddingProvider,
  resolveEmbeddingProvider,
} from '../embedding-provider.factory.js'

const MockGoogleGenerativeAIEmbeddings = vi.mocked(GoogleGenerativeAIEmbeddings)
const MockOpenAIEmbeddings = vi.mocked(OpenAIEmbeddings)
const MockOllamaEmbeddings = vi.mocked(OllamaEmbeddings)

const SAVED_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.LLM_PRIMARY_PROVIDER
  delete process.env.EMBEDDING_PROVIDER
  delete process.env.EMBEDDING_MODEL
  delete process.env.EMBEDDING_DIMENSIONS
  delete process.env.OLLAMA_BASE_URL
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENAI_API_KEY
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.OPENAI_API_KEY = 'test-openai-key'
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
})

describe('inferDefaultEmbeddingProvider', () => {
  it('returns ollama when LLM_PRIMARY_PROVIDER=ollama', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'ollama'
    expect(inferDefaultEmbeddingProvider()).toBe('ollama')
  })

  it('returns gemini for non-ollama LLM providers', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'anthropic'
    expect(inferDefaultEmbeddingProvider()).toBe('gemini')
  })
})

describe('resolveEmbeddingProvider', () => {
  it('uses EMBEDDING_PROVIDER when explicitly set', () => {
    process.env.EMBEDDING_PROVIDER = 'openai'
    expect(resolveEmbeddingProvider()).toBe('openai')
  })

  it('infers from LLM_PRIMARY_PROVIDER when EMBEDDING_PROVIDER is unset', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'ollama'
    expect(resolveEmbeddingProvider()).toBe('ollama')
  })
})

describe('buildEmbeddings', () => {
  it('constructs GoogleGenerativeAIEmbeddings by default', () => {
    buildEmbeddings()
    expect(MockGoogleGenerativeAIEmbeddings).toHaveBeenCalledOnce()
    const opts = MockGoogleGenerativeAIEmbeddings.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('text-embedding-004')
    expect((opts as { apiKey: string }).apiKey).toBe('test-gemini-key')
  })

  it('constructs OllamaEmbeddings when EMBEDDING_PROVIDER=ollama', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama'
    buildEmbeddings()
    expect(MockOllamaEmbeddings).toHaveBeenCalledOnce()
    const opts = MockOllamaEmbeddings.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('embeddinggemma')
    expect((opts as { baseUrl: string }).baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('constructs OpenAIEmbeddings when EMBEDDING_PROVIDER=openai', () => {
    process.env.EMBEDDING_PROVIDER = 'openai'
    buildEmbeddings()
    expect(MockOpenAIEmbeddings).toHaveBeenCalledOnce()
    const opts = MockOpenAIEmbeddings.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('text-embedding-3-small')
  })

  it('respects EMBEDDING_MODEL env override', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama'
    process.env.EMBEDDING_MODEL = 'custom-embed-model'
    buildEmbeddings()
    const opts = MockOllamaEmbeddings.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('custom-embed-model')
  })

  it('auto-selects ollama embeddings when LLM_PRIMARY_PROVIDER=ollama', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'ollama'
    buildEmbeddings()
    expect(MockOllamaEmbeddings).toHaveBeenCalledOnce()
  })

  it('throws when gemini provider is selected without GEMINI_API_KEY', () => {
    delete process.env.GEMINI_API_KEY
    process.env.EMBEDDING_PROVIDER = 'gemini'
    expect(() => buildEmbeddings()).toThrow('GEMINI_API_KEY')
  })
})
