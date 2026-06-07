import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'
import { buildUserContext } from '../../context-builder/context-builder.js'
import { fetchChatData } from './core-service-rpc.client.js'

export interface ChatToolsConfig {
  userId: string
  redis: Redis
  channel: Channel
}

export function createGetLastWorkoutTool({ userId, redis }: ChatToolsConfig) {
  return tool(
    async () => {
      const ctx = await buildUserContext(userId, redis)
      return JSON.stringify(ctx?.lastWorkoutDetail ?? { error: 'No completed workout logged' })
    },
    {
      name: 'get_last_workout',
      description:
        "Fetch the user's most recent completed workout with exercises, sets, reps, weights, RPE, and performance flags. Use for questions about their last workout or weak exercises.",
      schema: z.object({}),
    },
  )
}

export function createGetLastMealTool({ userId, redis }: ChatToolsConfig) {
  return tool(
    async () => {
      const ctx = await buildUserContext(userId, redis)
      return JSON.stringify(ctx?.lastMealDetail ?? { error: 'No meal logged' })
    },
    {
      name: 'get_last_meal',
      description:
        "Fetch the user's most recent logged meal with macros, description, and AI meal feedback. Use for questions about their last meal or how to improve it.",
      schema: z.object({}),
    },
  )
}

export function createGetRecentMealsTool({ userId, redis }: ChatToolsConfig) {
  return tool(
    async () => {
      const ctx = await buildUserContext(userId, redis)
      return JSON.stringify(ctx?.recentMeals ?? [])
    },
    {
      name: 'get_recent_meals',
      description: "Fetch the user's last 5 logged meals with macros and feedback.",
      schema: z.object({}),
    },
  )
}

export function createGetNutritionSummaryTool({ userId, redis }: ChatToolsConfig) {
  return tool(
    async () => {
      const ctx = await buildUserContext(userId, redis)
      return JSON.stringify({
        today: ctx?.todayNutrition ?? null,
        recentDays: ctx?.recentNutrition ?? [],
        macroTargets: ctx?.profile.macroTargets ?? null,
      })
    },
    {
      name: 'get_nutrition_summary',
      description:
        "Fetch the user's today and recent daily nutrition totals compared to macro targets.",
      schema: z.object({}),
    },
  )
}

export function createGetExerciseHistoryTool({ userId, redis, channel }: ChatToolsConfig) {
  return tool(
    async ({ exerciseName, limit }) => {
      const result = await fetchChatData(channel, redis, userId, 'get_exercise_history', {
        exerciseName,
        limit: limit ?? 5,
      })
      return JSON.stringify(result)
    },
    {
      name: 'get_exercise_history',
      description:
        'Fetch historical performance for a specific exercise by name, including personal records and recent session volume.',
      schema: z.object({
        exerciseName: z.string().describe('Exercise name, e.g. "Bench Press"'),
        limit: z.number().int().min(1).max(10).optional().describe('Number of recent sessions'),
      }),
    },
  )
}

export function createGetWorkoutSessionTool({ userId, redis, channel }: ChatToolsConfig) {
  return tool(
    async ({ sessionId }) => {
      const result = await fetchChatData(channel, redis, userId, 'get_workout_session', {
        sessionId: sessionId ?? undefined,
      })
      return JSON.stringify(result)
    },
    {
      name: 'get_workout_session',
      description:
        'Fetch a specific past workout session by ID, or the last workout if sessionId is omitted.',
      schema: z.object({
        sessionId: z.string().uuid().optional().describe('Workout session UUID'),
      }),
    },
  )
}

export function buildChatTools(config: ChatToolsConfig) {
  return [
    createGetLastWorkoutTool(config),
    createGetLastMealTool(config),
    createGetRecentMealsTool(config),
    createGetNutritionSummaryTool(config),
    createGetExerciseHistoryTool(config),
    createGetWorkoutSessionTool(config),
  ]
}
