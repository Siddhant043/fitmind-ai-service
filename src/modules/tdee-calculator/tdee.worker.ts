import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base'
import { buildPrimaryModel, buildFallbackModel } from '../../providers/llm-provider.factory.js'
import { TDEE_SYSTEM_PROMPT, buildUserPrompt, tdeeOutputSchema } from './tdee.prompt.js'
import type { TdeeOutput } from './tdee.prompt.js'
import { calculateTdeeFallback } from './tdee.fallback.js'

const LLM_TIMEOUT_MS = 20_000

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

type StructuredOutputModel = {
  invoke: (input: BaseLanguageModelInput) => Promise<unknown>
}

async function invokeWithTimeout(
  model: StructuredOutputModel,
  messages: BaseMessage[],
): Promise<TdeeOutput> {
  return Promise.race([
    model.invoke(messages) as Promise<TdeeOutput>,
    new Promise<TdeeOutput>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM request timed out after ${LLM_TIMEOUT_MS / 1000}s`)),
        LLM_TIMEOUT_MS,
      )
    }),
  ])
}

async function resolveTdeeResult(
  payload: TdeeCalculationRequest,
  primary: StructuredOutputModel,
  fallback: StructuredOutputModel | null,
  messages: BaseMessage[],
): Promise<{ result: TdeeOutput; usedFallback: boolean }> {
  try {
    return { result: await invokeWithTimeout(primary, messages), usedFallback: false }
  } catch (primaryErr) {
    if (fallback) {
      try {
        console.warn(
          '[TDEE] Primary model failed, retrying with fallback:',
          (primaryErr as Error).message,
        )
        return { result: await invokeWithTimeout(fallback, messages), usedFallback: false }
      } catch (fallbackErr) {
        console.warn('[TDEE] Fallback model failed, using formula:', (fallbackErr as Error).message)
      }
    } else {
      console.warn('[TDEE] LLM failed, using formula:', (primaryErr as Error).message)
    }
  }

  return { result: calculateTdeeFallback(payload), usedFallback: true }
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
    const messages: BaseMessage[] = [
      new SystemMessage(TDEE_SYSTEM_PROMPT),
      new HumanMessage(buildUserPrompt(payload)),
    ]

    try {
      const { result } = await resolveTdeeResult(payload, primary, fallback, messages)

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
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[TDEE] Calculation failed:', errorMessage)

      const failMsg = buildResultMessage(
        payload.requestId,
        payload.userId,
        'failed',
        null,
        errorMessage,
        correlationId,
      )
      channel.publish('fitmind.direct', 'tdee.result', failMsg, { persistent: true })
      channel.ack(msg)
    }
  })
}
