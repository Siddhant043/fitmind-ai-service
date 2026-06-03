import { randomUUID } from 'crypto'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { getIndex } from './rag.client.js'
import type { RagNamespace } from './rag.client.js'
import type { Channel, ConsumeMessage } from 'amqplib'

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: 'text-embedding-004',
  apiKey: process.env.GEMINI_API_KEY,
})

function splitText(text: string, chunkSize = 500, overlap = 100): string[] {
  const separators = ['\n\n', '\n', '. ', ' ', '']
  for (const sep of separators) {
    const parts = sep ? text.split(sep) : text.split('')
    if (parts.length <= 1 && sep !== '') continue
    const chunks: string[] = []
    let current = ''
    for (const part of parts) {
      const piece = current ? current + sep + part : part
      if (piece.length > chunkSize && current) {
        chunks.push(current)
        current = current.slice(-overlap) + (current.length > overlap ? sep : '') + part
      } else {
        current = piece
      }
    }
    if (current) chunks.push(current)
    if (chunks.length > 1 || text.length <= chunkSize) return chunks.filter((c) => c.trim())
  }
  return [text]
}

export async function indexDocument(
  text: string,
  namespace: RagNamespace,
  metadata: Record<string, string> = {},
): Promise<void> {
  const chunks = splitText(text)
  const vectors = await embeddings.embedDocuments(chunks)

  const records = chunks.map((chunk, i) => ({
    id: randomUUID(),
    values: vectors[i]!,
    metadata: { text: chunk, namespace, ...metadata },
  }))

  const index = getIndex()
  await index.namespace(namespace).upsert(records)
}

interface RagIndexJob {
  text: string
  namespace: RagNamespace
  metadata?: Record<string, string>
}

export function startRagIndexWorker(channel: Channel) {
  channel.prefetch(2)
  channel.consume('rag-index', async (msg: ConsumeMessage | null) => {
    if (!msg) return
    let job: RagIndexJob
    try {
      job = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }
    try {
      await indexDocument(job.text, job.namespace, job.metadata)
      channel.ack(msg)
    } catch (err) {
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      if (retryCount < 3) {
        channel.nack(msg, false, false)
      } else {
        console.error('[RAG] Indexing failed after 3 retries:', err)
        channel.nack(msg, false, false)
      }
    }
  })
}
