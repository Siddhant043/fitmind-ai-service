import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import type {
  ChallengeSuggestionRequest,
  ChallengeSuggestionResult,
} from './challenge-suggester.types.js'
import { generateChallengeSuggestion } from './challenge-suggester.graph.js'
import { buildUserContext } from '../context-builder/context-builder.js'

function publishResult(
  channel: Channel,
  result: ChallengeSuggestionResult,
  correlationId: string,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'challenge.suggestion.result',
    payload: result,
    metadata: {
      userId: result.userId,
      traceId: randomUUID(),
    },
  }

  channel.publish(
    'fitmind.direct',
    'challenge.suggestion.result',
    Buffer.from(JSON.stringify(envelope)),
    { persistent: true },
  )
}

export function startChallengeSuggesterWorker(channel: Channel, redis: Redis): void {
  channel.prefetch(2)

  channel.consume('challenge.suggestion.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: { payload: ChallengeSuggestionRequest; correlationId: string }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const { userId } = payload

    try {
      const userContext = await buildUserContext(userId, redis)
      const suggestion = await generateChallengeSuggestion(payload, userContext)

      publishResult(
        channel,
        {
          userId,
          status: 'completed',
          title: suggestion.title,
          description: suggestion.description,
          criteriaJson: suggestion.criteriaJson,
          durationDays: suggestion.durationDays,
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
            status: 'failed',
            title: '',
            description: '',
            criteriaJson: {
              operator: 'AND',
              rules: [{ type: 'workout_count', window_days: 7, min: 2 }],
            },
            durationDays: 7,
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
