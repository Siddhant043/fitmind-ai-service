import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import type {
  ChapterCelebrationRequest,
  ChapterCelebrationResult,
} from './chapter-celebration.types.js'
import { generateChapterCelebrationNarrative } from './chapter-celebration.graph.js'
import { buildChapterCelebrationFallback } from './chapter-celebration.prompt.js'
import { buildUserContext } from '../context-builder/context-builder.js'

function publishResult(
  channel: Channel,
  result: ChapterCelebrationResult,
  correlationId: string,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chapter.celebration.result',
    payload: result,
    metadata: {
      userId: result.userId,
      traceId: randomUUID(),
    },
  }

  channel.publish(
    'fitmind.direct',
    'chapter.celebration.result',
    Buffer.from(JSON.stringify(envelope)),
    { persistent: true },
  )
}

export function startChapterCelebrationWorker(channel: Channel, redis: Redis): void {
  channel.prefetch(2)

  channel.consume('chapter.celebration.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: { payload: ChapterCelebrationRequest; correlationId: string }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const { userId, arcId, chapterIndex } = payload

    try {
      const userContext = await buildUserContext(userId, redis)
      const coachNarrative = await generateChapterCelebrationNarrative(payload, userContext)

      publishResult(
        channel,
        {
          userId,
          arcId,
          chapterIndex,
          status: 'completed',
          coachNarrative,
          errorMessage: null,
        },
        correlationId ?? randomUUID(),
      )

      channel.ack(msg)
    } catch (err) {
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      if (retryCount >= 3) {
        publishResult(
          channel,
          {
            userId,
            arcId,
            chapterIndex,
            status: 'failed',
            coachNarrative: buildChapterCelebrationFallback(payload),
            errorMessage,
          },
          correlationId ?? randomUUID(),
        )
        channel.nack(msg, false, false)
      } else {
        channel.nack(msg, false, false)
      }
    }
  })
}
