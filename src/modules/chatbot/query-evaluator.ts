import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import {
  buildPrimaryModel,
  buildFallbackModel,
  resolveStructuredOutputMethod,
} from '../../providers/llm-provider.factory.js'
import { invokeWithFallback } from '../../providers/llm-with-fallback.js'

export const KNOWN_INTENTS = [
  'fitness_rag',
  'nutrition_rag',
  'workout_plan_create',
  'workout_day_create',
  'workout_history',
  'meal_history',
  'progress_review',
  'challenge_suggest',
  'general',
] as const

export type KnownIntent = (typeof KNOWN_INTENTS)[number]

export const queryEvaluationSchema = z.object({
  intent: z.enum(KNOWN_INTENTS),
  needsUserData: z.boolean(),
  complexity: z.enum(['fast', 'deep']),
  isMultiHop: z.boolean(),
})

export type QueryEvaluation = z.infer<typeof queryEvaluationSchema>

type StructuredEvaluationModel = {
  withStructuredOutput: (
    schema: z.ZodTypeAny,
    config?: {
      name?: string
      method?: 'functionCalling' | 'jsonMode' | 'jsonSchema'
    },
  ) => { invoke: (messages: BaseMessage[]) => Promise<unknown> }
}

const DEFAULT_EVALUATION: QueryEvaluation = {
  intent: 'general',
  needsUserData: false,
  complexity: 'deep',
  isMultiHop: false,
}

const EVALUATION_PROMPT = `Classify the following fitness/nutrition chat message and judge how it should be handled.

intent — exactly one of:
- fitness_rag: general fitness training knowledge (not about the user's own logs)
- nutrition_rag: general nutrition/diet knowledge (not about the user's own logs)
- workout_plan_create: user asks to create/design/make/build a workout plan, program, routine, or split
- workout_day_create: user asks to create/make/give a single workout day (e.g. push/pull/leg/chest/back/arm day)
- workout_history: user asks about THEIR OWN past/recent/last workout, exercise performance, weak lifts, or session review
- meal_history: user asks about THEIR OWN logged meals, last meal, or how to improve a meal they ate
- progress_review: user asks why they are not progressing, getting stronger, or how they are doing overall
- challenge_suggest: user asks for a challenge, micro-challenge, weekly goal, or 7-day contract to opt into
- general: everything else

needsUserData — true if answering well requires the user's own logged data (their meals, workouts, or progress), not just general knowledge.

complexity — "fast" if the message is a short, simple, factual lookup that a quick model can answer well (e.g. "how many calories in an egg"); "deep" if it needs careful reasoning, multi-step explanation, or nuanced advice.

isMultiHop — true only if the message is a fitness/nutrition knowledge question (fitness_rag or nutrition_rag) that bundles more than one distinct sub-question requiring separate lookups (e.g. asks to compare two training methods, or asks two unrelated things at once). False for single-focus questions and for all non-RAG intents.`

function bindStructuredModel(model: StructuredEvaluationModel) {
  return model.withStructuredOutput(queryEvaluationSchema, {
    name: 'query_evaluation',
    method: resolveStructuredOutputMethod(),
  })
}

export async function evaluateQuery(text: string): Promise<QueryEvaluation> {
  const primary = bindStructuredModel(
    buildPrimaryModel('fast') as unknown as StructuredEvaluationModel,
  )
  const fallbackModel = buildFallbackModel('fast') as unknown as StructuredEvaluationModel | null
  const fallback = fallbackModel ? bindStructuredModel(fallbackModel) : null

  const raw = await invokeWithFallback(primary, fallback, [
    new SystemMessage(EVALUATION_PROMPT),
    new HumanMessage(text),
  ])

  const parsed = queryEvaluationSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_EVALUATION
}
