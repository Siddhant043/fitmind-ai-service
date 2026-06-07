import { describe, it, expect } from 'vitest'
import { buildFallbackPlans } from '../workout-plan.fallback.js'
import { generatedWorkoutPlanSchema } from '../workout-plan.types.js'
import type { WorkoutPlanGenerationRequest } from '../workout-plan.types.js'

const mockCatalog = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Barbell Bench Press',
    muscleGroup: 'chest',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Barbell Row',
    muscleGroup: 'back',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Barbell Squat',
    muscleGroup: 'quadriceps',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    name: 'Overhead Press',
    muscleGroup: 'shoulders',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    name: 'Romanian Deadlift',
    muscleGroup: 'hamstrings',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000006',
    name: 'Plank',
    muscleGroup: 'core',
    equipment: 'bodyweight',
  },
  {
    id: '00000000-0000-0000-0000-000000000007',
    name: 'Barbell Curl',
    muscleGroup: 'biceps',
    equipment: 'barbell',
  },
  {
    id: '00000000-0000-0000-0000-000000000008',
    name: 'Tricep Pushdown',
    muscleGroup: 'triceps',
    equipment: 'cable',
  },
]

function makeRequest(
  goal: WorkoutPlanGenerationRequest['profile']['goal'],
  activityLevel: string,
): WorkoutPlanGenerationRequest {
  return {
    requestId: 'req-1',
    userId: 'user-1',
    profile: {
      sex: 'male',
      ageYears: 28,
      weightKg: 75,
      heightCm: 178,
      goal,
      activityLevel: activityLevel as WorkoutPlanGenerationRequest['profile']['activityLevel'],
      dietaryPref: 'none',
      tdee: 2400,
      macroTargets: { calories: 2400, protein_g: 150, carbs_g: 250, fats_g: 70 },
    },
    allowedExercises: mockCatalog,
    maxPlans: 3,
  }
}

describe('workout-plan-generator fallback', () => {
  it('returns valid schema for cut goal', () => {
    const plans = buildFallbackPlans(makeRequest('cut', 'moderate'))
    expect(plans.length).toBeGreaterThanOrEqual(1)
    for (const plan of plans) {
      expect(generatedWorkoutPlanSchema.safeParse(plan).success).toBe(true)
      expect(plan.goal).toBe('cut')
    }
  })

  it('returns valid schema for bulk goal', () => {
    const plans = buildFallbackPlans(makeRequest('bulk', 'active'))
    expect(plans.length).toBeGreaterThanOrEqual(2)
    for (const plan of plans) {
      expect(generatedWorkoutPlanSchema.safeParse(plan).success).toBe(true)
    }
  })

  it('limits days for sedentary activity level', () => {
    const plans = buildFallbackPlans(makeRequest('maintain', 'sedentary'))
    expect(plans[0]!.daysPerWeek).toBeLessThanOrEqual(3)
  })

  it('uses only allowed exercise IDs', () => {
    const allowedIds = new Set(mockCatalog.map((e) => e.id))
    const plans = buildFallbackPlans(makeRequest('recomposition', 'moderate'))
    for (const plan of plans) {
      for (const day of plan.days) {
        for (const exercise of day.exercises) {
          expect(allowedIds.has(exercise.exercise_id)).toBe(true)
        }
      }
    }
  })
})
