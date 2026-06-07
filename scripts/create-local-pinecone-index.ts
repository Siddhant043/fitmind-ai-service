/**
 * Creates the local 768-dimension Pinecone index for Ollama embeddinggemma dev.
 *
 * Usage (from ai-service/):
 *   node --env-file=.env --import=tsx/esm scripts/create-local-pinecone-index.ts
 *
 * Requires PINECONE_API_KEY in .env. Index name defaults to fitmind-knowledge-local;
 * override with PINECONE_INDEX_NAME.
 */
import { Pinecone } from '@pinecone-database/pinecone'

const INDEX_NAME = process.env.PINECONE_INDEX_NAME ?? 'fitmind-knowledge-local'
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? 768)

async function createLocalIndex(): Promise<void> {
  const apiKey = process.env.PINECONE_API_KEY
  if (!apiKey) {
    console.error('PINECONE_API_KEY is required')
    process.exit(1)
  }

  const pinecone = new Pinecone({ apiKey })
  const existingIndexes = await pinecone.listIndexes()
  const indexNames = existingIndexes.indexes?.map((index) => index.name) ?? []

  if (indexNames.includes(INDEX_NAME)) {
    console.log(`Index "${INDEX_NAME}" already exists — skipping creation.`)
    console.log('Re-index knowledge via rag-index queue before running retrieval locally.')
    return
  }

  await pinecone.createIndex({
    name: INDEX_NAME,
    dimension: DIMENSIONS,
    metric: 'cosine',
    spec: {
      serverless: {
        cloud: 'aws',
        region: 'us-east-1',
      },
    },
    waitUntilReady: true,
  })

  console.log(`Created Pinecone index "${INDEX_NAME}" (${DIMENSIONS} dims, cosine metric).`)
  console.log('Next: publish rag-index jobs to populate the index with embeddinggemma vectors.')
}

createLocalIndex().catch((err: unknown) => {
  console.error('Failed to create Pinecone index:', err)
  process.exit(1)
})
