import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { resolveStructuredOutputMethod } from '../../providers/llm-provider.factory.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export const chatExerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().min(1),
  repRange: z.string(),
  restSec: z.number().int().nonnegative().optional().nullable(),
})

export const chatPlanDaySchema = z.object({
  dayLabel: z.string(),
  exercises: z.array(chatExerciseSchema),
})

export const workoutPlanCreatePayloadSchema = z.object({
  type: z.literal('workout_plan_create'),
  data: z.object({
    name: z.string(),
    goal: z.string().optional().nullable(),
    difficulty: z.string().optional().nullable(),
    daysPerWeek: z.number().int().min(1),
    description: z.string().optional().nullable(),
    days: z.array(chatPlanDaySchema),
  }),
})

export const workoutDayCreatePayloadSchema = z.object({
  type: z.literal('workout_day_create'),
  data: z.object({
    dayLabel: z.string(),
    exercises: z.array(chatExerciseSchema),
  }),
})

export type ChatExercise = z.infer<typeof chatExerciseSchema>
export type ChatPlanDay = z.infer<typeof chatPlanDaySchema>
export type WorkoutActionPayload =
  | z.infer<typeof workoutPlanCreatePayloadSchema>
  | z.infer<typeof workoutDayCreatePayloadSchema>

const planExtractionSchema = z.object({
  isPlanPresent: z.boolean(),
  name: z.string().optional(),
  goal: z.string().optional().nullable(),
  difficulty: z.string().optional().nullable(),
  daysPerWeek: z.number().int().min(1).optional(),
  description: z.string().optional().nullable(),
  days: z.array(chatPlanDaySchema).optional(),
})

const dayExtractionSchema = z.object({
  isDayPresent: z.boolean(),
  dayLabel: z.string().optional(),
  exercises: z.array(chatExerciseSchema).optional(),
})

type StructuredExtractionModel = {
  withStructuredOutput: (
    schema: z.ZodTypeAny,
    config?: {
      name?: string
      method?: 'functionCalling' | 'jsonMode' | 'jsonSchema'
    },
  ) => { invoke: (messages: unknown[]) => Promise<unknown> }
}

type StructuredModel = {
  invoke: (messages: unknown[]) => Promise<unknown>
}

function bindStructuredModel(
  model: StructuredExtractionModel,
  schema: z.ZodTypeAny,
  name: string,
): StructuredModel {
  return model.withStructuredOutput(schema, {
    name,
    method: resolveStructuredOutputMethod(),
  })
}

const PLAN_EXTRACTION_PROMPT = `You extract structured workout plan data from an AI trainer's response.
Set isPlanPresent to true only if the response contains a complete multi-day workout plan with named days and exercises.
If the response is general advice, a single exercise tip, or no concrete plan was generated, set isPlanPresent to false.
Extract exercise names exactly as written. Use rep ranges like "8-12" or "10". Default sets to 3 if not specified.`

const DAY_EXTRACTION_PROMPT = `You extract structured single workout day data from an AI trainer's response.
Set isDayPresent to true only if the response contains a complete workout day with a label and a list of exercises with sets/reps.
If the response is general advice or no concrete day was generated, set isDayPresent to false.
Extract exercise names exactly as written. Use rep ranges like "8-12" or "10". Default sets to 3 if not specified.`

export async function extractWorkoutPlanAction(
  responseText: string,
  model: StructuredExtractionModel,
): Promise<WorkoutActionPayload | null> {
  const structured = bindStructuredModel(model, planExtractionSchema, 'workout_plan_extraction')

  const result = await structured.invoke([
    new SystemMessage(PLAN_EXTRACTION_PROMPT),
    new HumanMessage(responseText),
  ])

  const parsed = planExtractionSchema.safeParse(result)
  if (!parsed.success || !parsed.data.isPlanPresent) return null

  const { name, goal, difficulty, daysPerWeek, description, days } = parsed.data
  if (!name || !daysPerWeek || !days?.length) return null

  return {
    type: 'workout_plan_create',
    data: {
      name,
      goal: goal ?? null,
      difficulty: difficulty ?? null,
      daysPerWeek,
      description: description ?? null,
      days,
    },
  }
}

export async function extractWorkoutDayAction(
  responseText: string,
  model: StructuredExtractionModel,
): Promise<WorkoutActionPayload | null> {
  const structured = bindStructuredModel(model, dayExtractionSchema, 'workout_day_extraction')

  const result = await structured.invoke([
    new SystemMessage(DAY_EXTRACTION_PROMPT),
    new HumanMessage(responseText),
  ])

  const parsed = dayExtractionSchema.safeParse(result)
  if (!parsed.success || !parsed.data.isDayPresent) return null

  const { dayLabel, exercises } = parsed.data
  if (!dayLabel || !exercises?.length) return null

  return {
    type: 'workout_day_create',
    data: {
      dayLabel,
      exercises,
    },
  }
}
