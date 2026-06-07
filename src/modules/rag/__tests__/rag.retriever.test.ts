import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Redis } from 'ioredis'

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockEmbedQuery, mockNamespaceQuery, mockRerank } = vi.hoisted(() => ({
  mockEmbedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  mockNamespaceQuery: vi.fn().mockResolvedValue({
    matches: [
      { metadata: { text: 'doc-fitness-1' }, score: 0.95 },
      { metadata: { text: 'doc-fitness-2' }, score: 0.88 },
    ],
  }),
  mockRerank: vi.fn().mockResolvedValue({
    results: [
      { index: 0, relevanceScore: 0.95 },
      { index: 1, relevanceScore: 0.88 },
    ],
  }),
}))

vi.mock('../../../providers/embedding-provider.factory.js', () => ({
  buildEmbeddings: vi.fn().mockReturnValue({
    embedQuery: mockEmbedQuery,
  }),
}))

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    rerank: mockRerank,
  })),
}))

vi.mock('../rag.client.js', () => ({
  getIndex: vi.fn().mockReturnValue({
    namespace: vi.fn().mockReturnValue({ query: mockNamespaceQuery }),
  }),
}))

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({ content: 'hypothetical document answer' }),
  }),
  buildFallbackModel: vi.fn().mockReturnValue(null),
}))

import { retrieveWithRerank } from '../rag.retriever.js'
import { getIndex } from '../rag.client.js'

const SAVED_ENV = { ...process.env }

// ── helpers ───────────────────────────────────────────────────────────────────

function buildMockRedis(cacheValue: string | null = null) {
  const store = new Map<string, string>()
  if (cacheValue !== null) store.set('__preset__', cacheValue)
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  } as unknown as Redis
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.COHERE_API_KEY = 'test-cohere-key'
  mockEmbedQuery.mockResolvedValue([0.1, 0.2, 0.3])
  mockNamespaceQuery.mockResolvedValue({
    matches: [
      { metadata: { text: 'doc-fitness-1' }, score: 0.95 },
      { metadata: { text: 'doc-fitness-2' }, score: 0.88 },
    ],
  })
  mockRerank.mockResolvedValue({
    results: [
      { index: 0, relevanceScore: 0.95 },
      { index: 1, relevanceScore: 0.88 },
    ],
  })
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('retrieveWithRerank — cache hit', () => {
  it('returns cached docs and skips Pinecone when cache hit', async () => {
    const cached = JSON.stringify(['cached-doc-1', 'cached-doc-2'])
    const redis = buildMockRedis()
    redis.get = vi.fn().mockResolvedValue(cached)

    const result = await retrieveWithRerank('how to build muscle', 'fitness-knowledge', redis)

    expect(result).toEqual(['cached-doc-1', 'cached-doc-2'])
    expect(getIndex).not.toHaveBeenCalled()
    expect(mockRerank).not.toHaveBeenCalled()
  })

  it('falls through to Pinecone when cached value is malformed JSON', async () => {
    const redis = buildMockRedis()
    redis.get = vi.fn().mockResolvedValue('{ not json }}}')

    await retrieveWithRerank('squat form tips', 'fitness-knowledge', redis)

    expect(mockEmbedQuery).toHaveBeenCalled()
  })
})

describe('retrieveWithRerank — cache miss', () => {
  it('calls embedQuery for each query variant', async () => {
    const redis = buildMockRedis()
    await retrieveWithRerank('protein intake for vegetarians', 'nutrition-knowledge', redis)
    expect(mockEmbedQuery).toHaveBeenCalled()
  })

  it('calls Pinecone namespace query', async () => {
    const redis = buildMockRedis()
    await retrieveWithRerank('progressive overload', 'fitness-knowledge', redis)
    expect(mockNamespaceQuery).toHaveBeenCalled()
  })

  it('calls Cohere rerank when COHERE_API_KEY is set and candidates are found', async () => {
    process.env.COHERE_API_KEY = 'test-cohere-key'
    const redis = buildMockRedis()
    await retrieveWithRerank('rest day recovery', 'fitness-knowledge', redis)
    expect(mockRerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'rest day recovery', topN: 5 }),
    )
  })

  it('skips Cohere and uses Pinecone scores when COHERE_API_KEY is missing', async () => {
    delete process.env.COHERE_API_KEY
    const redis = buildMockRedis()
    const result = await retrieveWithRerank('rest day recovery', 'fitness-knowledge', redis)
    expect(mockRerank).not.toHaveBeenCalled()
    expect(result).toEqual(['doc-fitness-1', 'doc-fitness-2'])
  })

  it('writes results to Redis with 6h TTL (21600 seconds)', async () => {
    const redis = buildMockRedis()
    await retrieveWithRerank('HIIT cardio benefits', 'fitness-knowledge', redis)
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('rag_result:'),
      expect.any(String),
      'EX',
      21600,
    )
  })

  it('returns empty array and skips Cohere when Pinecone returns no matches', async () => {
    mockNamespaceQuery.mockResolvedValue({ matches: [] })
    const redis = buildMockRedis()
    const result = await retrieveWithRerank('obscure query', 'fitness-knowledge', redis)
    expect(result).toEqual([])
    expect(mockRerank).not.toHaveBeenCalled()
  })
})
