import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { WeeklyRecapRequest, WeeklyRecapResult } from './weekly-recap.types.js'
import { generateWeeklyRecapNarrative } from './weekly-recap.graph.js'
import { buildWeeklyRecapFallback } from './weekly-recap.prompt.js'

function publishResult(channel: Channel, result: WeeklyRecapResult, correlationId: string): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'weekly.recap.result',
    payload: result,
    metadata: {
      userId: result.userId,
      traceId: randomUUID(),
    },
  }

  channel.publish('fitmind.direct', 'recap.result', Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
  })
}

export function startWeeklyRecapWorker(channel: Channel): void {
  channel.prefetch(2)

  channel.consume('weekly.recap.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: { payload: WeeklyRecapRequest; correlationId: string }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const { recapId, userId, stats } = payload

    try {
      const coachNarrative = await generateWeeklyRecapNarrative(stats)

      publishResult(
        channel,
        {
          recapId,
          userId,
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
            recapId,
            userId,
            status: 'failed',
            coachNarrative: buildWeeklyRecapFallback(stats),
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
