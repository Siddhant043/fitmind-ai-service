import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  buildPrimaryModel,
  buildFallbackModel,
  buildAlternatePrimaryModel,
  resolveStructuredOutputMethod,
} from '../../providers/llm-provider.factory.js'
import {
  buildMealAnalyzerSystemPrompt,
  mealAnalyzerOutputSchema,
  type MealAnalyzerUserContext,
} from './meal-analyzer.prompt.js'
import type { MealAnalyzerOutput } from './meal-analyzer.prompt.js'
import { parseMealAnalyzerOutput } from './meal-analyzer.normalize.js'
import type { MealAnalysisResult } from '../../queues/job.types.js'

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

interface RedisUserContext {
  profile?: {
    goal?: string | null
    tdee?: number | null
    macroTargets?: {
      calories: number
      protein_g: number
      carbs_g: number
      fats_g: number
    } | null
    countryCode?: string | null
    dietaryPref?: string | null
  }
  activePlan?: {
    name?: string
  } | null
  todayNutrition?: {
    calories?: number
    proteinG?: number
  } | null
}

const LLM_TIMEOUT_MS = 60_000
const TRANSIENT_LLM_MAX_ATTEMPTS = 3

type StructuredMealModel = {
  invoke: (input: Parameters<ReturnType<typeof buildPrimaryModel>['invoke']>[0]) => Promise<unknown>
}

function isTransientLlmError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\b503\b|429|\b500\b|Service Unavailable|high demand|rate limit|overloaded/i.test(message)
}

function wrapStructuredMealModel(
  baseModel: ReturnType<typeof buildPrimaryModel>,
  structuredOutputMethod: ReturnType<typeof resolveStructuredOutputMethod>,
): StructuredMealModel {
  return baseModel.withStructuredOutput(mealAnalyzerOutputSchema, {
    name: 'analyze_meal_nutrition',
    method: structuredOutputMethod,
  }) as StructuredMealModel
}

function buildMealAnalyzerModelChain(
  structuredOutputMethod: ReturnType<typeof resolveStructuredOutputMethod>,
): {
  models: StructuredMealModel[]
  labels: string[]
} {
  const models: StructuredMealModel[] = [
    wrapStructuredMealModel(buildPrimaryModel('vision'), structuredOutputMethod),
  ]
  const labels = ['primary-vision']

  const explicitFallback = buildFallbackModel('vision')
  if (explicitFallback) {
    models.push(wrapStructuredMealModel(explicitFallback, structuredOutputMethod))
    labels.push('fallback-vision')
  }

  const alternatePrimary = buildAlternatePrimaryModel('vision')
  if (alternatePrimary) {
    models.push(wrapStructuredMealModel(alternatePrimary, structuredOutputMethod))
    labels.push('alternate-gemini-vision')
  }

  return { models, labels }
}

function parseUserContextForMealAnalysis(raw: string | null): MealAnalyzerUserContext | null {
  if (!raw) return null
  try {
    const ctx = JSON.parse(raw) as RedisUserContext
    return {
      goal: ctx.profile?.goal ?? null,
      tdee: ctx.profile?.tdee ?? null,
      macroTargets: ctx.profile?.macroTargets ?? null,
      todayCalories: ctx.todayNutrition?.calories ?? 0,
      todayProteinG: ctx.todayNutrition?.proteinG ?? 0,
      activePlanName: ctx.activePlan?.name ?? null,
      countryCode: ctx.profile?.countryCode ?? null,
      dietaryPref: ctx.profile?.dietaryPref ?? null,
    }
  } catch {
    return null
  }
}

async function resolveMealAnalysisResult(
  models: StructuredMealModel[],
  modelLabels: string[],
  messages: [SystemMessage, HumanMessage],
): Promise<MealAnalyzerOutput> {
  let sawParseFailure = false
  let lastModelError: string | null = null

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex]
    if (!model) continue
    const label = modelLabels[modelIndex] ?? `model-${modelIndex}`

    try {
      const lastRaw = await invokeModelWithTransientRetries(model, messages, label)
      const parsed = parseMealAnalyzerOutput(lastRaw)
      if (parsed) return parsed
      sawParseFailure = true
    } catch (err) {
      lastModelError = err instanceof Error ? err.message : String(err)
      console.warn(`[MealAnalyzer] ${label} failed:`, lastModelError)
    }
  }

  if (sawParseFailure) {
    throw new Error('LLM returned incomplete macro data')
  }

  throw new Error(lastModelError ?? 'All meal analysis models failed')
}

