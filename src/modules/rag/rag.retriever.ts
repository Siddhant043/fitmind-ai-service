import crypto from 'crypto'
import { CohereClient } from 'cohere-ai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildEmbeddings } from '../../providers/embedding-provider.factory.js'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { getIndex } from './rag.client.js'
import type { RagNamespace } from './rag.client.js'
import type { Redis } from 'ioredis'

const RAG_CACHE_TTL = 21600 // 6 hours
const TOP_K = 20
const RERANK_TOP_N = 5

const embeddings = buildEmbeddings()

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

function parseLines(text: string, max: number): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max)
}

const MAX_SUB_QUERIES = 3

async function decomposeQuery(query: string): Promise<string[]> {
  const model = buildPrimaryModel('fast')
  const response = await model.invoke([
    new SystemMessage(
      `Break the following fitness/nutrition question down into up to ${MAX_SUB_QUERIES} distinct sub-questions, each answerable independently from a knowledge base. Return only the sub-questions, one per line, no numbering. If the question is already single-focus, return it unchanged as the only line.`,
    ),
    new HumanMessage(query),
  ])
  const text = typeof response.content === 'string' ? response.content : ''
  const subQueries = parseLines(text, MAX_SUB_QUERIES)
  return subQueries.length > 0 ? subQueries : [query]
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
  const variants = parseLines(text, 2)
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

function mergeCandidatesByHighestScore(
  allSearches: Array<Array<{ text: string; score: number }>>,
): string[] {
  const candidateScores = new Map<string, number>()

  for (const results of allSearches) {
    for (const result of results) {
      if (!result.text) continue
      const existingScore = candidateScores.get(result.text) ?? -Infinity
      if (result.score > existingScore) {
        candidateScores.set(result.text, result.score)
      }
    }
  }

  return [...candidateScores.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text)
}

async function rerankCandidates(query: string, candidates: string[]): Promise<string[]> {
  const cohereApiKey = process.env.COHERE_API_KEY
  if (!cohereApiKey) {
    return candidates.slice(0, RERANK_TOP_N)
  }

  const cohere = new CohereClient({ token: cohereApiKey })
  const rerankResult = await cohere.rerank({
    model: 'rerank-english-v3.0',
    query,
    documents: candidates,
    topN: RERANK_TOP_N,
  })

  return rerankResult.results
    .sort((a, b) => a.index - b.index)
    .map((r) => candidates[r.index]!)
    .filter(Boolean)
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

  const allSearches = await Promise.all([
    embedAndSearch(hydeAnswer, namespace),
    ...queryVariants.map((v) => embedAndSearch(v, namespace)),
  ])

  const candidates = mergeCandidatesByHighestScore(allSearches)
  if (candidates.length === 0) return []

  const topPassages = await rerankCandidates(query, candidates)

  await redis.set(cacheKey, JSON.stringify(topPassages), 'EX', RAG_CACHE_TTL)
  return topPassages
}

function mergeRankedResultsByBestRank(resultLists: string[][]): string[] {
  const bestRank = new Map<string, number>()

  for (const results of resultLists) {
    results.forEach((text, rank) => {
      const existing = bestRank.get(text)
      if (existing === undefined || rank < existing) {
        bestRank.set(text, rank)
      }
    })
  }

  return [...bestRank.entries()].sort((a, b) => a[1] - b[1]).map(([text]) => text)
}

export async function retrieveMultiHopWithRerank(
  query: string,
  namespace: RagNamespace,
  redis: Redis,
): Promise<string[]> {
  const subQueries = await decomposeQuery(query)
  const resultLists = await Promise.all(
    subQueries.map((subQuery) => retrieveWithRerank(subQuery, namespace, redis)),
  )
  return mergeRankedResultsByBestRank(resultLists).slice(0, RERANK_TOP_N)
}
