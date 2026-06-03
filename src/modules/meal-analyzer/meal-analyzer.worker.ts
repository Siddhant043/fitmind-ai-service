import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildPrimaryModel, buildFallbackModel } from '../../providers/llm-provider.factory.js'
import { MEAL_ANALYZER_SYSTEM_PROMPT, mealAnalyzerOutputSchema } from './meal-analyzer.prompt.js'
import type { MealAnalyzerOutput } from './meal-analyzer.prompt.js'

interface MealAnalysisRequest {
  mealId: string
  userId: string
  imageUrl: string | null
  imageHash: string | null
  description: string | null
  mealType: string
  isPro: boolean
  traceId: string
}

function buildResultMessage(
  mealId: string,
  userId: string,
  status: 'completed' | 'failed',
  result: MealAnalyzerOutput | null,
  errorMessage: string | null,
  correlationId: string,
): Buffer {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'meal.analysis.result',
    payload: {
      mealId,
      userId,
      status,
      confidence: result ? result.confidence : null,
      macros: result ? result.macros : null,
      aiRawResponse: result ? (result as unknown as Record<string, unknown>) : null,
      errorMessage,
    },
    metadata: { userId, traceId: randomUUID() },
  }
  return Buffer.from(JSON.stringify(envelope))
}

export function startMealAnalyzerWorker(channel: Channel) {
  const primaryModel = buildPrimaryModel('vision').withStructuredOutput(mealAnalyzerOutputSchema, {
    name: 'analyze_meal_nutrition',
    method: 'functionCalling',
  })
  const fallbackBase = buildFallbackModel('fast')
  const fallbackModel = fallbackBase
    ? fallbackBase.withStructuredOutput(mealAnalyzerOutputSchema, {
        name: 'analyze_meal_nutrition',
        method: 'functionCalling',
      })
    : null

  channel.prefetch(3)

  channel.consume('meal.analysis.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: {
      payload: MealAnalysisRequest
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
    const { mealId, userId, imageUrl, description } = payload

    try {
      const humanMessageContent: any[] = []

      if (description) {
        humanMessageContent.push({
          type: 'text',
          text: `Meal Description: ${description}`,
        })
      }

      if (imageUrl) {
        // Fetch the image to send as base64 to Claude
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image from URL: ${imageUrl}. Status: ${response.statusText}`,
          )
        }
        const arrayBuffer = await response.arrayBuffer()
        const base64Image = Buffer.from(arrayBuffer).toString('base64')
        const contentType = response.headers.get('content-type') || 'image/jpeg'

        humanMessageContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${contentType};base64,${base64Image}`,
          },
        })
      }

      // If neither is provided, add a default fallback text
      if (humanMessageContent.length === 0) {
        humanMessageContent.push({
          type: 'text',
          text: 'No description or image provided for this meal.',
        })
      }

      let result: MealAnalyzerOutput
      try {
        result = (await primaryModel.invoke([
          new SystemMessage(MEAL_ANALYZER_SYSTEM_PROMPT),
          new HumanMessage({ content: humanMessageContent }),
        ])) as MealAnalyzerOutput
      } catch (primaryErr) {
        if (!fallbackModel) throw primaryErr
        console.warn(`[MealAnalyzer] Primary model failed, retrying with fallback:`, primaryErr)
        result = (await fallbackModel.invoke([
          new SystemMessage(MEAL_ANALYZER_SYSTEM_PROMPT),
          new HumanMessage({ content: humanMessageContent }),
        ])) as MealAnalyzerOutput
      }

      const resultMsg = buildResultMessage(mealId, userId, 'completed', result, null, correlationId)

      channel.publish('fitmind.direct', 'meal.result', resultMsg, { persistent: true })
      channel.ack(msg)
    } catch (err) {
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[MealAnalyzer] Error processing meal analysis (retry: ${retryCount}):`, err)

      if (retryCount < 3) {
        channel.nack(msg, false, false)
      } else {
        const failMsg = buildResultMessage(
          mealId,
          userId,
          'failed',
          null,
          errorMessage,
          correlationId,
        )
        channel.publish('fitmind.direct', 'meal.result', failMsg, { persistent: true })
        channel.nack(msg, false, false)
      }
    }
  })
}
