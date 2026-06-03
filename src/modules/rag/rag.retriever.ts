import crypto from 'crypto'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { CohereClient } from 'cohere-ai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { getIndex } from './rag.client.js'
import type { RagNamespace } from './rag.client.js'
import type { Redis } from 'ioredis'

const RAG_CACHE_TTL = 21600 // 6 hours
const TOP_K = 20
const RERANK_TOP_N = 5

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: 'text-embedding-004',
  apiKey: process.env.GEMINI_API_KEY,
})

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY })

async function generateHyDE(query: string): Promise<string> {
  const model = buildPrimaryModel('fast')
  const response = await model.invoke([
    new SystemMessage(
      'You are a fitness and nutrition expert. Write a concise, factual answer to the following question as if it appeared in an expert knowledge base.',
    ),
    new HumanMessage(query),
  ])
  return typeof response.content === 'string' ? response.content : query
}

async function generateQueryVariants(query: string): Promise<string[]> {
  const model = buildPrimaryModel('fast')
  const response = await model.invoke([
    new SystemMessage(
      'Generate 2 alternative phrasings of the following fitness/nutrition question. Return only the questions, one per line, no numbering.',
    ),
    new HumanMessage(query),
  ])
  const text = typeof response.content === 'string' ? response.content : ''
  const variants = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
  return [query, ...variants]
}

async function embedAndSearch(
  text: string,
  namespace: RagNamespace,
): Promise<Array<{ text: string; score: number }>> {
  const vector = await embeddings.embedQuery(text)
  const index = getIndex()
  const result = await index.namespace(namespace).query({
    vector,
    topK: TOP_K,
    includeMetadata: true,
  })
  return (result.matches ?? []).map((m) => ({
    text: (m.metadata?.text as string) ?? '',
    score: m.score ?? 0,
  }))
}

export async function retrieveWithRerank(
  query: string,
  namespace: RagNamespace,
  redis: Redis,
): Promise<string[]> {
  const cacheKey = `rag_result:${crypto.createHash('sha256').update(`${namespace}:${query}`).digest('hex')}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as string[]
    } catch {}
  }

  const [hydeAnswer, queryVariants] = await Promise.all([
    generateHyDE(query),
    generateQueryVariants(query),
  ])

  // Retrieve from all variants + HyDE in parallel, union-merge deduplicated by text
  const allSearches = await Promise.all([
    embedAndSearch(hydeAnswer, namespace),
    ...queryVariants.map((v) => embedAndSearch(v, namespace)),
  ])

  const seen = new Set<string>()
  const candidates: string[] = []
  for (const results of allSearches) {
    for (const r of results) {
      if (r.text && !seen.has(r.text)) {
        seen.add(r.text)
        candidates.push(r.text)
      }
    }
  }

  if (candidates.length === 0) return []

  // Cohere rerank
  const rerankResult = await cohere.rerank({
    model: 'rerank-english-v3.0',
    query,
    documents: candidates,
    topN: RERANK_TOP_N,
  })

  const topPassages = rerankResult.results
    .sort((a, b) => a.index - b.index)
    .map((r) => candidates[r.index]!)
    .filter(Boolean)

  await redis.set(cacheKey, JSON.stringify(topPassages), 'EX', RAG_CACHE_TTL)
  return topPassages
}
