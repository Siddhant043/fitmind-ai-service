import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildPrimaryModel, buildFallbackModel } from '../../providers/llm-provider.factory.js'
import { WORKOUT_PLAN_SYSTEM_PROMPT, buildWorkoutPlanUserPrompt } from './workout-plan.prompt.js'
import { buildFallbackPlans } from './workout-plan.fallback.js'
import {
  workoutPlanGenerationOutputSchema,
  type GeneratedWorkoutPlan,
  type WorkoutPlanGenerationRequest,
} from './workout-plan.types.js'

const LLM_TIMEOUT_MS = 30_000

function buildResultMessage(
  requestId: string,
  userId: string,
  status: 'completed' | 'failed',
  plans: GeneratedWorkoutPlan[] | null,
  errorMessage: string | null,
  correlationId: string,
): Buffer {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'workout.plan.generation.result',
    payload: { requestId, userId, status, plans, errorMessage },
    metadata: { userId, traceId: randomUUID() },
  }
  return Buffer.from(JSON.stringify(envelope))
}

function validateExerciseIds(plans: GeneratedWorkoutPlan[], allowedIds: Set<string>): boolean {
  for (const plan of plans) {
    for (const day of plan.days) {
      for (const exercise of day.exercises) {
        if (!allowedIds.has(exercise.exercise_id)) {
          return false
        }
      }
    }
  }
  return true
}

async function invokeWithTimeout(
  model: { invoke: (messages: unknown[]) => Promise<unknown> },
  messages: unknown[],
) {
  return Promise.race([
    model.invoke(messages),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM request timed out after ${LLM_TIMEOUT_MS / 1000}s`)),
        LLM_TIMEOUT_MS,
      )
    }),
  ])
}

async function resolvePlans(
  payload: WorkoutPlanGenerationRequest,
  primary: { invoke: (messages: unknown[]) => Promise<unknown> },
  fallback: { invoke: (messages: unknown[]) => Promise<unknown> } | null,
  messages: unknown[],
): Promise<GeneratedWorkoutPlan[]> {
  const allowedIds = new Set(payload.allowedExercises.map((e) => e.id))

  const tryParse = (raw: unknown): GeneratedWorkoutPlan[] | null => {
    const parsed = workoutPlanGenerationOutputSchema.safeParse(raw)
    if (!parsed.success) return null
    if (!validateExerciseIds(parsed.data.plans, allowedIds)) return null
    return parsed.data.plans.slice(0, payload.maxPlans)
  }

  try {
    const primaryResult = await invokeWithTimeout(primary, messages)
    const plans = tryParse(primaryResult)
    if (plans) return plans
  } catch (primaryErr) {
    console.warn('[WorkoutPlan] Primary model failed:', (primaryErr as Error).message)
  }

  if (fallback) {
    try {
      const fallbackResult = await invokeWithTimeout(fallback, messages)
      const plans = tryParse(fallbackResult)
      if (plans) return plans
    } catch (fallbackErr) {
      console.warn('[WorkoutPlan] Fallback model failed:', (fallbackErr as Error).message)
    }
  }

  console.warn('[WorkoutPlan] Using rule-based fallback plans')
  return buildFallbackPlans(payload)
}

export function startWorkoutPlanGeneratorWorker(channel: Channel) {
  const primary = buildPrimaryModel('chat').withStructuredOutput(
    workoutPlanGenerationOutputSchema,
    {
      name: 'generate_workout_plans',
      method: 'functionCalling',
    },
  )
  const fallbackBase = buildFallbackModel('chat')
  const fallback = fallbackBase
    ? fallbackBase.withStructuredOutput(workoutPlanGenerationOutputSchema, {
        name: 'generate_workout_plans',
        method: 'functionCalling',
      })
    : null

  channel.prefetch(2)

  channel.consume('workout.plan.generation.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: {
      payload: WorkoutPlanGenerationRequest
      correlationId: string
    }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const messages = [
      new SystemMessage(WORKOUT_PLAN_SYSTEM_PROMPT),
      new HumanMessage(buildWorkoutPlanUserPrompt(payload)),
    ]

    try {
      const plans = await resolvePlans(payload, primary, fallback, messages)
      const resultMsg = buildResultMessage(
        payload.requestId,
        payload.userId,
        'completed',
        plans,
        null,
        correlationId,
      )
      channel.publish('fitmind.direct', 'workout.plan.result', resultMsg, { persistent: true })
      channel.ack(msg)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[WorkoutPlan] Generation failed:', errorMessage)

      const failMsg = buildResultMessage(
        payload.requestId,
        payload.userId,
        'failed',
        null,
        errorMessage,
        correlationId,
      )
      channel.publish('fitmind.direct', 'workout.plan.result', failMsg, { persistent: true })
      channel.ack(msg)
    }
  })
}
