import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import { planAdvisorGraph } from './plan-advisor.graph.js'
import type { PlanAnalysisTrigger, PlanSuggestionResult } from './plan-advisor.types.js'

function publishFailure(
  channel: Channel,
  userId: string,
  error: string,
  correlationId: string,
): void {
  const result: PlanSuggestionResult = {
    userId,
    suggestionType: 'goal',
    content: '',
    reasoning: '',
    dataSnapshot: {},
    status: 'failed',
    errorMessage: error,
  }
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'plan.suggestion.result',
    payload: result,
    metadata: { userId, traceId: randomUUID() },
  }
  channel.publish('fitmind.direct', 'plan.result', Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
  })
}

export function startPlanAdvisorWorker(channel: Channel, redis: Redis): void {
  channel.prefetch(2)

  channel.consume('plan.analysis.trigger', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: { payload: PlanAnalysisTrigger; correlationId: string }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const { userId, triggerReason, userContextBundle } = payload

    try {
      await planAdvisorGraph.invoke({
        userId,
        triggerReason,
        userContext: userContextBundle ?? null,
        redis,
        channel,
        correlationId: correlationId ?? randomUUID(),
      })

      channel.ack(msg)
    } catch (err) {
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      if (retryCount >= 3) {
        publishFailure(channel, userId, errorMessage, correlationId ?? randomUUID())
        channel.nack(msg, false, false)
      } else {
        channel.nack(msg, false, false)
      }
    }
  })
}
