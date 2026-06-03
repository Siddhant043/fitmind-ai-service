import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildPrimaryModel, buildFallbackModel } from '../../providers/llm-provider.factory.js'
import { TDEE_SYSTEM_PROMPT, buildUserPrompt, tdeeOutputSchema } from './tdee.prompt.js'
import type { TdeeOutput } from './tdee.prompt.js'

interface TdeeCalculationRequest {
  requestId: string
  userId: string
  sex: string
  weightKg: number
  heightCm: number
  ageYears: number
  activityLevel: string
  goal: string
  dietaryPref: string | null
}

function buildResultMessage(
  requestId: string,
  userId: string,
  status: 'completed' | 'failed',
  result: TdeeOutput | null,
  errorMessage: string | null,
  correlationId: string,
): Buffer {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'tdee.calculation.result',
    payload: { requestId, userId, status, result, errorMessage },
    metadata: { userId, traceId: randomUUID() },
  }
  return Buffer.from(JSON.stringify(envelope))
}

export function startTdeeWorker(channel: Channel) {
  const primary = buildPrimaryModel('fast').withStructuredOutput(tdeeOutputSchema, {
    name: 'set_tdee_and_macros',
    method: 'functionCalling',
  })
  const fallbackBase = buildFallbackModel('fast')
  const fallback = fallbackBase
    ? fallbackBase.withStructuredOutput(tdeeOutputSchema, {
        name: 'set_tdee_and_macros',
        method: 'functionCalling',
      })
    : null

  channel.prefetch(3)

  channel.consume('tdee.calculation.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: {
      payload: TdeeCalculationRequest
      correlationId: string
      metadata: { traceId: string }
    }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const messages = [
      new SystemMessage(TDEE_SYSTEM_PROMPT),
      new HumanMessage(buildUserPrompt(payload)),
    ]

    try {
      let result: TdeeOutput
      try {
        result = (await primary.invoke(messages)) as TdeeOutput
      } catch (primaryErr) {
        if (!fallback) throw primaryErr
        console.warn(
          '[TDEE] Primary model failed, retrying with fallback:',
          (primaryErr as Error).message,
        )
        result = (await fallback.invoke(messages)) as TdeeOutput
      }

      const resultMsg = buildResultMessage(
        payload.requestId,
        payload.userId,
        'completed',
        result,
        null,
        correlationId,
      )
      channel.publish('fitmind.direct', 'tdee.result', resultMsg, { persistent: true })
      channel.ack(msg)
    } catch (err) {
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      if (retryCount < 3) {
        channel.nack(msg, false, false)
      } else {
        const failMsg = buildResultMessage(
          payload.requestId,
          payload.userId,
          'failed',
          null,
          errorMessage,
          correlationId,
        )
        channel.publish('fitmind.direct', 'tdee.result', failMsg, { persistent: true })
        channel.nack(msg, false, false)
      }
    }
  })
}