async function invokeModelWithTransientRetries(
  model: StructuredMealModel,
  messages: [SystemMessage, HumanMessage],
  label: string,
): Promise<unknown> {
  let lastErr: unknown

  for (let attempt = 0; attempt < TRANSIENT_LLM_MAX_ATTEMPTS; attempt++) {
    try {
      return await invokeWithTimeout(model, messages)
    } catch (err) {
      lastErr = err
      const isTransient = isTransientLlmError(err)
      const isLastAttempt = attempt === TRANSIENT_LLM_MAX_ATTEMPTS - 1
      if (!isTransient || isLastAttempt) throw err

      const delayMs = 1000 * (attempt + 1)
      console.warn(
        `[MealAnalyzer] ${label} transient error, retrying (${attempt + 1}/${TRANSIENT_LLM_MAX_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastErr
}

async function invokeWithTimeout(
  model: StructuredMealModel,
  messages: [SystemMessage, HumanMessage],
): Promise<unknown> {
  return Promise.race([
    model.invoke(messages),
    new Promise<unknown>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM request timed out after ${LLM_TIMEOUT_MS / 1000}s`)),
        LLM_TIMEOUT_MS,
      )
    }),
  ])
}

function buildResultMessage(
  mealId: string,
  userId: string,
  status: 'completed' | 'failed',
  result: MealAnalyzerOutput | null,
  errorMessage: string | null,
  correlationId: string,
): Buffer {
  const payload: MealAnalysisResult = {
    mealId,
    userId,
    status,
    confidence: result ? result.confidence : null,
    macros: result ? result.macros : null,
    mealFeedback: result?.mealFeedback ?? null,
    workoutSuggestion: result?.workoutSuggestion ?? null,
    aiRawResponse: result ? (result as unknown as Record<string, unknown>) : null,
    errorMessage,
  }

  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'meal.analysis.result',
    payload,
    metadata: { userId, traceId: randomUUID() },
  }
  return Buffer.from(JSON.stringify(envelope))
}

export function startMealAnalyzerWorker(channel: Channel, redis: Redis) {
  const structuredOutputMethod = resolveStructuredOutputMethod()
  const { models, labels } = buildMealAnalyzerModelChain(structuredOutputMethod)

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
      const userContextRaw = await redis.get(`user_context:${userId}`)
      const userContext = parseUserContextForMealAnalysis(userContextRaw)

      const humanMessageContent: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = []

      if (description) {
        humanMessageContent.push({
          type: 'text',
          text: `Meal Description: ${description}`,
        })
      }

      if (imageUrl) {
        const imageFetchHeaders: Record<string, string> = {}
        const internalApiToken = process.env.INTERNAL_API_TOKEN
        if (internalApiToken) {
          imageFetchHeaders['x-internal-token'] = internalApiToken
        }
        const response = await fetch(imageUrl, { headers: imageFetchHeaders })
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

      if (humanMessageContent.length === 0) {
        humanMessageContent.push({
          type: 'text',
          text: 'No description or image provided for this meal.',
        })
      }

      const messages: [SystemMessage, HumanMessage] = [
        new SystemMessage(buildMealAnalyzerSystemPrompt(userContext)),
        new HumanMessage({ content: humanMessageContent }),
      ]

      const result = await resolveMealAnalysisResult(models, labels, messages)

      const resultMsg = buildResultMessage(mealId, userId, 'completed', result, null, correlationId)

      channel.publish('fitmind.direct', 'meal.result', resultMsg, { persistent: true })
      channel.ack(msg)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[MealAnalyzer] Error processing meal analysis:`, err)

      const failMsg = buildResultMessage(
        mealId,
        userId,
        'failed',
        null,
        errorMessage,
        correlationId,
      )
      channel.publish('fitmind.direct', 'meal.result', failMsg, { persistent: true })
      channel.ack(msg)
    }
  })
}
