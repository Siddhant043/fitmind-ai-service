import { Pinecone } from '@pinecone-database/pinecone'

let _pinecone: Pinecone | null = null

export function getPineconeClient(): Pinecone {
  if (!_pinecone) {
    const apiKey = process.env.PINECONE_API_KEY
    if (!apiKey) throw new Error('PINECONE_API_KEY is required')
    _pinecone = new Pinecone({ apiKey })
  }
  return _pinecone
}

export function getIndex() {
  const indexName = process.env.PINECONE_INDEX_NAME ?? 'fitmind-knowledge'
  return getPineconeClient().index(indexName)
}

export type RagNamespace = 'fitness-knowledge' | 'nutrition-knowledge'
