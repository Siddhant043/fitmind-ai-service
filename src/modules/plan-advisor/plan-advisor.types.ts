import { z } from 'zod'

export const suggestionTypeSchema = z.enum([
  'nutrition',
  'workout',
  'recovery',
  'goal',
  'challenge',
])
export type SuggestionType = z.infer<typeof suggestionTypeSchema>

export const deltaMetricsSchema = z.object({
  proteinDeficitDays: z.number().int(),
  avgProteinPct: z.number(),
  missedWorkoutStreak: z.number().int(),
  avgCaloriePct: z.number(),
  sessionsLast7Days: z.number().int(),
  volumeDeclinePct: z.number(),
})
export type DeltaMetrics = z.infer<typeof deltaMetricsSchema>

export const suggestionOutputSchema = z.object({
  suggestionType: suggestionTypeSchema,
  content: z.string(),
  reasoning: z.string(),
  dataSnapshot: z.record(z.unknown()),
})
export type SuggestionOutput = z.infer<typeof suggestionOutputSchema>

export interface PlanAnalysisTrigger {
  userId: string
  triggerReason: 'daily_cron' | 'post_workout' | 'post_meal_log' | 'manual'
  userContextBundle: import('../context-builder/context-builder.js').UserContextBundle | null
}

export interface PlanSuggestionResult {
  userId: string
  suggestionType: SuggestionType
  content: string
  reasoning: string
  dataSnapshot: Record<string, unknown>
  status: 'completed' | 'failed'
  errorMessage: string | null
}
