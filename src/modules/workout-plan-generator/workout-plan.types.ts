import { z } from 'zod'

export const planDayExerciseSchema = z.object({
  exercise_id: z.string().uuid(),
  order: z.number().int().positive(),
  sets: z.number().int().min(2).max(5),
  rep_range: z.string().min(1).max(50),
  rest_sec: z.number().int().min(60).max(180).optional().nullable(),
  rpe_target: z.number().int().min(1).max(10).optional().nullable(),
})

export const planDaySchema = z.object({
  dayLabel: z.string().min(1).max(100),
  dayOrder: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
  exercises: z.array(planDayExerciseSchema).min(3).max(8),
  notes: z.string().max(500).optional().nullable(),
})

export const generatedWorkoutPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(10).max(500),
  goal: z.enum(['bulk', 'cut', 'maintain', 'recomposition']),
  daysPerWeek: z.number().int().min(1).max(7),
  tags: z.array(z.string().min(1).max(50)).min(1).max(5),
  days: z.array(planDaySchema).min(1).max(7),
})

export const workoutPlanGenerationOutputSchema = z.object({
  plans: z.array(generatedWorkoutPlanSchema).min(1).max(3),
})

export type GeneratedWorkoutPlan = z.infer<typeof generatedWorkoutPlanSchema>
export type WorkoutPlanGenerationOutput = z.infer<typeof workoutPlanGenerationOutputSchema>

export interface AllowedExercise {
  id: string
  name: string
  muscleGroup: string
  equipment: string | null
}

export interface WorkoutPlanGenerationRequest {
  requestId: string
  userId: string
  profile: {
    sex: string
    ageYears: number
    weightKg: number
    heightCm: number
    goal: 'bulk' | 'cut' | 'maintain' | 'recomposition'
    activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
    dietaryPref: string | null
    tdee: number | null
    macroTargets: {
      calories: number
      protein_g: number
      carbs_g: number
      fats_g: number
    } | null
  }
  allowedExercises: AllowedExercise[]
  maxPlans: number
}
