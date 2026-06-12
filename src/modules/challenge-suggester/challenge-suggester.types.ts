import { z } from 'zod'

export const challengeRuleTypeSchema = z.enum([
  'workout_count',
  'protein_hit_rate',
  'nutrition_log_rate',
  'pr_count',
  'muscle_group_session_count',
  'post_workout_meal_within',
])

export const challengeRuleSchema = z.object({
  type: challengeRuleTypeSchema,
  window_days: z.number().int().min(1).max(14),
  min: z.number().optional(),
  min_pct: z.number().min(0).max(1).optional(),
  muscle_group: z.string().optional(),
  within_minutes: z.number().int().positive().optional(),
})

export const challengeCriteriaSchema = z.object({
  operator: z.enum(['AND', 'OR']),
  rules: z.array(challengeRuleSchema).min(1),
})

export const challengeSuggestionOutputSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(500),
  durationDays: z.number().int().min(3).max(14).default(7),
  criteriaJson: challengeCriteriaSchema,
})

export type ChallengeSuggestionOutput = z.infer<typeof challengeSuggestionOutputSchema>

export interface ChallengeSuggestionRequest {
  userId: string
  triggerReason: 'coach_chat' | 'proactive'
}

export interface ChallengeSuggestionResult {
  userId: string
  status: 'completed' | 'failed'
  title: string
  description: string
  criteriaJson: ChallengeSuggestionOutput['criteriaJson']
  durationDays: number
  errorMessage: string | null
}

export const challengeSuggestActionSchema = z.object({
  type: z.literal('challenge_suggest'),
  data: z.object({
    title: z.string(),
    description: z.string(),
    templateKey: z.string().optional().nullable(),
    requestCoachGeneration: z.boolean().optional(),
  }),
})

export type ChallengeSuggestAction = z.infer<typeof challengeSuggestActionSchema>
